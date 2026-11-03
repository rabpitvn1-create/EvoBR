import { chunkDocument } from '../import/chunker'
import { db } from '../db/schema'
import { generateWorkspaceUid } from '../memory/identity'
import { generateWorkspaceScopeCode, generateWorldCode } from './identity'
import type { CreateWorkspaceInput, NovelWorkflowProfile, Project, Work, WorkKind, WorkspacePurpose, WorkspaceScope, World, CommunityWorldOrigin } from '../types'
import { scopeTransactionTables, stampNewRecord } from './scope'
import { buildWorkRecord } from './works'


import { countWords, plainTextToHtml } from '../utils/html'

export interface CreateWorkspaceOptions {
  /** ARCH-01: defaults to an independent authored work. */
  purpose?: WorkspacePurpose
  kind?: WorkKind
  novelProfile?: NovelWorkflowProfile | null
  preferredChapterCount?: number
  /** Optional author-written seed for the first short-novel chapter card. */
  initialChapterSummary?: string
  /** Optional author-provided prose imported into the first short-novel chapter. */
  initialChapterContent?: string
  /** Author import into an independent long novel; preserved as ordered source chapters. */
  importedNovelText?: string
  /** World identity options belong to the World root, never the Project shell root. */
  world?: {
    code?: string
    currentVersion?: number
    communityOrigin?: CommunityWorldOrigin
  }
}

export interface CreatedWorkspace {
  project: Project
  world: World
  work: Work
  scope: WorkspaceScope
}

function projectRoot(input: CreateWorkspaceInput, options: CreateWorkspaceOptions, now: number): Project {
  const allowedInputKeys = new Set([
    'workspaceUid', 'workspacePurpose', 'name', 'genres', 'customGenre', 'status',
    'description', 'targetWordCount', 'coverImage', 'writingStyleId', 'methodologyId',
    'enableMultiWorld', 'includeCultivationProgressInAI', 'activeCharacterDrivenPlanId',
    'productPlatformOptIns',
  ])
  const unknownKeys = Object.keys(input).filter(key => !allowedInputKeys.has(key))
  if (unknownKeys.length) {
    throw new Error(`创建工作区包含非当前字段：${unknownKeys.join('、')}`)
  }
  if (!Array.isArray(input.genres) || input.genres.some(genre => typeof genre !== 'string')) {
    throw new Error('创建工作区 genres 必须是字符串数组')
  }
  const purpose = options.purpose ?? input.workspacePurpose ?? 'independent-work'
  return {
    workspaceUid: input.workspaceUid ?? generateWorkspaceUid(),
    workspacePurpose: purpose,
    name: input.name,
    enableMultiWorld: input.enableMultiWorld,
    activeWorldId: null,
    activeWorkId: null,
    productPlatformOptIns: input.productPlatformOptIns,
    createdAt: now,
    updatedAt: now,
  }
}



export function workspaceCreationTransactionTablesV1() {
  return scopeTransactionTables(db.outlineNodes, db.chapters)
}

/**
 * Creates a new LocalWorkspace and its initial World/Work roots atomically.
 */
export async function createWorkspace(
  input: CreateWorkspaceInput,
  options: CreateWorkspaceOptions = {},
): Promise<CreatedWorkspace> {
  const initialChapterSummary = options.initialChapterSummary?.trim()
  const initialChapterContent = options.initialChapterContent?.trim()
  if ((initialChapterSummary || initialChapterContent) && (options.kind !== 'novel' || options.novelProfile !== 'short')) throw new Error('首章创意种子或导入正文只适用于短篇小说工作区')
  if (initialChapterSummary && initialChapterSummary.length > 4_000) throw new Error('首章创意种子不得超过 4000 字符')
  if (initialChapterContent && (initialChapterContent.length > 200_000 || countWords(initialChapterContent) > 25_000)) throw new Error('导入正文不得超过 20 万字符或 25,000 字')
  const importedNovelText = options.importedNovelText
  if (importedNovelText != null && (options.kind !== 'novel' || options.novelProfile !== 'long' || !importedNovelText.trim() || importedNovelText.length > 5_000_000)) throw new Error('导入原作需为非空长篇文本，最多 500 万字符')
  const now = Date.now()
  const preparedProject = projectRoot(input, options, now)
  const genres = input.genres.length ? [...input.genres] : ['other']
  return db.transaction('rw', workspaceCreationTransactionTablesV1(), async () => {
    const projectId = await db.projects.add(preparedProject) as number
    const world: World = {
      projectId,
      identityKind: preparedProject.workspacePurpose === 'world-engine' ? 'world-draft' : 'workspace-scope',
      code: preparedProject.workspacePurpose === 'world-engine'
        ? options.world?.code ?? generateWorldCode()
        : generateWorkspaceScopeCode(now),
      name: preparedProject.name,
      description: input.description,
      currentVersion: preparedProject.workspacePurpose === 'world-engine'
        ? options.world?.currentVersion ?? 0
        : 0,
      communityOrigin: preparedProject.workspacePurpose === 'world-engine'
        ? options.world?.communityOrigin
        : undefined,
      createdAt: now,
      updatedAt: now,
    }
    const worldId = await db.worlds.add(world) as number
    const work = buildWorkRecord({
      projectId,
      worldId,
      fallback: {
        genres,
        targetWordCount: input.targetWordCount,
        writingStyleId: input.writingStyleId,
        methodologyId: input.methodologyId,
        includeCultivationProgressInAI: input.includeCultivationProgressInAI ?? false,
      },
      create: {
        title: preparedProject.name,
        description: input.description,
        genres,
        customGenre: input.customGenre,
        status: input.status,
        targetWordCount: input.targetWordCount,
        coverImage: input.coverImage,
        activeCharacterDrivenPlanId: input.activeCharacterDrivenPlanId,
        kind: options.kind,
        novelProfile: options.novelProfile,
      },
      now,
    })
    const workId = await db.works.add(work) as number
    const scope = { projectId, worldId, workId }

    if (importedNovelText) {
      const chunks = chunkDocument(importedNovelText, { targetChars: 20_000, overlapChars: 0 })
      for (let index = 0; index < chunks.length; index++) {
        // Use original offsets to retain paragraph separators and any preface exactly once.
        const content = importedNovelText.slice(index === 0 ? 0 : chunks[index].startChar, index + 1 < chunks.length ? chunks[index + 1].startChar : importedNovelText.length)
        const title = chunks[index].label || `原作第 ${index + 1} 部分`
        const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { projectId, parentId: null, type: 'chapter', title, summary: '', order: index, createdAt: now, updatedAt: now }, { owner: 'work' })) as number
        await db.chapters.add(stampNewRecord(scope, 'chapters', { projectId, outlineNodeId, title, content: plainTextToHtml(content), wordCount: countWords(content), status: 'draft', order: index, notes: '', createdAt: now, updatedAt: now }, { owner: 'work' }))
      }
    }
    const createdWorld = { ...world, id: worldId }
    const createdWork = { ...work, id: workId }
    const projectPatch = { activeWorldId: worldId, activeWorkId: workId }
    await db.projects.update(projectId, { ...projectPatch, updatedAt: now })
    return {
      project: { ...preparedProject, ...projectPatch, id: projectId, updatedAt: now },
      world: createdWorld,
      work: createdWork,
      scope,
    }
  })
}

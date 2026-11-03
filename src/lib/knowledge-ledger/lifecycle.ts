import { db } from '../db/schema'
import type { KnowledgeEventStatus } from '../types'

function reviewStatus(status: KnowledgeEventStatus, next: KnowledgeEventStatus): KnowledgeEventStatus {
  return status === 'rejected' ? status : next
}

/** 角色删除时保留姓名与事件；合并时重映射到 canonical 角色。 */
export async function remapKnowledgeCharacterRefs(args: {
  projectId: number
  fromCharacterId: number
  toCharacterId?: number
  toName?: string
}): Promise<{ touched: number }> {
  const rows = await db.knowledgeLedger
    .where('projectId').equals(args.projectId)
    .filter(entry => entry.characterId === args.fromCharacterId)
    .toArray()
  let touched = 0
  for (const entry of rows) {
    if (entry.id == null) continue
    await db.knowledgeLedger.update(entry.id, {
      characterId: args.toCharacterId ?? null,
      ...(args.toName ? { characterName: args.toName } : {}),
      ...(args.toCharacterId == null
        ? { status: reviewStatus(entry.status, 'source-missing') }
        : {}),
      updatedAt: Date.now(),
    })
    touched++
  }
  return { touched }
}

/** 删除来源章节时不丢事件，只断开章节并降级为 source-missing 待人工复核。 */
export async function detachKnowledgeForDeletedChapters(chapterIds: number[]): Promise<{ touched: number }> {
  if (!chapterIds.length) return { touched: 0 }
  const deleted = new Set(chapterIds)
  const rows = await db.knowledgeLedger.toArray()
  let touched = 0
  for (const entry of rows) {
    if (entry.id == null || entry.sourceChapterId == null || !deleted.has(entry.sourceChapterId)) continue
    await db.knowledgeLedger.update(entry.id, {
      sourceChapterId: null,
      status: reviewStatus(entry.status, 'source-missing'),
      updatedAt: Date.now(),
    })
    touched++
  }
  return { touched }
}

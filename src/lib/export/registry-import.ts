


/**
 * 注册表派生的项目导入引擎(AUDIT-1)
 *
 * 取代 json-export.ts 中手写的逐表导入:按表依赖拓扑排序(被引用表先于引用方)遍历
 * exportable 表,树表内再按 _parentExportId 拓扑排序,逐行把导出序号外键重映射回新 db id。
 * 加新表只需在注册表登记一行,自动进出导入。
 *
 * 必填外键(onUnmapped: 'require')缺失映射 → 抛错整体回滚(完整性保护);孤儿(onUnmapped:
 * 'drop')跳过该行;portals 等 JSON 自引用走两阶段(先建全表映射,再回填重映射)。
 */
import Dexie from 'dexie'
import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'

import { remapWorldPortalTargets } from '../utils/world-portals'
import { transactionTablesFor } from '../registry/lifecycle'
import type { ExportRefRemap, TableSpec } from '../registry/types'
import type { ProjectExportData, ProjectImportOptionsV1 } from './json-export'
import { CURRENT_BACKUP_VERSION, normalizeProjectBackup } from './backup-trust'
import { assertImportedReaderGraphV1 } from '../reader/import-integrity'

import { remapNarrativeDomainFieldV1 } from '../narrative-domain/references'
import { assertNarrativeLineageRowsV1 } from '../world-engine/narrative-lineage-lifecycle'
import { rebindPortableAgentRunContractV1 } from '../agent/run/contract-portability'
import { finalizeImportedAgentRunLedgersV1 } from '../agent/run/ledger-portability'
import { generateWorkspaceUid, isWorkspaceUid, isWorkCode } from '../memory/identity'
import { assertAgentRunArtifactRecordIntegrityV1 } from '../memory/artifact-record'
import { assertStoredWorkClassification } from '../workspace/work-kind'
import { isCompleteCharacterAxes } from '../character/character-axes'
import { isCurrentWorldCode } from '../workspace/identity'


type JsonIdPathsExportRefRemapV1 = Extract<ExportRefRemap, { kind: 'json-id-paths' }>


/**
 * SourcePin is a multi-row closure rather than an opaque Artifact payload.
 * Validate every claimed row before the import transaction starts, then prove
 * each accepted/carried-forward index closes over exactly the active unit rows
 * in the same Build epoch. Unit-only groups remain valid crash-recovery state:
 * P0 deliberately writes units before its closure index.
 */


function strictOwnerShadow(spec: TableSpec, row: Record<string, any>): {
  kind: 'world' | 'work' | 'instance'
  exportId: number
  field: string
} | null {
  if (spec.name === 'worlds' || spec.name === 'works') return null
  const locator = spec.domainOwner?.locator
  if (!locator || locator.kind === 'workspace') return null
  if (locator.kind === 'field') {
    if (locator.owner !== 'world' && locator.owner !== 'work') return null
    const shadowField = locator.owner === 'world' ? '_worldOwnerExportId' : '_workOwnerExportId'
    const opposite = locator.owner === 'world' ? '_workOwnerExportId' : '_worldOwnerExportId'
    if (row[opposite] != null || !Number.isInteger(row[shadowField])) {
      throw new Error(`[deriveImport] v4 owner 缺失或越界:${spec.name}.${shadowField}`)
    }
    return { kind: locator.owner, exportId: row[shadowField], field: locator.field }
  }
  if (locator.kind === 'exclusive-fields') {
    const hasWorld = Number.isInteger(row._worldOwnerExportId)
    const hasWork = Number.isInteger(row._workOwnerExportId)
    if (hasWorld === hasWork) throw new Error(`[deriveImport] v4 owner 必须且只能有一个:${spec.name}`)
    return hasWorld
      ? { kind: 'world', exportId: row._worldOwnerExportId, field: locator.worldField }
      : { kind: 'work', exportId: row._workOwnerExportId, field: locator.workField }
  }
  if (locator.kind === 'exclusive-work-instance') {
    const hasWork = Number.isInteger(row._workOwnerExportId)
    const hasInstance = Number.isInteger(row._instanceOwnerExportId)
    if (hasWork === hasInstance) throw new Error(`[deriveImport] v4 Work/Instance owner 必须且只能有一个:${spec.name}`)
    return hasWork
      ? { kind: 'work', exportId: row._workOwnerExportId, field: locator.workField }
      : { kind: 'instance', exportId: row._instanceOwnerExportId, field: locator.instanceField }
  }
  return null
}

async function validateCurrentBackup(data: ProjectExportData): Promise<void> {
  if (data.version !== CURRENT_BACKUP_VERSION) {
    throw new Error(`[deriveImport] 只接受当前备份版本 v${CURRENT_BACKUP_VERSION}`)
  }
  const value = data as unknown as Record<string, any>
  if (!Array.isArray(value.worlds) || !value.worlds.length || !Array.isArray(value.works) || !value.works.length) {
    throw new Error('[deriveImport] 当前备份缺少 World/Work 根')
  }
  const worldIds = new Set(value.worlds.map((row: any) => row?._exportId))
  const workIds = new Set(value.works.map((row: any) => row?._exportId))
  const instanceIds = new Set((value.productRuntimeSessions ?? []).map((row: any) => row?._exportId))
  if (worldIds.size !== value.worlds.length || workIds.size !== value.works.length
    || [...worldIds].some(id => !Number.isInteger(id)) || [...workIds].some(id => !Number.isInteger(id))) {
    throw new Error('[deriveImport] World/Work 便携 ID 重复或无效')
  }
  const worldCodes = new Set<string>()
  for (const row of value.worlds as Array<Record<string, unknown>>) {
    if ((row.identityKind !== 'workspace-scope' && row.identityKind !== 'world-draft')
      || !isCurrentWorldCode(row.identityKind, row.code)
      || worldCodes.has(row.code)) {
      throw new Error('[deriveImport] World 身份或稳定编号无效')
    }
    worldCodes.add(row.code)
  }
  const ownership = value.ownership
  if (!ownership || !worldIds.has(ownership.worldExportId) || !workIds.has(ownership.workExportId)) {
    throw new Error('[deriveImport] active owner 指针缺失或越界')
  }
  const resourceUids = new Set<string>()
  for (const spec of PROJECT_TABLES) {
    if (!spec.exportable || !spec.resourceIdentity) continue
    const rows = value[spec.name]
    if (!Array.isArray(rows)) throw new Error(`[deriveImport] 当前备份缺少 ${spec.name}`)
    for (const row of rows) {
      const uid = row?.[spec.resourceIdentity.field]
      if (!isPortableResourceUidV1(uid, spec.resourceIdentity.resourceKind)) {
        throw new Error(`[deriveImport] ${spec.name}.${spec.resourceIdentity.field} 缺少当前资源身份`)
      }
      if (resourceUids.has(uid)) throw new Error(`[deriveImport] resource UID 重复：${uid}`)
      resourceUids.add(uid)
    }
  }
  const workCodes = new Set<string>()
  for (const row of value.works as Array<Record<string, unknown>>) {
    if (!isWorkCode(row.code) || workCodes.has(row.code)) throw new Error('[deriveImport] Work code 无效或重复')
    workCodes.add(row.code)
    try {
      assertStoredWorkClassification(row as any)
    } catch (error) {
      throw new Error(`[deriveImport] Work 分类非法：${error instanceof Error ? error.message : String(error)}`)
    }
  }


  for (const spec of PROJECT_TABLES) {
    if (!spec.exportable || spec.name === 'projects' || spec.name === 'worlds' || spec.name === 'works') continue
    const rows = value[spec.name]
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      if (!row || typeof row !== 'object') throw new Error(`[deriveImport] ${spec.name} 包含非法记录`)
      spec.validateImportRow?.(row)
      if ('worldId' in row || 'workId' in row) throw new Error(`[deriveImport] ${spec.name} 泄露本地主键 owner`)
      const shadow = strictOwnerShadow(spec, row)
      if (!shadow) continue
      const validIds = shadow.kind === 'world' ? worldIds : shadow.kind === 'work' ? workIds : instanceIds
      if (!validIds.has(shadow.exportId)) throw new Error(`[deriveImport] owner 越界:${spec.name}`)
    }
  }
}


function restoreCurrentOwner(
  spec: TableSpec,
  obj: Record<string, any>,
  newIdMaps: Map<string, Map<number, number>>,
): void {
  const shadow = strictOwnerShadow(spec, obj)
  delete obj._worldOwnerExportId
  delete obj._workOwnerExportId
  delete obj._instanceOwnerExportId
  if (!shadow) return
  const ownerMap = newIdMaps.get(shadow.kind === 'world' ? 'worlds' : shadow.kind === 'work' ? 'works' : 'productRuntimeSessions')
  const mapped = ownerMap?.get(shadow.exportId)
  if (mapped == null) throw new Error(`[deriveImport] owner 无法重映射:${spec.name}`)
  if (obj[shadow.field] != null && obj[shadow.field] !== mapped) {
    throw new Error(`[deriveImport] owner 与外键冲突:${spec.name}.${shadow.field}`)
  }
  obj[shadow.field] = mapped
  const locator = spec.domainOwner?.locator
  if (locator?.kind === 'exclusive-fields') {
    obj[shadow.kind === 'world' ? locator.workField : locator.worldField] = null
  } else if (locator?.kind === 'exclusive-work-instance') {
    obj[shadow.kind === 'work' ? locator.instanceField : locator.workField] = null
  }
}

/**
 * 表级拓扑排序：被 remapVia 指向的表通常必须先导入。注册表显式标记
 * deferred 的可空反向外键可先落 null，再由 deferredForeignKeys 在所有
 * 映射可用后回填，用于表达 Character ↔ Chapter 等合法双向可空引用。
 */
function deriveImportOrder(specs: TableSpec[]): TableSpec[] {
  const done = new Set<string>()
  const order: TableSpec[] = []
  // World/Work are ownership roots and must materialize before any
  // domain-owned row. Optional reverse references (for example Work -> active
  // character plan) are patched after all tables have been imported.
  for (const rootName of ['worlds', 'works']) {
    const root = specs.find(spec => spec.name === rootName)
    if (root) {
      order.push(root)
      done.add(root.name)
    }
  }
  let guard = 0
  while (order.length < specs.length) {
    if (guard++ > specs.length + 2) throw new Error('[deriveImport] 表依赖存在环,无法拓扑排序')
    for (const spec of specs) {
      if (done.has(spec.name)) continue
      const fieldDeps = (spec.exportRemap ?? [])
        .filter(rm => !rm.selfTree
          && rm.remapVia !== spec.name
          && rm.deferred !== true
          && rm.deferImport !== true)
        .map(rm => rm.remapVia)
      const refDeps = (spec.exportRefRemap ?? [])
        // JSON locators are restored in a second pass when their target table
        // is a forward reference. This is required for legitimate proof cycles
        // such as ProductBuild ledger -> AgentRun -> ProductBuild.
        .flatMap(ref => ref.kind === 'json-id-paths' || ref.kind === 'narrative-source-refs-v1' || ref.remapVia === spec.name
          ? [] : [ref.remapVia])
      const ownerDeps = spec.domainOwner?.locator?.kind === 'field'
        ? [spec.domainOwner.locator.owner === 'world' ? 'worlds' : spec.domainOwner.locator.owner === 'work' ? 'works' : null]
        : spec.domainOwner?.locator?.kind === 'exclusive-fields' ? ['worlds', 'works']
          : spec.domainOwner?.locator?.kind === 'exclusive-work-instance' ? ['works', 'productRuntimeSessions'] : []
      const portableDeps = spec.portableData?.kind === 'agent-run-root'
        ? spec.portableData.dependencies
        : []
      const deps = [...new Set([...fieldDeps, ...refDeps, ...ownerDeps, ...portableDeps].filter((d): d is string => !!d && d !== spec.name))]
      if (deps.every(d => done.has(d))) {
        order.push(spec)
        done.add(spec.name)
      }
    }
  }
  return order
}

/** 树表行级拓扑排序:_parentExportId 为空或父已就位的行优先,保证 parent 先于 child 落库 */
function topoSortTreeRows(rows: any[], strict = false): any[] {
  if (strict) {
    const identities = new Set<number>()
    for (const row of rows) {
      if (!Number.isSafeInteger(row?._exportId) || identities.has(row._exportId)) {
        throw new Error('[deriveImport] reader tree portable identity missing or duplicated')
      }
      identities.add(row._exportId)
    }
    for (const row of rows) {
      if (row._parentExportId != null && (!Number.isSafeInteger(row._parentExportId) ||
          !identities.has(row._parentExportId))) {
        throw new Error('[deriveImport] reader tree parent reference missing')
      }
    }
  }
  const sorted: any[] = []
  const placed = new Set<number>()
  let guard = 0
  while (sorted.length < rows.length) {
    if (guard++ > rows.length + 2) {
      if (strict) throw new Error('[deriveImport] reader tree cycle or invalid parent ordering')
      for (const r of rows) if (!placed.has(r._exportId)) sorted.push(r) // legacy fallback
      break
    }
    for (const r of rows) {
      if (placed.has(r._exportId)) continue
      if (r._parentExportId == null || placed.has(r._parentExportId)) {
        sorted.push(r)
        placed.add(r._exportId)
      }
    }
  }
  return sorted
}

function patchSelfIdPaths(obj: Record<string, any>, paths: string[], newId: number): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const path of paths) {
    const [root, ...rest] = path.split('.')
    if (!root || rest.length === 0 || obj[root] == null || typeof obj[root] !== 'object') continue
    // 导入输入本就是 JSON 契约，按 JSON 语义深拷贝可避免修改原始备份对象。
    const rootCopy = JSON.parse(JSON.stringify(obj[root]))
    let cursor: Record<string, any> = rootCopy
    for (const part of rest.slice(0, -1)) {
      if (cursor[part] == null || typeof cursor[part] !== 'object') cursor[part] = {}
      cursor = cursor[part]
    }
    cursor[rest[rest.length - 1]] = newId
    patch[root] = rootCopy
  }
  return patch
}


/**
 * 派生导入:把 ProjectExportData 写成一个新项目,返回新项目 id。
 * 与手写 importProjectJSON 行为一致(往返完整性由 R-export-fullcoverage 锁死)。
 */
export async function deriveImportProjectJSON(data: ProjectExportData, options: ProjectImportOptionsV1 = {}): Promise<number> {
  const finalizeInTransaction = options.finalizeInTransaction
  if (!data.project) throw new Error('无效的导出文件格式')
  data = normalizeProjectBackup(data)
  await validateCurrentBackup(data)
  await assertNarrativeLineageRowsV1(new Map([
    ['worlds', data.worlds as unknown as Record<string, unknown>[]],
    ['worldDerivations', data.worldDerivations as unknown as Record<string, unknown>[]],
  ]), 'portable')
  const now = Date.now()
  const specs = PROJECT_TABLES.filter(s => s.exportable && s.name !== 'projects')
  const order = deriveImportOrder(specs)
  const projectSpec = PROJECT_TABLES.find(spec => spec.name === 'projects')
  if (!projectSpec) throw new Error('[deriveImport] PROJECT_TABLES 缺少 projects 根表')

  const importedProjectId = await db.transaction('rw', transactionTablesFor('importProject'), async () => {
    const projectData = data.project as unknown as Record<string, unknown>
    const pendingProjectRefs = new Map<string, number | null>()
    for (const rm of projectSpec.exportRemap ?? []) {
      const exportValue = projectData[rm.exportAs]
      pendingProjectRefs.set(rm.field, typeof exportValue === 'number' ? exportValue : null)
    }
    const requestedWorkspaceUid = projectData.workspaceUid
    const workspaceUidCollision = isWorkspaceUid(requestedWorkspaceUid)
      ? await db.projects.where('workspaceUid').equals(requestedWorkspaceUid).first()
      : null
    if (!isWorkspaceUid(requestedWorkspaceUid)) throw new Error('[deriveImport] workspaceUid 无效')
    const newProjectId = await db.projects.add({
      workspaceUid: workspaceUidCollision ? generateWorkspaceUid() : requestedWorkspaceUid,
      workspacePurpose: projectData.workspacePurpose,
      name: `${data.project.name}（导入）`,
      enableMultiWorld: projectData.enableMultiWorld,
      productPlatformOptIns: projectData.productPlatformOptIns,
      activeWorldId: null,
      activeWorkId: null,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const newIdMaps = new Map<string, Map<number, number>>()
    const deferredForeignKeys: Array<{ table: any; id: number; field: string; target: string; exportId: number; requireTarget: boolean }> = []
    const deferredNarrativeRefs: Array<{
      table: TableSpec['table']; id: number
      remap: Extract<ExportRefRemap, { kind: 'narrative-source-refs-v1' }>
      value: unknown
    }> = []
    const deferredJsonIdPaths: Array<{
      table: any
      tableName: string
      id: number
      remap: JsonIdPathsExportRefRemapV1
      portableRefs: unknown
    }> = []

    for (const spec of order) {
      const rawRows: any[] = (data as any)[spec.name]
      if (!Array.isArray(rawRows)) throw new Error(`[deriveImport] 当前备份缺少 ${spec.name}`)
      const rows = spec.tree ? topoSortTreeRows(rawRows, spec.name === 'readerSessions' || spec.name === 'readerTurns') : rawRows
      const newIdMap = new Map<number, number>()
      const pendingRefRemap: Array<{ newId: number; stashed: Record<string, any> }> = []

      let exportIndex = -1
      for (const row of rows) {
        exportIndex++
        const obj: any = { ...row }
        const exportId = obj._exportId
        delete obj._exportId

        // 外键:_exportAs → 真实 db id
        let dropRow = false
        let hasUnmappedKnowledgeRef = false
        let hasUnmappedTemporalSourceRef = false
        let hasUnmappedCultivationProgressRef = false
        const rowDeferredForeignKeys: Array<{ field: string; target: string; exportId: number; requireTarget: boolean }> = []
        for (const rm of spec.exportRemap ?? []) {
          const exportVal = obj[rm.exportAs]
          delete obj[rm.exportAs]
          let mappedId: number | null = null
          if (exportVal != null) {
            const m = rm.selfTree ? newIdMap : newIdMaps.get(rm.remapVia)
            const got = m?.get(exportVal)
            if (got == null) {
              if (spec.name === 'knowledgeLedger') hasUnmappedKnowledgeRef = true
              if (spec.name === 'cultivationProgress') hasUnmappedCultivationProgressRef = true
              if (spec.name === 'temporalFacts' && rm.field.startsWith('source')) {
                hasUnmappedTemporalSourceRef = true
              }
              if (rm.onUnmapped === 'drop') { dropRow = true; break }
              // A present, nullable cyclic FK is NOT optional evidence: it
              // may be resolved after all tables exist, but must never vanish.
              // The legacy importer treated all unresolved non-tree pointers
              // as best effort and silently left them null after the second pass.
              if (rm.onUnmapped === 'require' && !rm.deferImport) {
                throw new Error(`[deriveImport] 缺失必填外键映射:${spec.name}.${rm.field}=${exportVal}`)
              }
              if (!rm.selfTree) {
                rowDeferredForeignKeys.push({ field: rm.field, target: rm.remapVia,
                  exportId: exportVal, requireTarget: rm.onUnmapped === 'require' })
              }
            }
            mappedId = got ?? null
          }
          obj[rm.field] = mappedId
        }
        if (dropRow) continue
        restoreCurrentOwner(spec, obj, newIdMaps)
        if (spec.name === 'extensionProfiles') obj.enabled = false
        if (spec.name.startsWith('extension')) {
          const extensionOwner = obj.worldId != null ? await db.worlds.get(obj.worldId) : await db.works.get(obj.workId)
          if (!extensionOwner) throw new Error('插件数据缺少作用域根')
          obj.ownerKey = `${obj.worldId != null ? 'world' : 'work'}:${extensionOwner.code}`
          if (spec.name === 'extensionRecords') {
            if (obj.chapterId != null) {
              const referenced = await db.chapters.get(obj.chapterId) as unknown as { workId: number } | undefined
              if (!referenced || referenced.workId !== obj.workId) throw new Error('插件章节引用跨作品')
            }
            if (obj.historyEventId != null) {
              const referenced = await db.historicalTimelineEvents.get(obj.historyEventId) as unknown as { worldId: number } | undefined
              if (!referenced || referenced.worldId !== obj.worldId) throw new Error('插件历史引用跨世界')
            }
          }
        }
        if (spec.name === 'knowledgeLedger' && hasUnmappedKnowledgeRef && obj.status !== 'rejected') {
          obj.status = 'source-missing'
        }
        if (spec.name === 'cultivationProgress' && hasUnmappedCultivationProgressRef) {
          obj.status = 'source-missing'
        }
        if (spec.name === 'temporalFacts' && hasUnmappedTemporalSourceRef
          && obj.status !== 'rejected' && obj.status !== 'superseded') {
          obj.status = 'source-missing'
        }
        if (spec.name === 'temporalFacts' && obj.sourceType === 'setting' && obj.sourceFingerprint
          && obj.sourceWorldviewId == null && obj.sourcePowerSystemId == null
          && obj.sourceCultivationSystemId == null
          && obj.sourceStoryCoreId == null && obj.sourceCharacterId == null
          && obj.status !== 'rejected' && obj.status !== 'superseded') {
          obj.status = 'source-missing'
        }
        if (spec.name === 'productRuntimeCheckpoints') {
          // The only supported legacy checkpoint form omitted purpose entirely.
          // Persist its explicit current equivalent after strict backup validation.
          if (obj.purpose === undefined) obj.purpose = 'manual'
          if (obj.subjectKey === undefined) obj.subjectKey = null
        }

        if (spec.owner === 'project') obj.projectId = newProjectId
        if (spec.portableData?.kind === 'exact-run-artifact') {
          await Dexie.waitFor(assertAgentRunArtifactRecordIntegrityV1(obj))
        }

        if (spec.portableData?.kind === 'agent-run-root') {
          const contractIdMaps = new Map(newIdMaps)
          // Agent runs are a lineage tree. A child contract may reference the
          // already-imported parent in this same table before the table map is
          // published after the row loop.
          contractIdMaps.set(spec.name, newIdMap)
          const rebound = await Dexie.waitFor(rebindPortableAgentRunContractV1({
            contractJson: obj[spec.portableData.contractField],
            contractHash: obj[spec.portableData.contractHashField],
            projectId: newProjectId,
            idMaps: contractIdMaps,
          }))
          obj[spec.portableData.contractField] = rebound.contractJson
          obj[spec.portableData.contractHashField] = rebound.contractHash
        }
        if (spec.name === 'characters' && !isCompleteCharacterAxes(obj)) {
          throw new Error(`[deriveImport] 角色「${String(obj.name ?? '')}」缺少当前三轴分类`)
        }

        // JSON 引用字段(portals)先剥离,待全表映射建好后两阶段回填
        let stashed: Record<string, any> | null = null
        if ((spec.exportRefRemap ?? []).length > 0) {
          stashed = {}
          for (const rr of spec.exportRefRemap!) {
            if (rr.kind === 'portals') {
              stashed[rr.field] = obj[rr.field]
              delete obj[rr.field]
            } else {
              stashed[rr.exportAs] = obj[rr.exportAs]
              delete obj[rr.exportAs]
            }
          }
        }

        const newId = await (db as any)[spec.name].add(obj) as number
        for (const deferred of rowDeferredForeignKeys) {
          deferredForeignKeys.push({ table: (db as any)[spec.name], id: newId, ...deferred })
        }
        if (spec.selfIdPaths?.length) {
          const selfPatch = patchSelfIdPaths(obj, spec.selfIdPaths, newId)
          if (Object.keys(selfPatch).length > 0) {
            await (db as any)[spec.name].update(newId, selfPatch)
          }
        }
        const key = spec.exportIdField ? exportId : exportIndex
        if (key != null) newIdMap.set(key, newId)
        if (stashed) pendingRefRemap.push({ newId, stashed })
      }

      // 两阶段:JSON 引用重映射(portals 自引用,需本表 newIdMap 已全)
      for (const rr of spec.exportRefRemap ?? []) {
        if (rr.kind === 'narrative-source-refs-v1') {
          // Always wait for every table. An event may reference several target
          // kinds, including a forward event or a chapter referring back to it.
          for (const pending of pendingRefRemap) {
            const value = pending.stashed[rr.exportAs]
            if (value !== undefined) deferredNarrativeRefs.push({ table: spec.table, id: pending.newId, remap: rr, value })
          }
        } else if (rr.kind === 'portals') {
          const refMap = rr.remapVia === spec.name ? newIdMap : (newIdMaps.get(rr.remapVia) ?? newIdMap)
          for (const p of pendingRefRemap) {
            const remapped = remapWorldPortalTargets(p.stashed[rr.field], (exportId: number) => refMap.get(exportId))
            // Import reconstructs the same formal record under new local IDs;
            // reference remapping must not manufacture a new author edit time.
            if (remapped) await (db as any)[spec.name].update(p.newId, { [rr.field]: remapped })
          }
        } else {
          const refMap = newIdMaps.get(rr.remapVia)
          if (!refMap) {
            if (rr.kind === 'json-id-paths') {
              for (const pending of pendingRefRemap) {
                const portableRefs = pending.stashed[rr.exportAs]
                if (portableRefs == null) continue
                deferredJsonIdPaths.push({
                  table: (db as any)[spec.name],
                  tableName: spec.name,
                  id: pending.newId,
                  remap: rr,
                  portableRefs,
                })
              }
            }
            continue
          }
          for (const pending of pendingRefRemap) {
            const portableRefs = pending.stashed[rr.exportAs]
            if (portableRefs == null) continue
            const patch = rr.kind === 'id-array'
              ? remapPortableIdArray(
                  portableRefs,
                  refMap,
                  rr.storage === 'json-string',
                  rr.onUnmapped === 'require',
                  `${spec.name}.${rr.field}`,
                )
              : rr.kind === 'scene-character-ids'
                ? await remapSceneCharacterIndexes((db as any)[spec.name], pending.newId, rr.field, portableRefs, refMap)
                : rr.kind === 'object-array-id'
                  ? await remapObjectArrayIdIndexes(
                    (db as any)[spec.name],
                    pending.newId,
                    rr.field,
                    portableRefs,
                    refMap,
                    rr.itemField,
                    rr.storage === 'json-string',
                  )
                  : remapPortableJsonIdPaths(
                    portableRefs,
                    rr.paths,
                    refMap,
                    rr.onUnmapped ?? 'null',
                    `${spec.name}.${rr.field}`,
                    rr.keyedMaps,
                  )
            if (patch !== undefined) {
              await (db as any)[spec.name].update(pending.newId, { [rr.field]: patch })
            }
          }
        }
      }

      newIdMaps.set(spec.name, newIdMap)
    }

    for (const deferred of deferredNarrativeRefs) {
      const value = remapNarrativeDomainFieldV1(deferred.remap.field, deferred.value, 'import', newIdMaps)
      await deferred.table.update(deferred.id, { [deferred.remap.field]: value })
    }
    for (const deferred of deferredForeignKeys) {
      const mapped = newIdMaps.get(deferred.target)?.get(deferred.exportId)
      if (mapped == null && deferred.requireTarget) {
        throw new Error(`[deriveImport] 缺失延迟外键映射:${deferred.field} -> ${deferred.target}[${deferred.exportId}]`)
      }
      if (mapped != null) await deferred.table.update(deferred.id, { [deferred.field]: mapped })
    }
    for (const deferred of deferredJsonIdPaths) {
      const refMap = newIdMaps.get(deferred.remap.remapVia)
      if (!refMap) {
        throw new Error(`[deriveImport] ${deferred.tableName}.${deferred.remap.field} 缺少引用表映射`)
      }
      const patch = remapPortableJsonIdPaths(
        deferred.portableRefs,
        deferred.remap.paths,
        refMap,
        deferred.remap.onUnmapped ?? 'null',
        `${deferred.tableName}.${deferred.remap.field}`,
        deferred.remap.keyedMaps,
      )
      if (patch !== undefined) {
        await deferred.table.update(deferred.id, { [deferred.remap.field]: patch })
      }
    }

    // Reject cross-session and cross-Work reader edges while the same wide
    // import transaction can still roll back every imported record.
    await assertImportedReaderGraphV1(newProjectId)

    const projectPatch: Record<string, number | null> = {}
    for (const rm of projectSpec.exportRemap ?? []) {
      const exportValue = pendingProjectRefs.get(rm.field)
      projectPatch[rm.field] = exportValue == null
        ? null
        : (newIdMaps.get(rm.remapVia)?.get(exportValue) ?? null)
    }
    if (Object.keys(projectPatch).length > 0) {
      await db.projects.update(newProjectId, projectPatch as any)
    }

    const agentRunIds = [...(newIdMaps.get('agentRuns')?.values() ?? [])]
    if (agentRunIds.length > 0) {
      await finalizeImportedAgentRunLedgersV1({
        projectId: newProjectId,
        runIds: agentRunIds,
        idMaps: newIdMaps,
      })
    }

    if (finalizeInTransaction) await Dexie.Promise.resolve(finalizeInTransaction(newProjectId))
    return newProjectId
  })
  return importedProjectId
}

function remapPortableJsonIdPaths(
  value: unknown,
  paths: readonly string[],
  idMap: Map<number, number>,
  onUnmapped: 'require' | 'require-if-present' | 'null',
  label: string,
  keyedMaps?: readonly { path: string; keyFields: readonly string[]; separator: string }[],
): string | null | undefined {
  if (value == null) return value === null ? null : undefined
  let parsed: unknown
  try { parsed = typeof value === 'string' ? JSON.parse(value) : structuredClone(value) } catch {
    throw new Error(`[deriveImport] ${label} 不是合法便携 JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`[deriveImport] ${label} 必须是 JSON 对象`)
  }
  for (const path of paths) {
    const parts = path.split('.').filter(Boolean)
    const field = parts[parts.length - 1]
    if (!field) continue
    const owners: Array<Record<string, unknown>> = []
    const visit = (value: unknown, index: number): void => {
      if (!value || typeof value !== 'object') {
        if (onUnmapped === 'require') throw new Error(`[deriveImport] ${label}.${path} 缺失`)
        return
      }
      const part = parts[index]
      if (Array.isArray(value)) {
        if (part === '*') {
          for (const child of value) visit(child, index + 1)
          return
        }
        if (onUnmapped === 'require') throw new Error(`[deriveImport] ${label}.${path} 缺失`)
        return
      }
      const owner = value as Record<string, unknown>
      if (index >= parts.length - 1) {
        owners.push(owner)
        return
      }
      if (part === '*') {
        for (const child of Object.values(owner)) visit(child, index + 1)
        return
      }
      if (!(part in owner)) {
        if (onUnmapped === 'require') throw new Error(`[deriveImport] ${label}.${path} 缺失`)
        return
      }
      visit(owner[part], index + 1)
    }
    visit(parsed, 0)
    for (const owner of owners) {
      if (!(field in owner)) {
        if (onUnmapped === 'require') throw new Error(`[deriveImport] ${label}.${path} 缺失`)
        if (onUnmapped === 'require-if-present') continue
      }
      const portableId = owner[field]
      if (portableId == null) {
        if (onUnmapped !== 'null') {
          throw new Error(`[deriveImport] ${label}.${path} 缺少本地映射`)
        }
        owner[field] = null
        continue
      }
      const localId = typeof portableId === 'number' ? idMap.get(portableId) : undefined
      if (localId == null && onUnmapped !== 'null') {
        throw new Error(`[deriveImport] ${label}.${path} 缺少本地映射`)
      }
      owner[field] = localId ?? null
    }
  }
  for (const keyed of keyedMaps ?? []) {
    const parts = keyed.path.split('.').filter(Boolean)
    let owner = parsed as Record<string, unknown>
    let missing = false
    for (const part of parts.slice(0, -1)) {
      const child = owner[part]
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        if (onUnmapped === 'require-if-present') {
          missing = true
          break
        }
        throw new Error(`[deriveImport] ${label}.${keyed.path} keyed map 缺失`)
      }
      owner = child as Record<string, unknown>
    }
    if (missing) continue
    const field = parts[parts.length - 1]
    if (field && !(field in owner) && onUnmapped === 'require-if-present') continue
    const current = field ? owner[field] : undefined
    if (!field || !current || typeof current !== 'object' || Array.isArray(current)) {
      throw new Error(`[deriveImport] ${label}.${keyed.path} keyed map 无效`)
    }
    const rebuilt: Record<string, unknown> = {}
    for (const value of Object.values(current as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`[deriveImport] ${label}.${keyed.path} keyed map value 无效`)
      }
      const row = value as Record<string, unknown>
      const values = keyed.keyFields.map(key => row[key])
      if (values.some(candidate => typeof candidate !== 'string' && typeof candidate !== 'number')) {
        throw new Error(`[deriveImport] ${label}.${keyed.path} keyed map identity 无效`)
      }
      const key = values.map(String).join(keyed.separator)
      if (!key || key in rebuilt) {
        throw new Error(`[deriveImport] ${label}.${keyed.path} keyed map identity 重复`)
      }
      rebuilt[key] = value
    }
    owner[field] = rebuilt
  }
  return JSON.stringify(parsed)
}

function remapPortableIdArray(
  value: unknown,
  idMap: Map<number, number>,
  stringify: boolean,
  required = false,
  label = 'id-array',
): number[] | string {
  if (!Array.isArray(value)) {
    if (required) throw new Error(`[deriveImport] ${label} 必须是便携 ID 数组`)
    return stringify ? '[]' : []
  }
  const candidates = value.map(index => typeof index === 'number' ? idMap.get(index) : undefined)
  if (required && candidates.some(id => id == null)) {
    throw new Error(`[deriveImport] ${label} 缺少必填本地映射`)
  }
  const mapped = candidates.filter((id): id is number => id != null)
  return stringify ? JSON.stringify(mapped) : mapped
}

async function remapSceneCharacterIndexes(
  table: any,
  rowId: number,
  field: string,
  portableRefs: unknown,
  idMap: Map<number, number>,
): Promise<unknown[] | undefined> {
  if (!Array.isArray(portableRefs)) return undefined
  const row = await table.get(rowId)
  const scenes = row?.[field]
  if (!Array.isArray(scenes)) return undefined
  return scenes.map((scene: unknown, sceneIndex: number) => {
    if (!scene || typeof scene !== 'object') return scene
    const indexes = portableRefs[sceneIndex]
    const characterIds = Array.isArray(indexes)
      ? indexes.map(index => typeof index === 'number' ? idMap.get(index) : undefined).filter((id): id is number => id != null)
      : []
    return { ...(scene as Record<string, unknown>), characterIds }
  })
}

async function remapObjectArrayIdIndexes(
  table: any,
  rowId: number,
  field: string,
  portableRefs: unknown,
  idMap: Map<number, number>,
  itemField: string,
  stringify: boolean,
): Promise<Array<Record<string, unknown>> | string | undefined> {
  if (!Array.isArray(portableRefs)) return undefined
  const row = await table.get(rowId)
  let parsed: unknown = row?.[field]
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { return undefined }
  }
  if (!Array.isArray(parsed)) return undefined
  const items = parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const exportIndex = portableRefs[index]
    if (!(itemField in item) && exportIndex == null) return item
    return {
      ...(item as Record<string, unknown>),
      [itemField]: typeof exportIndex === 'number' ? (idMap.get(exportIndex) ?? null) : null,
    }
  })
  return stringify ? JSON.stringify(items) : items as Array<Record<string, unknown>>
}

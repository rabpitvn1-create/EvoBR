/**
 * PROJECT_TABLES 注册表·单一事实源
 *
 * 全部项目 Dexie 表的元信息登记在此。导出、导入、删除、作用域归属与
 * 引用重映射都从注册表派生（见 lifecycle.ts）。
 *
 * 加新表 = 在此登记 + schema.ts 声明 + types 定义，其它生命周期自动覆盖。
 *
 * 当前事实来源:本注册表 + schema.ts + ensure-schema.ts，三者由 CI 双向校验。
 * 禁止在该注册表之外手写第二份表清单。
 * 治理依据:docs/DATA-GOVERNANCE.md。
 */
import { db } from '../db/schema'
import { NARRATIVE_SOURCE_FKS_V1 } from '../types/narrative-domain'
import type { NarrativeDomainFieldsV1 } from '../types/narrative-domain'
import type { DomainOwnershipSpec, TableSpec, WorkspaceMemoryClassificationV1 } from './types'
import { parseSystemFictionElementsV1 } from '../prose/system-fiction-contract'
import { normalizeDetailedScenes } from '../types/detailed-outline'

const WORKSPACE_DOMAIN_OWNER = {
  allowed: ['workspace'], defaultOwner: 'workspace', locator: { kind: 'workspace' },
} as const satisfies DomainOwnershipSpec

const WORLD_DOMAIN_OWNER = {
  allowed: ['world'], defaultOwner: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' },
} as const satisfies DomainOwnershipSpec

const WORK_DOMAIN_OWNER = {
  allowed: ['work'], defaultOwner: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' },
} as const satisfies DomainOwnershipSpec

/** Reader child rows belong to a Work through their session, not by workId. */
const READER_CHILD_WORK_DOMAIN_OWNER = {
  allowed: ['work'], defaultOwner: 'work',
  locator: { kind: 'parent', owner: 'work', table: 'readerSessions', field: 'sessionId' },
} as const satisfies DomainOwnershipSpec

const WORLD_OR_WORK_DOMAIN_OWNER = {
  allowed: ['world', 'work'], defaultOwner: 'work', locator: {
    kind: 'exclusive-fields', worldField: 'worldId', workField: 'workId',
  },
} as const satisfies DomainOwnershipSpec

const RESOURCE_IDENTITY = (
  resourceKind: string,
  contextKind: NonNullable<TableSpec['resourceIdentity']>['contextKind'],
  label: string,
  descriptorMode: NonNullable<TableSpec['resourceIdentity']>['descriptorMode'] = 'semantic-fields',
) => ({
  version: 1 as const,
  field: 'ragDocumentId' as const,
  resourceKind,
  contextKind,
  label,
  descriptorMode,
})

const NARRATIVE_METADATA_FIELDS_V1 = [
  'narrativeTimeV1', 'narrativeEvidenceV1', 'narrativeVisibilityV1',
  'narrativeModalityV1', 'narrativeDependenciesV1', 'narrativeAuthorityV1',
] as const

function NARRATIVE_PROJECTOR_V1(
  kind: NonNullable<NonNullable<TableSpec['worldSemantic']>['projector']>['kind'],
  sourceFields: readonly string[],
  provenanceField: string,
  fields: readonly (keyof NarrativeDomainFieldsV1)[],
) {
  return { projector: { version: 1 as const, kind, sourceFields, provenanceField,
    annotationFields: [...NARRATIVE_METADATA_FIELDS_V1, ...fields] },
    publishPolicy: 'reviewed-narrative-v1' as const }
}

type ProjectTableRegistration = Omit<TableSpec, 'memoryClassification'> & {
  memoryClassification?: WorkspaceMemoryClassificationV1
}

const PROJECT_TABLE_REGISTRATIONS: ProjectTableRegistration[] = [
// ───────────────────────── 项目根表 ─────────────────────────
  { table: db.projects, name: 'projects', owner: 'project', exportable: true,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    workspaceProjection: {
      version: 1, classification: 'editable', documentKind: 'workspace', mapper: 'workspace-root-v1',
      codec: 'json', editPolicy: 'author-editable', scopeOwner: 'workspace',
      dependencyEmitter: 'workspace-root-impact-v1', schemaVersion: 1,
    },
    exportRemap: [
      { field: 'activeWorldId', remapVia: 'worlds', exportAs: '_activeWorldExportId' },
      { field: 'activeWorkId', remapVia: 'works', exportAs: '_activeWorkExportId' },
    ],
    note: 'LocalWorkspace 根；只承载工作区身份、产品目的与活动 World/Work 指针' },
{ table: db.worlds, name: 'worlds', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    workspaceProjection: {
      version: 1, classification: 'editable', documentKind: 'world', mapper: 'world-root-v1',
      codec: 'yaml', editPolicy: 'author-editable', scopeOwner: 'world',
      dependencyEmitter: 'world-root-impact-v1', schemaVersion: 1,
    },
    refs: [{ kind: 'simple', field: 'id', target: 'works[worldId]', onDelete: 'cascade' },
{ kind: 'simple', field: 'id', target: 'worldRevisions[worldId]', onDelete: 'cascade' },
{ kind: 'simple', field: 'id', target: 'worldReleases[worldId]', onDelete: 'cascade' },
{ kind: 'simple', field: 'id', target: 'worldDerivations[worldId]', onDelete: 'cascade' }],
    note: 'WORLD-2C 显式世界根；公开身份和世界版本的未来权威' },
{ table: db.works, name: 'works', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['world'], defaultOwner: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' } },
    workspaceProjection: {
      version: 1, classification: 'editable', documentKind: 'work', mapper: 'work-root-v1',
      codec: 'yaml', editPolicy: 'author-editable', scopeOwner: 'work',
      dependencyEmitter: 'work-root-impact-v1', schemaVersion: 1,
    },
    refs: [{ kind: 'simple', field: 'id', target: 'workCharacterBindings[workId]', onDelete: 'cascade' },
{ kind: 'simple', field: 'id', target: 'agentRuns[workId]', onDelete: 'cascade' }],
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'activeCharacterDrivenPlanId', remapVia: 'characterDrivenPlans',
        exportAs: '_activeCharacterDrivenPlanExportId' },
      { field: 'activeNarrativeModuleId', remapVia: 'narrativeModules',
        exportAs: '_activeNarrativeModuleExportId' },
    ],
    note: 'WORLD-2C 显式作品根；同一 World 可包含多部隔离作品' },
{ table: db.workCharacterBindings, name: 'workCharacterBindings', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('work-character-binding', 'character', '作品角色身份与弧光'),
    worldSemantic: { version: 1, area: 'characters', resourceKind: 'work-character-binding', canonPolicy: 'authoritative-table' },
    domainOwner: { allowed: ['work'], defaultOwner: 'work', locator: { kind: 'field', owner: 'work', field: 'workId' } },
    exportRemap: [
      { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_characterExportId', onUnmapped: 'require' },
    ],
    note: '角色身份保持世界级；本表只保存作品内角色作用投影' },
{ table: db.ownershipScopeChanges, name: 'ownershipScopeChanges', owner: 'transient', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    note: '作者显式改变 World/Work 作用域时追加的不可变审计事件，不保存内容载荷' },
{ table: db.workspaceDocuments, name: 'workspaceDocuments', owner: 'project', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    note: 'MEMORY-1 文件文档绑定与三方基线；不复制领域正文，可从正式表与磁盘 manifest 重建' },
{ table: db.worldRevisions, name: 'worldRevisions', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['world'], defaultOwner: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' } },
    tree: { parentField: 'parentRevisionId' },
    refs: [
      { kind: 'simple', field: 'id', target: 'worldReleases[revisionId]', onDelete: 'keep' },
      { kind: 'simple', field: 'id', target: 'worldDerivations[targetRevisionId]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'parentRevisionId', remapVia: 'worldRevisions', selfTree: true, exportAs: '_parentExportId' },
    ],
    note: 'WORLD-2E 可比较的世界草稿修订；manifest 为冻结快照' },
{ table: db.worldReleases, name: 'worldReleases', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['world'], defaultOwner: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' } },
    refs: [{ kind: 'simple', field: 'id', target: 'worldNarrativeIndexCaches[releaseId]', onDelete: 'cascade' },
{ kind: 'simple', field: 'id', target: 'worldDerivations[targetReleaseId]', onDelete: 'setNull' }],
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'revisionId', remapVia: 'worldRevisions', exportAs: '_revisionExportId', onUnmapped: 'require' },
    ],
    note: 'WORLD-2E 不可变发布版本；运行实例只绑定该记录或显式草稿快照' },
{ table: db.worldNarrativeIndexCaches, name: 'worldNarrativeIndexCaches', owner: 'project', exportable: false,
    domainOwner: { allowed: ['world'], defaultOwner: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' } },
    note: 'NW-2A 可删除重建的冻结世界索引缓存；绑定 release FK，不导出、不成为世界语义或 AI 写目标；删除只清缓存' },
{ table: db.worldDerivations, name: 'worldDerivations', owner: 'project', exportable: true, exportIdField: true,
    domainOwner: { allowed: ['world'], defaultOwner: 'world', locator: { kind: 'field', owner: 'world', field: 'worldId' } },
    exportRemap: [
      { field: 'worldId', remapVia: 'worlds', exportAs: '_worldExportId', onUnmapped: 'require' },
      { field: 'targetRevisionId', remapVia: 'worldRevisions', exportAs: '_targetRevisionExportId' },
      { field: 'targetReleaseId', remapVia: 'worldReleases', exportAs: '_targetReleaseExportId' },
    ],
    defaults: { targetRevisionId: null, targetReleaseId: null },
    note: 'ARCH-01 长短篇派生及 NW-2A 世界包复制的不可变来源；可选 narrativeLineageJson 使用独立版本与 hash，绑定新 World namespace，不是 AI 写目标；源仅以便携身份引用，删除本地修订/发布清空 locator 并保留来源回执' },
// ───────────────────── 世界观/设定(world-scoped 多)─────────────────────
  { table: db.worldviews, name: 'worldviews', owner: 'project', worldScoped: true,
    resourceIdentity: RESOURCE_IDENTITY('worldview', 'worldview-field', '世界观', 'registered-fields'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'worldview', canonPolicy: 'authoritative-table' },
    domainOwner: WORLD_DOMAIN_OWNER,
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },
{ table: db.storyCores, name: 'storyCores', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('story-core', 'story-core-field', '故事核心', 'registered-fields'),
    worldSemantic: { version: 1, area: 'story', resourceKind: 'story-core', canonPolicy: 'authoritative-table' },
    domainOwner: WORK_DOMAIN_OWNER,
    workspaceProjection: {
      version: 1, classification: 'editable', documentKind: 'story-core', mapper: 'work-semantic-v1',
      codec: 'yaml', editPolicy: 'author-editable', scopeOwner: 'work',
      dependencyEmitter: 'work-semantic-impact-v1', schemaVersion: 1,
    },
    refs: [
      { kind: 'simple', field: 'id', target: 'storyArcs[sourceStoryCoreId]', onDelete: 'setNull' },
    ],
    note: '每个 Work 一份故事核心，必须拥有明确 Work 身份' },
{ table: db.powerSystems, name: 'powerSystems', owner: 'project', worldScoped: true,
    resourceIdentity: RESOURCE_IDENTITY('power-system', 'worldview-field', '力量体系'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'power-system', canonPolicy: 'authoritative-table' },
    domainOwner: WORLD_DOMAIN_OWNER,
    exportable: true,
    refs: [{ kind: 'simple', field: 'id', target: 'characters[powerSystemId]', onDelete: 'setNull' }],
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },
{ table: db.cultivationSystems, name: 'cultivationSystems', owner: 'project', worldScoped: true,
    resourceIdentity: RESOURCE_IDENTITY('cultivation-system', 'worldview-field', '修炼体系'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'cultivation-system', canonPolicy: 'authoritative-table' },
    domainOwner: WORLD_DOMAIN_OWNER,
    exportable: true, exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'characters[cultivationSystemId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'codexEntries[cultivationSystemId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'temporalFacts[sourceCultivationSystemId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'cultivationProgress[cultivationSystemId]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
    ],
    defaults: { description: '', stages: '[]' },
    note: 'Phase 37 修炼流派；stages 为已校验 DAG，区别于世界底层 powerSystems' },
{ table: db.cultivationProgress, name: 'cultivationProgress', owner: 'project', worldScoped: true,
    resourceIdentity: RESOURCE_IDENTITY('cultivation-progress', 'fact', '修炼进度'),
    worldSemantic: { version: 1, area: 'story', resourceKind: 'cultivation-progress', canonPolicy: 'confirmed-rows-only', statusField: 'status', confirmedStatusValues: ['confirmed'] },
    domainOwner: WORK_DOMAIN_OWNER,
    exportable: true,
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_characterExportId' },
      { field: 'cultivationSystemId', remapVia: 'cultivationSystems', exportAs: '_cultivationSystemExportId' },
      { field: 'sourceChapterId', remapVia: 'chapters', exportAs: '_sourceChapterExportId' },
    ],
    defaults: { status: 'confirmed', sourceOffset: 0, trigger: '' },
    note: 'Phase 34 作者确认的正文修炼事件；当前境界与实际路径按规范章序实时投影，软引用缺失时保留冗余名称与证据' },
{ table: db.geographies, name: 'geographies', owner: 'project', worldScoped: true,
    resourceIdentity: RESOURCE_IDENTITY('geography', 'worldview-field', '地理环境'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'geography', canonPolicy: 'authoritative-table' },
    domainOwner: WORLD_DOMAIN_OWNER,
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },
{ table: db.histories, name: 'histories', owner: 'project', worldScoped: true,
    resourceIdentity: RESOURCE_IDENTITY('history', 'worldview-field', '历史'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'history', canonPolicy: 'authoritative-table' },
    domainOwner: WORLD_DOMAIN_OWNER,
    exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },
{ table: db.worldNodes, name: 'worldNodes', owner: 'project', worldScoped: true,
    resourceIdentity: RESOURCE_IDENTITY('world-node', 'location', '世界节点'),
    worldSemantic: { version: 1, area: 'entities', resourceKind: 'world-node', canonPolicy: 'authoritative-table' },
    domainOwner: WORLD_DOMAIN_OWNER,
    exportable: true, tree: { parentField: 'parentId' }, exportIdField: true,
    refs: [
      { kind: 'json', field: 'portalsJSON', jsonPath: '$[].targetWorldId', target: 'worldNodes[id]', onDelete: 'remap' },
    ],
    exportRemap: [
      { field: 'parentId', remapVia: 'worldNodes', selfTree: true, exportAs: '_parentExportId' },
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
    ],
    exportRefRemap: [{ field: 'portalsJSON', remapVia: 'worldNodes', kind: 'portals' }],
    note: 'portalsJSON 内含指向其它节点的引用' },
{ table: db.historicalTimelineEvents, name: 'historicalTimelineEvents', owner: 'project',
    refs: [],
    resourceIdentity: RESOURCE_IDENTITY('historical-event', 'fact', '历史事件'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'historical-event', canonPolicy: 'authoritative-table', ...NARRATIVE_PROJECTOR_V1('event', ['title', 'description', 'date', 'year'], 'description', ['narrativeEventV1']) },
    domainOwner: WORLD_DOMAIN_OWNER,
    worldScoped: true, exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },
{ table: db.historicalKeywords, name: 'historicalKeywords', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('historical-keyword', 'fact', '历史关键词'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'historical-keyword', canonPolicy: 'authoritative-table' },
    domainOwner: WORLD_DOMAIN_OWNER,
    worldScoped: true, exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }] },
{ table: db.importantLocations, name: 'importantLocations', owner: 'project',
    resourceIdentity: { ...RESOURCE_IDENTITY('location', 'location', '重要地点'), narrativeEntityType: 'location' },
    worldSemantic: { version: 1, area: 'entities', resourceKind: 'location', canonPolicy: 'authoritative-table', ...NARRATIVE_PROJECTOR_V1('entity', ['name'], 'name', ['narrativeAliasesV1']) },
    domainOwner: WORLD_DOMAIN_OWNER,
    exportable: true, tree: { parentField: 'parentId' }, exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'codexEntries[importantLocationId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'characters[importantLocationId]', onDelete: 'setNull' },
    ],
    exportRemap: [{ field: 'parentId', remapVia: 'importantLocations', selfTree: true, exportAs: '_parentExportId' }],
    note: '⚠️ 无 worldGroupId,当前全局注入写作上下文；城池词条可通过 importantLocationId 建立软引用' },
{ table: db.worldRulesProfiles, name: 'worldRulesProfiles', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('world-rules', 'worldview-field', '世界规则'),
    worldSemantic: { version: 1, area: 'foundation', resourceKind: 'world-rules', canonPolicy: 'authoritative-table' },
    domainOwner: WORLD_DOMAIN_OWNER,
    worldScoped: true, exportable: true,
    exportRemap: [{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' }],
    note: '真实与幻想规则每世界一套;null 为单世界/默认主世界' },
// ───────────────────── 角色 ─────────────────────
  { table: db.characters, name: 'characters', owner: 'project', homeWorldScoped: true,
    resourceIdentity: { ...RESOURCE_IDENTITY('character', 'character', '角色', 'registered-fields'), narrativeEntityType: 'character' },
    worldSemantic: { version: 1, area: 'characters', resourceKind: 'character', canonPolicy: 'authoritative-table', ...NARRATIVE_PROJECTOR_V1('entity', ['name'], 'name', ['narrativeAliasesV1']) },
    domainOwner: WORLD_DOMAIN_OWNER,
    exportable: true,
    defaults: { narrativeStatus: 'active' },
    refs: [// 删角色 → 关系级联删 + 细纲数组引用清理
      { kind: 'simple', field: 'id', target: 'characterRelations[fromCharacterId]', onDelete: 'cascade' },
{ kind: 'simple', field: 'id', target: 'characterRelations[toCharacterId]', onDelete: 'cascade' },
{ kind: 'simple', field: 'id', target: 'chapters[perspectiveCharacterId]', onDelete: 'setNull' },
{ kind: 'simple', field: 'id', target: 'narrativeBeats[speakerCharacterId]', onDelete: 'setNull' },
{ kind: 'simple', field: 'id', target: 'itemLedger[characterId]', onDelete: 'setNull' },
{ kind: 'array', field: 'appearingCharacterIds', itemTarget: 'detailedOutlines', onDelete: 'removeItem' }],
    exportRemap: [
      { field: 'homeWorldGroupId', remapVia: 'worldGroups', exportAs: '_homeWorldGroupExportId' },
      { field: 'raceEntryId', remapVia: 'codexEntries', exportAs: '_raceEntryExportId' },
      { field: 'cultivationSystemId', remapVia: 'cultivationSystems', exportAs: '_cultivationSystemExportId' },
      { field: 'powerSystemId', remapVia: 'powerSystems', exportAs: '_powerSystemExportId' },
      { field: 'importantLocationId', remapVia: 'importantLocations', exportAs: '_importantLocationExportId' },
      { field: 'statusEvidenceChapterId', remapVia: 'chapters', exportAs: '_statusEvidenceChapterExportId', deferred: true },
      { field: 'statusEvidenceStoryArcId', remapVia: 'storyArcs', exportAs: '_statusEvidenceStoryArcExportId', deferred: true },
    ] },
{ table: db.characterRelations, name: 'characterRelations', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('character-relation', 'character-relation', '角色关系'),
    worldSemantic: { version: 1, area: 'relations', resourceKind: 'character-relation', canonPolicy: 'authoritative-table', ...NARRATIVE_PROJECTOR_V1('relation', ['fromCharacterId', 'toCharacterId', 'relationType', 'label', 'description', 'isBidirectional'], 'description', ['narrativeRelationV1']) },
    domainOwner: WORLD_DOMAIN_OWNER,
    exportable: true,
    exportRemap: [
      { field: 'fromCharacterId', remapVia: 'characters', exportAs: '_fromCharacterIndex', onUnmapped: 'drop' },
      { field: 'toCharacterId', remapVia: 'characters', exportAs: '_toCharacterIndex', onUnmapped: 'drop' },
    ] },
// (factions 表已于 DB v29 并入 codex.faction 词条并删除)

  // ───────────────────── 大纲 / 章节 / 细纲 ─────────────────────
  { table: db.outlineNodes, name: 'outlineNodes', owner: 'project', worldScoped: true,
    resourceIdentity: RESOURCE_IDENTITY('outline-node', 'outline-node', '大纲节点'),
    worldSemantic: { version: 1, area: 'outline', resourceKind: 'outline-node', canonPolicy: 'authoritative-table' },
    domainOwner: WORLD_OR_WORK_DOMAIN_OWNER,
    exportable: true, tree: { parentField: 'parentId' }, exportIdField: true,
    // summary 是非可选字段,但老数据/跨版本导入的 JSON 可能整体缺该键 → 导入兜成 ''，
    // 保证 OutlineNode.summary 不变量(恒为 string),读取处无需散补 `?.`。
    defaults: { summary: '' },
    refs: [{ kind: 'simple', field: 'id', target: 'chapters[outlineNodeId]', onDelete: 'cascade' },
{ kind: 'simple', field: 'id', target: 'detailedOutlines[outlineNodeId]', onDelete: 'cascade' }],
    exportRemap: [
      { field: 'parentId', remapVia: 'outlineNodes', selfTree: true, exportAs: '_parentExportId' },
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
    ] },
{ table: db.chapters, name: 'chapters', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('chapter', 'chapter', '章节'),
    worldSemantic: { version: 1, area: 'manuscript', resourceKind: 'chapter', canonPolicy: 'authoritative-table', ...NARRATIVE_PROJECTOR_V1('disclosure', ['content', 'outlineNodeId'], 'content', ['narrativeDisclosuresV1']) },
    domainOwner: WORK_DOMAIN_OWNER,
    workspaceProjection: {
      version: 1, classification: 'editable', documentKind: 'chapter', mapper: 'chapter-markdown-v1',
      codec: 'markdown-frontmatter', editPolicy: 'author-editable', scopeOwner: 'work',
      dependencyEmitter: 'chapter-impact-v1', schemaVersion: 1,
    },
    selfIdPaths: ['continuityHandoff.chapterId', 'planReconciliation.chapterId'],
    refs: [{ kind: 'simple', field: 'id', target: 'emotionBeatCards[chapterId]', onDelete: 'cascade' },
{ kind: 'simple', field: 'id', target: 'characters[statusEvidenceChapterId]', onDelete: 'setNull' }],
    exportRemap: [
      { field: 'outlineNodeId', remapVia: 'outlineNodes', exportAs: '_outlineExportId', onUnmapped: 'require' },
      { field: 'perspectiveCharacterId', remapVia: 'characters', exportAs: '_perspectiveCharacterExportId' },
    ] },
{ table: db.detailedOutlines, name: 'detailedOutlines', owner: 'project', exportable: true,
    validateImportRow: row => { normalizeDetailedScenes(row.scenes) },
    resourceIdentity: RESOURCE_IDENTITY('detailed-outline', 'detailed-outline', '细纲'),
    worldSemantic: { version: 1, area: 'detailed-outline', resourceKind: 'detailed-outline', canonPolicy: 'authoritative-table' },
    domainOwner: WORLD_OR_WORK_DOMAIN_OWNER,
    refs: [
      { kind: 'array', field: 'appearingCharacterIds', itemTarget: 'characters', onDelete: 'removeItem' },
      { kind: 'array', field: 'foreshadowIds', itemTarget: 'foreshadows', onDelete: 'removeItem' },
      { kind: 'json', field: 'scenes', jsonPath: '$[].characterIds[]', target: 'characters[id]', onDelete: 'remap' },
    ],
    exportRefRemap: [
      { field: 'appearingCharacterIds', remapVia: 'characters', kind: 'id-array', exportAs: '_appearingCharacterIndexes' },
      { field: 'foreshadowIds', remapVia: 'foreshadows', kind: 'id-array', exportAs: '_foreshadowIndexes' },
      { field: 'scenes', remapVia: 'characters', kind: 'scene-character-ids', exportAs: '_sceneCharacterIndexes' },
    ],
    exportRemap: [{ field: 'outlineNodeId', remapVia: 'outlineNodes', exportAs: '_outlineExportId', onUnmapped: 'require' }] },
{ table: db.emotionBeatCards, name: 'emotionBeatCards', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('emotion-beat', 'fact', '情感节拍'),
    domainOwner: WORK_DOMAIN_OWNER,
    exportRemap: [{ field: 'chapterId', remapVia: 'chapters', exportAs: '_chapterExportId', onUnmapped: 'require' }] },
// ───────────────────── 下游产物 / 工具 ─────────────────────
  { table: db.foreshadows, name: 'foreshadows', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('foreshadow', 'foreshadow', '伏笔'),
    worldSemantic: { version: 1, area: 'story', resourceKind: 'foreshadow', canonPolicy: 'authoritative-table', ...NARRATIVE_PROJECTOR_V1('development', ['name', 'description', 'status', 'plantChapterId', 'resolveChapterId'], 'description', ['narrativeDevelopmentsV1']) },
    domainOwner: WORLD_OR_WORK_DOMAIN_OWNER,
    note: '可跨世界;plant/resolveChapterId 为软引用(删章不强删)' },
{ table: db.storyArcs, name: 'storyArcs', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('story-arc', 'story-arc', '故事线'),
    worldSemantic: { version: 1, area: 'storylines', resourceKind: 'story-arc', canonPolicy: 'authoritative-table', ...NARRATIVE_PROJECTOR_V1('development', ['name', 'description', 'stages', 'status'], 'description', ['narrativeDevelopmentsV1']) },
    domainOwner: WORLD_OR_WORK_DOMAIN_OWNER,
    exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'storylineProgress[arcId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'storylineCrossings[arcIdA]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'storylineCrossings[arcIdB]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'characters[statusEvidenceStoryArcId]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'sourceStoryCoreId', remapVia: 'storyCores', exportAs: '_sourceStoryCoreExportId' },
      { field: 'producerRunId', remapVia: 'agentRuns', exportAs: '_producerRunExportId' },
    ],
    defaults: { origin: 'manual', status: 'active' } },
{ table: db.narrativeModules, name: 'narrativeModules', owner: 'project', exportable: true, exportIdField: true,
    resourceIdentity: RESOURCE_IDENTITY('narrative-module', 'narrative-blueprint', '叙事蓝图'),
    domainOwner: WORLD_OR_WORK_DOMAIN_OWNER,
    refs: [
      { kind: 'simple', field: 'id', target: 'narrativeNodes[moduleId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'narrativeBeats[moduleId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'narrativeChoices[moduleId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'works[activeNarrativeModuleId]', onDelete: 'setNull' },
    ],
    defaults: { description: '', status: 'draft', sourceProjection: 'custom', entryNodeKey: null },
    note: 'WORLD-2D 主线/支线/任务/开局的单一可执行叙事来源' },
{ table: db.narrativeNodes, name: 'narrativeNodes', owner: 'project', exportable: true, exportIdField: true,
    resourceIdentity: RESOURCE_IDENTITY('narrative-node', 'narrative-blueprint', '叙事节点'),
    domainOwner: { allowed: ['world', 'work'], defaultOwner: 'work', locator: { kind: 'parent', owner: 'work', table: 'narrativeModules', field: 'moduleId' } },
    exportRemap: [
      { field: 'moduleId', remapVia: 'narrativeModules', exportAs: '_moduleExportId', onUnmapped: 'require' },
      { field: 'sourceOutlineNodeId', remapVia: 'outlineNodes', exportAs: '_sourceOutlineExportId' },
    ],
    defaults: { summary: '', conditionJson: '{}', effectsJson: '[]', successorKeysJson: '[]', order: 0 },
    note: 'WORLD-2D 条件、选择、效果、后继和结局节点' },
{ table: db.narrativeBeats, name: 'narrativeBeats', owner: 'project', exportable: true, exportIdField: true,
    resourceIdentity: RESOURCE_IDENTITY('narrative-beat', 'narrative-blueprint', '叙事节拍'),
    domainOwner: { allowed: ['world', 'work'], defaultOwner: 'work', locator: { kind: 'parent', owner: 'work', table: 'narrativeModules', field: 'moduleId' } },
    exportRemap: [
      { field: 'moduleId', remapVia: 'narrativeModules', exportAs: '_moduleExportId', onUnmapped: 'require' },
      { field: 'speakerCharacterId', remapVia: 'characters', exportAs: '_speakerCharacterExportId' },
    ],
    defaults: { speakerCharacterId: null, order: 0 },
    note: '长篇与世界设计蓝图节点内的有序旁白、对话、动作和系统提示；不属于上层产品发布或玩家进度' },
{ table: db.narrativeChoices, name: 'narrativeChoices', owner: 'project', exportable: true, exportIdField: true,
    resourceIdentity: RESOURCE_IDENTITY('narrative-choice', 'narrative-blueprint', '叙事选择'),
    domainOwner: { allowed: ['world', 'work'], defaultOwner: 'work', locator: { kind: 'parent', owner: 'work', table: 'narrativeModules', field: 'moduleId' } },
    exportRemap: [
      { field: 'moduleId', remapVia: 'narrativeModules', exportAs: '_moduleExportId', onUnmapped: 'require' },
    ],
    defaults: {
      description: '', unavailableReason: '', displayConditionJson: '{}',
      availableConditionJson: '{}', effectsJson: '[]', tagsJson: '[]', order: 0,
    },
    note: '上层产品正式内容选择；目标使用节点稳定 key，运行选择由 ProductRuntime 事件记录' },
{ table: db.characterDrivenPlans, name: 'characterDrivenPlans', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('character-driven-plan', 'narrative-blueprint', '角色驱动方案'),
    domainOwner: WORK_DOMAIN_OWNER,
    exportable: true, exportIdField: true, tree: { parentField: 'parentPlanId' },
    refs: [
      { kind: 'json', field: 'arcs', jsonPath: '$[].characterId', target: 'characters[id]', onDelete: 'remap' },
      { kind: 'simple', field: 'id', target: 'works[activeCharacterDrivenPlanId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'characterDrivenPlans[parentPlanId]', onDelete: 'setNull' },
    ],
    exportRemap: [{
      field: 'parentPlanId',
      remapVia: 'characterDrivenPlans',
      selfTree: true,
      exportAs: '_parentExportId',
    }],
    exportRefRemap: [{
      field: 'arcs',
      remapVia: 'characters',
      kind: 'object-array-id',
      exportAs: '_arcCharacterIndexes',
      itemField: 'characterId',
      storage: 'json-string',
    }],
    defaults: {
      arcs: '[]',
      userHint: '',
      generatedVolumes: '[]',
      status: 'draft',
      version: 1,
      parentPlanId: null,
    },
    note: 'CF-9C 项目级角色驱动设计方案；角色为软引用，删除后保留姓名/身份快照' },
{ table: db.storylineProgress, name: 'storylineProgress', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('storyline-progress', 'storyline-progress', '故事线进度'),
    worldSemantic: { version: 1, area: 'storylines', resourceKind: 'storyline-progress', canonPolicy: 'authoritative-table', ...NARRATIVE_PROJECTOR_V1('development', ['arcId', 'currentStageId', 'progressNote', 'status', 'lastActiveChapterId', 'evidenceQuote'], 'progressNote', ['narrativeDevelopmentsV1']) },
    domainOwner: WORK_DOMAIN_OWNER,
    exportable: true,
    defaults: { status: 'dormant', involvedEntities: '[]' },
    exportRemap: [
      { field: 'arcId', remapVia: 'storyArcs', exportAs: '_arcExportId', onUnmapped: 'require' },
      { field: 'lastActiveChapterId', remapVia: 'chapters', exportAs: '_lastChapterExportId' },
    ],
    note: 'Phase 39 已确认的故事线动态投影；每条 StoryArc 至多一行，删章保留标题并 NULL 化引用' },
{ table: db.storylineCrossings, name: 'storylineCrossings', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('storyline-crossing', 'storyline-progress', '故事线交汇'),
    worldSemantic: { version: 1, area: 'storylines', resourceKind: 'storyline-crossing', canonPolicy: 'authoritative-table' },
    domainOwner: WORK_DOMAIN_OWNER,
    exportable: true,
    exportRemap: [
      { field: 'arcIdA', remapVia: 'storyArcs', exportAs: '_arcAExportId', onUnmapped: 'require' },
      { field: 'arcIdB', remapVia: 'storyArcs', exportAs: '_arcBExportId', onUnmapped: 'require' },
      { field: 'chapterId', remapVia: 'chapters', exportAs: '_chapterExportId' },
    ],
    note: 'Phase 39 已确认的两条登记故事线交汇；删章保留证据与章节标题并 NULL 化引用' },
{ table: db.stateCards, name: 'stateCards', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('state-card', 'fact', '状态卡'),
    worldSemantic: { version: 1, area: 'entities', resourceKind: 'state-card', canonPolicy: 'authoritative-table' },
    domainOwner: WORK_DOMAIN_OWNER },
{ table: db.itemLedger, name: 'itemLedger', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('item-ledger', 'fact', '物品流水'),
    worldSemantic: { version: 1, area: 'entities', resourceKind: 'item-event', canonPolicy: 'authoritative-table' },
    domainOwner: WORK_DOMAIN_OWNER,
    defaults: { heldByName: '' },
    exportRemap: [
      { field: 'chapterId', remapVia: 'chapters', exportAs: '_chapterExportId' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_characterExportId' },
    ],
    note: 'chapterId 与 characterId 均为软引用；角色删除时 NULL 化 characterId、保留 heldByName' },
{ table: db.storyTimelineEvents, name: 'storyTimelineEvents', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('story-timeline-event', 'fact', '故事年表'),
    worldSemantic: { version: 1, area: 'story', resourceKind: 'story-timeline-event', canonPolicy: 'authoritative-table', ...NARRATIVE_PROJECTOR_V1('event', ['title', 'description', 'storyTime', 'chapterId'], 'description', ['narrativeEventV1']) },
    domainOwner: WORK_DOMAIN_OWNER,
    exportRemap: [{ field: 'chapterId', remapVia: 'chapters', exportAs: '_chapterExportId' }] },
{ table: db.notes, name: 'notes', owner: 'project', exportable: true,
    domainOwner: WORK_DOMAIN_OWNER },
{ table: db.creativeRules, name: 'creativeRules', owner: 'project', exportable: true,
    validateImportRow: row => {
      if (row.systemFictionElements !== undefined) parseSystemFictionElementsV1(row.systemFictionElements)
    },
    resourceIdentity: RESOURCE_IDENTITY('creative-rules', 'reference', '创作规则'),
    domainOwner: WORK_DOMAIN_OWNER,
    workspaceProjection: {
      version: 1, classification: 'editable', documentKind: 'creative-rules', mapper: 'work-semantic-v1',
      codec: 'yaml', editPolicy: 'author-editable', scopeOwner: 'work',
      dependencyEmitter: 'work-semantic-impact-v1', schemaVersion: 1,
    },
    refs: [
      { kind: 'array', field: 'citedReferenceIds', itemTarget: 'references', onDelete: 'removeItem' },
    ],
    exportRefRemap: [
      { field: 'citedReferenceIds', remapVia: 'references', kind: 'id-array', exportAs: '_citedReferenceIndexes', storage: 'json-string' },
    ] },
// (itemSystems 表已于 DB v29 并入 codex.artifact 词条并删除)

  // ───────────────────── 词条系统 ─────────────────────
  { table: db.codexCategories, name: 'codexCategories', owner: 'project',
    resourceIdentity: RESOURCE_IDENTITY('codex-category', 'codex-entry', '词条分类'),
    worldSemantic: { version: 1, area: 'entities', resourceKind: 'codex-category', canonPolicy: 'authoritative-table' },
    domainOwner: WORLD_DOMAIN_OWNER,
    exportable: true, tree: { parentField: 'parentId' }, exportIdField: true,
    refs: [{ kind: 'simple', field: 'id', target: 'codexEntries[categoryId]', onDelete: 'cascade' }],
    exportRemap: [
      { field: 'parentId', remapVia: 'codexCategories', selfTree: true, exportAs: '_parentExportId' },
    ],
    note: '分类 schema 属于当前 World 根，具体词条再按 worldGroupId 隔离' },
{ table: db.codexEntries, name: 'codexEntries', owner: 'project', worldScoped: true,
    resourceIdentity: { ...RESOURCE_IDENTITY('codex-entry', 'codex-entry', '设定词条'), narrativeEntityType: 'codex-entry' },
    worldSemantic: { version: 1, area: 'entities', resourceKind: 'codex-entry', canonPolicy: 'authoritative-table', ...NARRATIVE_PROJECTOR_V1('entity', ['name'], 'name', ['narrativeAliasesV1']) },
    domainOwner: WORLD_DOMAIN_OWNER,
    exportable: true,
    refs: [
      { kind: 'json', field: 'refs', jsonPath: '$.*', target: 'codexEntries[id]', onDelete: 'remap' },
      { kind: 'simple', field: 'id', target: 'characters[raceEntryId]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'categoryId', remapVia: 'codexCategories', exportAs: '_categoryExportId', onUnmapped: 'require' },
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'cultivationSystemId', remapVia: 'cultivationSystems', exportAs: '_cultivationSystemExportId' },
      { field: 'importantLocationId', remapVia: 'importantLocations', exportAs: '_importantLocationExportId' },
      { field: 'producerRunId', remapVia: 'agentRuns', exportAs: '_producerRunExportId', deferred: true },
    ],
    defaults: {
      origin: 'manual', sourceEvidenceQuotes: '[]', sourceContentHash: '',
      producerRunId: null, producerCandidateHash: null,
    } },
// ───────────────────── 文风学习（FB-5） ─────────────────────
  { table: db.userStyleProfiles, name: 'userStyleProfiles', owner: 'project', exportable: true,
    resourceIdentity: { ...RESOURCE_IDENTITY('user-style', 'reference', '作者文风'), enabledField: 'enabled' },
    domainOwner: WORK_DOMAIN_OWNER,
    note: '每个 Work 一份作者文风画像；由 projectId/worldId/workId 共同证明当前作用域' },
// ───────────────────── 增量灵感工作区（CM-1） ─────────────────────
  { table: db.inspirationWorkspaces, name: 'inspirationWorkspaces', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('inspiration-workspace', 'reference', '灵感工作区'),
    domainOwner: WORK_DOMAIN_OWNER,
    defaults: { fragments: '[]', versions: '[]' },
    note: '每项目一份有界灵感碎片与确认版本；未确认 AI 预览不落库' },
// ───────────────────── PLATFORM-2 创作过程层 ─────────────────────
  { table: db.agentConversations, name: 'agentConversations', owner: 'project',
    domainOwner: WORK_DOMAIN_OWNER,
    worldScoped: true, exportable: true, exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'agentEvents[conversationId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'agentRuns[conversationId]', onDelete: 'setNull' },
    ],
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
    ],
    defaults: { status: 'active' },
    note: 'AGENT-1 单一总对话；领域 Agent 只作为幕后事件，不形成前台标签' },
{ table: db.agentEvents, name: 'agentEvents', owner: 'project', exportable: true,
    domainOwner: WORK_DOMAIN_OWNER,
    exportRemap: [
      { field: 'conversationId', remapVia: 'agentConversations', exportAs: '_conversationExportId', onUnmapped: 'require' },
      { field: 'durableRunId', remapVia: 'agentRuns', exportAs: '_agentRunExportId' },
    ],
    defaults: { payload: '{}', durableRunId: null },
    note: 'Agent 追加事件流：消息/计划/任务/候选/确认/错误；durableRunId 由 PROJECT_TABLES 统一重映射，未确认候选不属于 Canon' },
{ table: db.agentRuns, name: 'agentRuns', owner: 'project',
    // portableWorldContextBindingsJson is opaque hash/UID evidence: row lifecycle
    // carries it unchanged; it contains no local ID requiring reference remapping.
    // portableRuntimeOriginJson likewise preserves historical bytes. Its original
    // numeric identities are evidence only and MUST NOT be remapped or used as locators.
    // portablePublishedRootOriginJson carries the exact historical published RootV2
    // preimage unchanged; strict backup hooks validate it, not reference remapping.
    domainOwner: WORK_DOMAIN_OWNER,
    worldScoped: true, exportable: true, exportIdField: true,
    tree: { parentField: 'parentRunId' },
    refs: [
      { kind: 'simple', field: 'id', target: 'agentRuns[parentRunId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'agentRunEvents[runId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'agentRunCheckpoints[runId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'agentEvents[durableRunId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'storyArcs[producerRunId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'codexEntries[producerRunId]', onDelete: 'setNull' },
      { kind: 'simple', field: 'id', target: 'workspaceDocuments[lastSyncRunId]', onDelete: 'setNull' },
    ],
    exportRemap: [{ field: 'parentRunId', remapVia: 'agentRuns', selfTree: true, exportAs: '_parentExportId' },
{ field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
{ field: 'conversationId', remapVia: 'agentConversations', exportAs: '_conversationExportId' }],
    portableData: {
      kind: 'agent-run-root',
      contractField: 'contractJson',
      contractHashField: 'contractHash',
      dependencies: ['worldGroups', 'chapters', 'outlineNodes'],
    },
    defaults: {
      status: 'planned',
      contractVersion: 1,
      generation: 1,
      lastSequence: 0,
      projectionJson: '{}',
      terminalReceiptHash: null,
      parentRunId: null,
      parentRelation: null,
      parentReceiptHash: null,
      parentArtifactHash: null,
      productRuntimeSessionId: null,
      productBuildId: null,
    },
    note: 'HARNESS-1/21/RUNTIME-1 durable run 根；Work/Instance owner 恰好二选一，复用严格事件投影与恢复，不保存隐藏推理' },
{ table: db.agentRunEvents, name: 'agentRunEvents', owner: 'project',
    domainOwner: { allowed: ['work', 'instance'], defaultOwner: 'work', locator: { kind: 'parent', owner: 'inherit', table: 'agentRuns', field: 'runId' } },
    worldScoped: true, exportable: true,
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'runId', remapVia: 'agentRuns', exportAs: '_agentRunExportId', onUnmapped: 'require' },
    ],
    portableData: { kind: 'agent-run-child', parentField: 'runId', contractHashField: 'contractHash' },
    defaults: { generation: 1, payloadJson: '{}' },
    note: 'HARNESS-1 严格追加事件；(runId,sequence) 唯一，非法版本/断序/scope 污染 fail-closed' },
{ table: db.agentRunCheckpoints, name: 'agentRunCheckpoints', owner: 'project',
    domainOwner: { allowed: ['work', 'instance'], defaultOwner: 'work', locator: { kind: 'parent', owner: 'inherit', table: 'agentRuns', field: 'runId' } },
    worldScoped: true, exportable: true,
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
      { field: 'runId', remapVia: 'agentRuns', exportAs: '_agentRunExportId', onUnmapped: 'require' },
    ],
    portableData: { kind: 'agent-run-child', parentField: 'runId', contractHashField: 'contractHash' },
    defaults: {
      generation: 1,
      checkpointHash: '0'.repeat(64),
      resumePayloadJson: null,
      resumePayloadHash: null,
    },
    note: 'HARNESS-1 最小恢复检查点；保存投影与可选 provider opaque 状态哈希，不复制手稿全文' },
{ table: db.agentRunArtifacts, name: 'agentRunArtifacts', owner: 'project', exportable: true,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    portableData: { kind: 'exact-run-artifact' },
    defaults: {
      encoding: 'utf-8',
      retentionState: 'available',
      pruneReceiptJson: null,
      pruneReceiptHash: null,
    },
    note: 'CTXG-2 内容寻址 exact Run evidence；Run 引用只存在追加事件中，正文按 project/kind/hash 去重并可留下 prune tombstone' },
{ table: db.nodeFlows, name: 'nodeFlows', owner: 'project',
    domainOwner: WORK_DOMAIN_OWNER,
    worldScoped: true, exportable: true, exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'nodeRuns[flowId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_worldGroupExportId' },
    ],
    defaults: { graphJson: '{"version":1,"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}' },
    note: '领域节点模式的项目级可视编排文档；与分步骤长篇共享正式读写契约' },
{ table: db.nodeRuns, name: 'nodeRuns', owner: 'project', exportable: true,
    domainOwner: WORK_DOMAIN_OWNER,
    exportRemap: [
      { field: 'flowId', remapVia: 'nodeFlows', exportAs: '_flowExportId', onUnmapped: 'require' },
    ],
    defaults: {
      inputSnapshotsJson: '{}',
      nodeResultsJson: '{}',
      executionPlanJson: '{}',
      graphSnapshotJson: '',
    },
    note: '领域节点模式逐节点输入、输出、执行计划与断点记录，保证刷新后仍可见可恢复' },
// ───────────────────── NS-4 时序事实账本 ─────────────────────
  // 导出/导入：全部分类型 FK + 三个章节引用 + 自引用 supersedesFactId 都做 exportRemap，
  //   未映射（引用的实体/章已不在导出内）默认置 null，事实不丢、引用不悬空。
  // 项目级删除：owner:'project' 自动覆盖。
  // 单独删除/合并：角色删除/合并由 character-references.ts 统一重映射；章节删除由 chapter store
  //   调 fact-ledger/lifecycle.ts 清 source/valid chapter FK 并降级待复核。绝不自动改写相邻时序。
  { table: db.temporalFacts, name: 'temporalFacts', owner: 'project', worldScoped: true,
    resourceIdentity: RESOURCE_IDENTITY('temporal-fact', 'fact', '时序事实'),
    worldSemantic: { version: 1, area: 'story', resourceKind: 'temporal-fact', canonPolicy: 'confirmed-rows-only', statusField: 'status', confirmedStatusValues: ['confirmed'], ...NARRATIVE_PROJECTOR_V1('assertion', ['characterId', 'locationId', 'storyArcId', 'subjectWorldGroupId', 'codexEntryId', 'objectCharacterId', 'objectLocationId', 'objectCodexEntryId', 'predicate', 'factKind', 'value', 'sourceType', 'sourceChapterId', 'sourceWorldviewId', 'sourcePowerSystemId', 'sourceCultivationSystemId', 'sourceStoryCoreId', 'sourceCharacterId', 'sourceField', 'sourceFingerprint', 'sourceQuote', 'validFromChapterId', 'validToChapterId', 'status', 'locked', 'supersedesFactId'], 'value', ['narrativeAssertionV1', 'narrativeRuleV1']) },
    domainOwner: WORK_DOMAIN_OWNER,
    exportable: true, exportIdField: true,
    defaults: { status: 'candidate', locked: false },
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_wgExportId' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_charExportId' },
      { field: 'locationId', remapVia: 'importantLocations', exportAs: '_locExportId' },
      { field: 'storyArcId', remapVia: 'storyArcs', exportAs: '_arcExportId' },
      { field: 'subjectWorldGroupId', remapVia: 'worldGroups', exportAs: '_subjWgExportId' },
      { field: 'codexEntryId', remapVia: 'codexEntries', exportAs: '_codexExportId' },
      { field: 'objectCharacterId', remapVia: 'characters', exportAs: '_objCharExportId' },
      { field: 'objectLocationId', remapVia: 'importantLocations', exportAs: '_objLocExportId' },
      { field: 'objectCodexEntryId', remapVia: 'codexEntries', exportAs: '_objCodexExportId' },
      { field: 'sourceChapterId', remapVia: 'chapters', exportAs: '_srcChapExportId' },
      { field: 'sourceWorldviewId', remapVia: 'worldviews', exportAs: '_srcWorldviewExportId' },
      { field: 'sourcePowerSystemId', remapVia: 'powerSystems', exportAs: '_srcPowerSystemExportId' },
      { field: 'sourceCultivationSystemId', remapVia: 'cultivationSystems', exportAs: '_srcCultivationSystemExportId' },
      { field: 'sourceStoryCoreId', remapVia: 'storyCores', exportAs: '_srcStoryCoreExportId' },
      { field: 'sourceCharacterId', remapVia: 'characters', exportAs: '_srcCharacterExportId' },
      { field: 'validFromChapterId', remapVia: 'chapters', exportAs: '_vFromChapExportId' },
      { field: 'validToChapterId', remapVia: 'chapters', exportAs: '_vToChapExportId' },
      { field: 'supersedesFactId', remapVia: 'temporalFacts', selfTree: true, exportAs: '_supersedesExportId' },
    ],
    note: 'NS-4 时序事实；candidate=observation/confirmed=canon；stale/source-missing/invalid-range 进入异常审核；时序只存 chapterId 不缓存 order' },
// ───────────────────── CONSISTENCY-2 角色认知事件账本 ─────────────────────
  // 角色认知与世界真相分表；事件只追加，章节时点投影实时计算。
  // 角色/章节删除由 knowledge-ledger/lifecycle.ts 保留记录并降级复核；
  // 项目/世界生命周期与导出导入由本注册表派生。
  { table: db.knowledgeLedger, name: 'knowledgeLedger', owner: 'project', worldScoped: true,
    resourceIdentity: RESOURCE_IDENTITY('knowledge-event', 'fact', '角色认知'),
    worldSemantic: { version: 1, area: 'relations', resourceKind: 'knowledge-event', canonPolicy: 'confirmed-rows-only', statusField: 'status', confirmedStatusValues: ['confirmed'], ...NARRATIVE_PROJECTOR_V1('epistemic-event', ['characterId', 'knowledgeKey', 'statement', 'factId', 'action', 'belief', 'sourceType', 'sourceChapterId', 'sourceQuote', 'status'], 'statement', ['narrativeEpistemicV1']) },
    domainOwner: WORK_DOMAIN_OWNER,
    exportable: true,
    defaults: { status: 'candidate' },
    exportRemap: [
      { field: 'worldGroupId', remapVia: 'worldGroups', exportAs: '_wgExportId' },
      { field: 'characterId', remapVia: 'characters', exportAs: '_characterExportId' },
      { field: 'factId', remapVia: 'temporalFacts', exportAs: '_factExportId' },
      { field: 'sourceChapterId', remapVia: 'chapters', exportAs: '_sourceChapterExportId' },
    ],
    note: 'CONSISTENCY-2 认知事件；角色知道/误认/遗忘/纠正与世界 Canon 分离，时点按规范章序实时投影' },
// ───────────────────── NS-5 检索块（可重建派生缓存） ─────────────────────
  // exportable:false —— 从章节正文切块而来、含大体积向量，是可重建缓存，不进 JSON 备份；
  // 导入后由 chapter 正文重建。项目级删除由 owner 覆盖；删章/改章触发该章块重建（在 chunk 写入层处理）。
  { table: db.retrievalChunks, name: 'retrievalChunks', owner: 'project', worldScoped: true,
    domainOwner: WORK_DOMAIN_OWNER,
    exportable: false,
    note: 'NS-5 检索块·可重建派生缓存(关键词+可选 embedding)，不导出，导入后从正文重建' },
// ───────────────────── NS-5 层级叙事摘要树（可重建派生缓存） ─────────────────────
  // exportable:false —— 从章节正文/已验证章节记忆/大纲 roll-up 得出，可按需重建；
  // 用于章→卷→全书的远距离叙事骨架，不替代事实账本，也不作为 Canon。
  { table: db.narrativeSummaryNodes, name: 'narrativeSummaryNodes', owner: 'project', worldScoped: true,
    domainOwner: WORK_DOMAIN_OWNER,
    exportable: false,
    note: 'NS-5 章→卷→全书层级摘要树·可重建派生缓存；四态 pending/rebuilding/verified/stale' },
// ───────────────────── 多世界 ─────────────────────
  { table: db.worldGroups, name: 'worldGroups', owner: 'project', exportable: true,
    resourceIdentity: { ...RESOURCE_IDENTITY('world-group', 'world', '世界'), narrativeEntityType: 'world-group' },
    worldSemantic: { version: 1, area: 'multi-world', resourceKind: 'world-group', canonPolicy: 'authoritative-table', ...NARRATIVE_PROJECTOR_V1('entity', ['name', 'description'], 'name', ['narrativeAliasesV1', 'narrativeChronologyV1']) },
    domainOwner: WORLD_DOMAIN_OWNER,
    exportIdField: true, exportOrderBy: 'order',
    note: '导出用 _exportId(导出序)重映射;按 order 排序保证序稳定' },
{ table: db.worldGroupLinks, name: 'worldGroupLinks', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('world-group-link', 'world-link', '世界通道'),
    worldSemantic: { version: 1, area: 'multi-world', resourceKind: 'world-link', canonPolicy: 'authoritative-table' },
    domainOwner: WORLD_DOMAIN_OWNER,
    exportRemap: [
      { field: 'fromGroupId', remapVia: 'worldGroups', exportAs: '_fromGroupExportId', onUnmapped: 'require' },
      { field: 'toGroupId', remapVia: 'worldGroups', exportAs: '_toGroupExportId', onUnmapped: 'require' },
    ],
    defaults: { bidirectional: false },
    note: '方向/双向性由 from/to + bidirectional 表达；进入/离开/力量/带出规则来自两端世界并由 Gateway 聚合。' },
// ───────────────────── 参考书 / 作品分析 ─────────────────────
  { table: db.references, name: 'references', owner: 'project', exportable: true,
    resourceIdentity: RESOURCE_IDENTITY('reference', 'reference', '项目参考'),
    domainOwner: WORK_DOMAIN_OWNER,
    exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'referenceAnalysisRuns[referenceId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'referenceChunkAnalysis[referenceId]', onDelete: 'cascade' },
    ] },
{ table: db.referenceAnalysisRuns, name: 'referenceAnalysisRuns', owner: 'project',
    domainOwner: WORK_DOMAIN_OWNER,
    exportable: true, exportIdField: true,
    refs: [
      { kind: 'simple', field: 'id', target: 'referenceChunkAnalysis[analysisRunId]', onDelete: 'cascade' },
      { kind: 'simple', field: 'id', target: 'referenceAnalysisSources[analysisRunId]', onDelete: 'cascade' },
    ],
    exportRemap: [
      { field: 'referenceId', remapVia: 'references', exportAs: '_referenceExportId', onUnmapped: 'require' },
    ],
    defaults: {
      sourceKind: 'unknown',
      usageScope: 'analysis-only',
      rightsNote: '',
      rightsConfirmed: false,
      expectedChunks: 0,
      completedChunks: 0,
      progress: 0,
    },
    note: 'IDEA-1 版本化分析；仅 active run 可进入 AI 上下文，来源声明绑定文件哈希' },
{ table: db.referenceChunkAnalysis, name: 'referenceChunkAnalysis', owner: 'direct-child',
    domainOwner: WORK_DOMAIN_OWNER,
    exportable: true,
    projectResolver: async (projectId) =>
      (await db.references.where('projectId').equals(projectId).primaryKeys()) as number[],
    refs: [{ kind: 'indirect', via: { table: 'references', field: 'referenceId', resolveProject: 'projectId' }, onDelete: 'cascade' }],
    exportRemap: [
      { field: 'referenceId', remapVia: 'references', exportAs: '_referenceExportId', onUnmapped: 'require' },
      { field: 'analysisRunId', remapVia: 'referenceAnalysisRuns', exportAs: '_analysisRunExportId' },
    ] },
{ table: db.referenceAnalysisSources, name: 'referenceAnalysisSources', owner: 'indirect',
    domainOwner: WORK_DOMAIN_OWNER,
    exportable: false,
    projectResolver: async (projectId) =>
      (await db.referenceAnalysisRuns.where('projectId').equals(projectId).primaryKeys()) as number[],
    refs: [{
      kind: 'indirect',
      via: { table: 'referenceAnalysisRuns', field: 'analysisRunId', resolveProject: 'projectId' },
      onDelete: 'cascade',
    }],
    note: 'IDEA-1 本地断点续跑原文；不进 JSON 备份，报告与来源哈希仍可便携往返' },
// ───────────────────── P2 Reader runtime persistence (never authoring Chapter) ─────────────────────
// All nine are project-owned, exportable and introduced in portable backup v18.
// Writer operations in P3–P5 must enforce lineage and immutable publication.
{ table: db.readerSessions, name: 'readerSessions', owner: 'project', exportable: true,
  introducedBackupVersion: 18, exportIdField: true,
  domainOwner: WORK_DOMAIN_OWNER, tree: { parentField: 'parentSessionId' },
  defaults: {
    parentSessionId: null, forkTurnId: null, headTurnId: null,
    revision: 0, status: 'active', memoryReadyThroughTurnId: null,
  },
  refs: [
    { kind: 'simple', field: 'id', target: 'readerSessions[parentSessionId]', onDelete: 'cascade' },
    { kind: 'simple', field: 'id', target: 'readerTurns[sessionId]', onDelete: 'cascade' },
    { kind: 'simple', field: 'id', target: 'readerChoices[sessionId]', onDelete: 'cascade' },
    { kind: 'simple', field: 'id', target: 'readerDecisions[sessionId]', onDelete: 'cascade' },
    { kind: 'simple', field: 'id', target: 'readerFacts[sessionId]', onDelete: 'cascade' },
    { kind: 'simple', field: 'id', target: 'readerKnowledge[sessionId]', onDelete: 'cascade' },
    { kind: 'simple', field: 'id', target: 'readerMemory[sessionId]', onDelete: 'cascade' },
    { kind: 'simple', field: 'id', target: 'readerRetrievalChunks[sessionId]', onDelete: 'cascade' },
    { kind: 'simple', field: 'id', target: 'readerPublicationRuns[sessionId]', onDelete: 'cascade' },
  ],
  exportRemap: [
    { field: 'workId', remapVia: 'works', exportAs: '_workExportId', onUnmapped: 'require' },
    { field: 'parentSessionId', remapVia: 'readerSessions', selfTree: true, exportAs: '_parentExportId' },
    { field: 'forkTurnId', remapVia: 'readerTurns', exportAs: '_forkTurnExportId', deferImport: true },
    { field: 'headTurnId', remapVia: 'readerTurns', exportAs: '_headTurnExportId', deferImport: true },
    { field: 'memoryReadyThroughTurnId', remapVia: 'readerTurns', exportAs: '_memoryReadyThroughTurnExportId', deferImport: true },
  ],
  note: 'Pinned immutable Canon baseline, fork ancestry and CAS head; no live Work memory fallback.' },
{ table: db.readerTurns, name: 'readerTurns', owner: 'project', exportable: true,
  introducedBackupVersion: 18, exportIdField: true,
  domainOwner: READER_CHILD_WORK_DOMAIN_OWNER, tree: { parentField: 'parentTurnId' },
  defaults: { parentTurnId: null, sceneHintsJson: null, status: 'published' },
  exportRemap: [
    { field: 'sessionId', remapVia: 'readerSessions', exportAs: '_sessionExportId', onUnmapped: 'require' },
    { field: 'parentTurnId', remapVia: 'readerTurns', selfTree: true, exportAs: '_parentExportId' },
  ],
  refs: [
    { kind: 'simple', field: 'id', target: 'readerChoices[turnId]', onDelete: 'cascade' },
    { kind: 'simple', field: 'id', target: 'readerFacts[originTurnId]', onDelete: 'cascade' },
    { kind: 'simple', field: 'id', target: 'readerKnowledge[originTurnId]', onDelete: 'cascade' },
    { kind: 'simple', field: 'id', target: 'readerRetrievalChunks[sourceTurnId]', onDelete: 'cascade' },
    { kind: 'simple', field: 'id', target: 'readerPublicationRuns[resultTurnId]', onDelete: 'cascade' },
  ],
  note: 'Only committed immutable prose; cross-session parentTurnId must satisfy effective fork lineage.' },
{ table: db.readerChoices, name: 'readerChoices', owner: 'project', exportable: true,
  introducedBackupVersion: 18, exportIdField: true, domainOwner: READER_CHILD_WORK_DOMAIN_OWNER,
  exportRemap: [
    { field: 'sessionId', remapVia: 'readerSessions', exportAs: '_sessionExportId', onUnmapped: 'require' },
    { field: 'turnId', remapVia: 'readerTurns', exportAs: '_turnExportId', onUnmapped: 'require' },
  ],
  refs: [{ kind: 'simple', field: 'id', target: 'readerDecisions[choiceId]', onDelete: 'cascade' }],
  note: 'Published branch/continue options remain immutable; no disabled transition.' },
{ table: db.readerDecisions, name: 'readerDecisions', owner: 'project', exportable: true,
  introducedBackupVersion: 18, exportIdField: true, domainOwner: READER_CHILD_WORK_DOMAIN_OWNER,
  exportRemap: [
    { field: 'sessionId', remapVia: 'readerSessions', exportAs: '_sessionExportId', onUnmapped: 'require' },
    { field: 'sourceTurnId', remapVia: 'readerTurns', exportAs: '_sourceTurnExportId', onUnmapped: 'require' },
    { field: 'choiceId', remapVia: 'readerChoices', exportAs: '_choiceExportId', onUnmapped: 'require' },
    { field: 'resultTurnId', remapVia: 'readerTurns', exportAs: '_resultTurnExportId', onUnmapped: 'require' },
  ],
  note: 'Committed selected choice and request-key identity; opening has no decision.' },
{ table: db.readerFacts, name: 'readerFacts', owner: 'project', exportable: true,
  introducedBackupVersion: 18, exportIdField: true, domainOwner: READER_CHILD_WORK_DOMAIN_OWNER,
  exportRemap: [
    { field: 'sessionId', remapVia: 'readerSessions', exportAs: '_sessionExportId', onUnmapped: 'require' },
    { field: 'originTurnId', remapVia: 'readerTurns', exportAs: '_originTurnExportId', onUnmapped: 'require' },
  ],
  note: 'Only confirmed and provenance-verified facts can enter reader context (P3).' },
{ table: db.readerKnowledge, name: 'readerKnowledge', owner: 'project', exportable: true,
  introducedBackupVersion: 18, exportIdField: true, domainOwner: READER_CHILD_WORK_DOMAIN_OWNER,
  exportRemap: [
    { field: 'sessionId', remapVia: 'readerSessions', exportAs: '_sessionExportId', onUnmapped: 'require' },
    { field: 'originTurnId', remapVia: 'readerTurns', exportAs: '_originTurnExportId', onUnmapped: 'require' },
    { field: 'characterId', remapVia: 'characters', exportAs: '_characterExportId', onUnmapped: 'require' },
  ],
  note: 'Character knowledge is session-originated and evidence-bound, never Work-wide.' },
{ table: db.readerMemory, name: 'readerMemory', owner: 'project', exportable: true,
  introducedBackupVersion: 18, exportIdField: true, domainOwner: READER_CHILD_WORK_DOMAIN_OWNER,
  exportRemap: [
    { field: 'sessionId', remapVia: 'readerSessions', exportAs: '_sessionExportId', onUnmapped: 'require' },
    { field: 'throughTurnId', remapVia: 'readerTurns', exportAs: '_throughTurnExportId', onUnmapped: 'require' },
    { field: 'processingRunId', remapVia: 'agentRuns', exportAs: '_processingRunExportId' },
  ],
  note: 'Derived continuity with exact lineage fingerprint, not authoring chapter memory.' },
{ table: db.readerRetrievalChunks, name: 'readerRetrievalChunks', owner: 'project', exportable: true,
  introducedBackupVersion: 18, exportIdField: true, domainOwner: READER_CHILD_WORK_DOMAIN_OWNER,
  exportRemap: [
    { field: 'sessionId', remapVia: 'readerSessions', exportAs: '_sessionExportId', onUnmapped: 'require' },
    { field: 'sourceTurnId', remapVia: 'readerTurns', exportAs: '_sourceTurnExportId', onUnmapped: 'require' },
  ],
  note: 'Local retrieval is eligible only for an effective published lineage.' },
{ table: db.readerPublicationRuns, name: 'readerPublicationRuns', owner: 'project', exportable: true,
  introducedBackupVersion: 18, exportIdField: true, domainOwner: READER_CHILD_WORK_DOMAIN_OWNER,
  exportRemap: [
    { field: 'sessionId', remapVia: 'readerSessions', exportAs: '_sessionExportId', onUnmapped: 'require' },
    { field: 'resultTurnId', remapVia: 'readerTurns', exportAs: '_resultTurnExportId', onUnmapped: 'require' },
    { field: 'runId', remapVia: 'agentRuns', exportAs: '_runExportId', onUnmapped: 'require' },
  ],
  note: 'Atomic committed receipt only; candidate stays in durable agent ledger.' },
// ───────────────────── 临时态 / blob ─────────────────────
  { table: db.importSessions, name: 'importSessions', owner: 'transient', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER },
{ table: db.importJobs, name: 'importJobs', owner: 'transient', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    note: '直接 projectId' },
{ table: db.importLogs, name: 'importLogs', owner: 'indirect', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    projectResolver: async (projectId) =>
      (await db.importSessions.where('projectId').equals(projectId).primaryKeys()) as number[],
    refs: [{ kind: 'indirect', via: { table: 'importSessions', field: 'sessionId', resolveProject: 'projectId' }, onDelete: 'cascade' }] },
{ table: db.importFiles, name: 'importFiles', owner: 'blob', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    note: '主键=sessionId;导入原文 blob 复用 importSessions.id' },
// ───────────────────── 全局 / 本地态 ─────────────────────
  { table: db.snapshots, name: 'snapshots', owner: 'project', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    note: '本地版本历史;不导出(避免循环嵌套)' },
{ table: db.promptTemplates, name: 'promptTemplates', owner: 'global', exportable: false,
    note: '全局 scope=system|user' },
{ table: db.promptWorkflows, name: 'promptWorkflows', owner: 'global', exportable: false },
{ table: db.aiUsageLog, name: 'aiUsageLog', owner: 'project', exportable: false,
    domainOwner: WORKSPACE_DOMAIN_OWNER,
    note: '消耗统计;projectId 可空;体积大不导出' }
]

function classifyWorkspaceMemory(spec: ProjectTableRegistration): WorkspaceMemoryClassificationV1 {
  if (spec.memoryClassification) return spec.memoryClassification
  if (spec.workspaceProjection) {
    return {
      version: 1,
      classification: 'editable',
      mirrorPolicy: 'editable-document',
      reason: '已登记严格 codec、稳定 identity、CAS 采纳与依赖影响发射器。',
    }
  }
  if (spec.owner === 'global') {
    return {
      version: 1,
      classification: 'not-applicable',
      mirrorPolicy: 'excluded-global',
      reason: '全局本地配置不属于任何项目工作区。',
    }
  }
  if (spec.exportable) {
    return {
      version: 1,
      classification: 'evidence',
      mirrorPolicy: 'recovery-evidence',
      reason: '确定内容进入注册表派生 recovery capsule；磁盘副本只读并可完整恢复。',
    }
  }
  return {
    version: 1,
    classification: 'derived-none',
    mirrorPolicy: 'rebuild-or-local-only',
    reason: '缓存、统计、临时事务或本地句柄不构成可移植项目记忆；由正式来源重建或留在本机。',
  }
}

/**
 * MEMORY-10 keeps classification in PROJECT_TABLES without a parallel table
 * name list. New registrations cannot reach consumers without receiving one
 * of the four explicit policies here.
 */
export const PROJECT_TABLES: TableSpec[] = PROJECT_TABLE_REGISTRATIONS.map(spec => ({
  ...spec,
  memoryClassification: classifyWorkspaceMemory(spec),
  // Annotation fields are declared once above. Every field receives the same
  // typed portable/deletion policy; no consumer keeps a second table list.
  ...(spec.worldSemantic?.projector ? {
    refs: [...(spec.refs ?? []), ...spec.worldSemantic.projector.annotationFields.map(field => ({
      kind: 'narrative-source-refs-v1' as const, field,
      targetTables: Object.values(NARRATIVE_SOURCE_FKS_V1).map(target => target.table),
      onDelete: 'tombstone' as const,
    }))],
    exportRefRemap: [...(spec.exportRefRemap ?? []), ...spec.worldSemantic.projector.annotationFields.map(field => ({
      kind: 'narrative-source-refs-v1' as const, field, exportAs: `_${field}Portable`,
    }))],
  } : {}),
}))

/** 按表名快速查找 */
export const REGISTRY_BY_NAME: ReadonlyMap<string, TableSpec> = new Map(
  PROJECT_TABLES.map(s => [s.name, s] as const),
)

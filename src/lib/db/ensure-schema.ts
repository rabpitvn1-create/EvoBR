import {
  db,
  STORYFORGE_SCHEMA_VERSION,
  STORYFORGE_STORES,
} from './schema'

export const REQUIRED_TABLES = [
  'agentConversations',
  'agentEvents',
  'agentRunArtifacts',
  'agentRunCheckpoints',
  'agentRunEvents',
  'agentRuns',
  'aiUsageLog',
  'chapters',
  'characterDrivenPlans',
  'characterRelations',
  'characters',
  'codexCategories',
  'codexEntries',
  'creativeRules',
  'cultivationProgress',
  'cultivationSystems',
  'detailedOutlines',
  'emotionBeatCards',
  'foreshadows',
  'geographies',
  'historicalKeywords',
  'historicalTimelineEvents',
  'histories',
  'importFiles',
  'importJobs',
  'importLogs',
  'importSessions',
  'importantLocations',
  'inspirationWorkspaces',
  'itemLedger',
  'knowledgeLedger',
  'narrativeBeats',
  'narrativeChoices',
  'narrativeModules',
  'narrativeNodes',
  'narrativeSummaryNodes',
  'nodeFlows',
  'nodeRuns',
  'notes',
  'outlineNodes',
  'ownershipScopeChanges',
  'powerSystems',
  'projects',
  'promptTemplates',
  'promptWorkflows',
  'referenceAnalysisRuns',
  'referenceAnalysisSources',
  'referenceChunkAnalysis',
  'references',
  'readerSessions',
  'readerTurns',
  'readerChoices',
  'readerDecisions',
  'readerFacts',
  'readerKnowledge',
  'readerMemory',
  'readerRetrievalChunks',
  'readerPublicationRuns',
  'retrievalChunks',
  'snapshots',
  'stateCards',
  'storyArcs',
  'storyCores',
  'storyTimelineEvents',
  'storylineCrossings',
  'storylineProgress',
  'temporalFacts',
  'userStyleProfiles',
  'workCharacterBindings',
  'works',
  'workspaceDocuments',
  'worldDerivations',
  'worldGroupLinks',
  'worldGroups',
  'worldNarrativeIndexCaches',
  'worldNodes',
  'worldReleases',
  'worldRevisions',
  'worldRulesProfiles',
  'worlds',
  'worldviews'
] as const

export interface CurrentSchemaState {
  version: number
  tables: string[]
}

export function assertCurrentSchemaDefinition(): void {
  const declared = Object.keys(STORYFORGE_STORES).sort()
  const required = [...REQUIRED_TABLES].sort()
  if (declared.length !== required.length
    || declared.some((name, index) => name !== required[index])) {
    throw new Error('[schema] REQUIRED_TABLES 与唯一当前 schema 不一致')
  }
}

/** Opens the current Long Form schema, including additive reader v14 stores. */
export async function openCurrentSchema(): Promise<CurrentSchemaState> {
  assertCurrentSchemaDefinition()
  await db.open()
  // The declared Dexie verno alone can hide a newer native database version.
  if (db.verno !== STORYFORGE_SCHEMA_VERSION
    || db.backendDB().version !== STORYFORGE_SCHEMA_VERSION * 10) {
    db.close()
    throw new Error('[schema] 只支持当前 schema v' + STORYFORGE_SCHEMA_VERSION)
  }
  const tables = db.tables.map(table => table.name).sort()
  const expected = [...REQUIRED_TABLES].sort()
  if (tables.length !== expected.length
    || tables.some((name, index) => name !== expected[index])) {
    db.close()
    throw new Error('[schema] 当前数据库表集合与代码定义不一致')
  }
  return { version: db.verno, tables }
}

assertCurrentSchemaDefinition()

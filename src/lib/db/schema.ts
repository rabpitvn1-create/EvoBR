






import Dexie, { type Table } from 'dexie'
import type { WorldNarrativeIndexCacheV1 } from '../types/narrative-index-cache'
import type { AgentConversation, AgentEvent, AgentRunArtifactRecordV1, AgentRunCheckpointRecord, AgentRunEventRecord, AgentRunRecord, Chapter, Character, CharacterDrivenPlan, CharacterRelation, CodexCategory, CodexEntry, CreativeRules, CultivationProgress, CultivationSystem, DetailedOutline, EmotionBeatCard, Foreshadow, Geography, HistoricalKeyword, HistoricalTimelineEvent, History, ImportantLocation, ImportFileBlob, ImportJob, ImportLog, ImportSession, InspirationWorkspace, ItemLedgerEntry, NarrativeBeat, NarrativeChoice, NarrativeModule, NarrativeNode, NodeFlow, NodeRunRecord, Note, OutlineNode, OwnershipScopeChangeRecord, PowerSystem, Project, PromptTemplate, PromptWorkflow, Reference, ReferenceAnalysisRun, ReferenceAnalysisSource, ReferenceChunkAnalysis, Snapshot, StateCard, StoryArc, StoryCore, StorylineCrossing, StorylineProgress, StoryTimelineEvent, UserStyleProfile, Work, WorkCharacterBinding, WorkspaceDocumentBindingV1, World, WorldDerivationV1, WorldGroup, WorldGroupLink, WorldNode, WorldRelease, WorldRevision, WorldRulesProfile, Worldview } from '../types'
import type {
  ReaderSessionV1, ReaderTurnV1, ReaderChoiceV1, ReaderDecisionV1,
  ReaderFactV1, ReaderKnowledgeV1, ReaderMemoryV1,
  ReaderRetrievalChunkV1, ReaderPublicationRunV1,
} from '../types/reader'
import type { AIUsageEntry } from '../ai/usage-log'
import type { KnowledgeLedgerEntry } from '../types/knowledge-ledger'
import type { NarrativeSummaryNode } from '../types/narrative-summary'
import type { RetrievalChunk } from '../types/retrieval-chunk'
import type { TemporalFact } from '../types/temporal-fact'
export const STORYFORGE_DATABASE_NAME = 'evobr-longform'
export const STORYFORGE_SCHEMA_VERSION = 14
/** Long Form profile of upstream schema 13; isolated from StoryForge browser data. */
export const STORYFORGE_STORES_V13 = {
projects: '++id, &workspaceUid, workspacePurpose, name, createdAt, updatedAt',
worlds: '++id, projectId, identityKind, code, [projectId+identityKind], [projectId+updatedAt]',
works: '++id, projectId, worldId, code, &[projectId+code], [projectId+worldId], [worldId+updatedAt], status, activeNarrativeModuleId',
workCharacterBindings: '++id, projectId, workId, characterId, &[workId+characterId], [projectId+workId]',
ownershipScopeChanges: '++id, projectId, worldId, workId, tableName, recordId, createdAt',
workspaceDocuments: '++id, projectId, workspaceUid, documentId, &[projectId+documentId], relativePath, &[projectId+relativePath], tableName, recordId, &[projectId+tableName+recordId], worldCode, workCode, lastSyncRunId, updatedAt',
worldRevisions: '++id, projectId, worldId, parentRevisionId, revision, contentHash, updatedAt',
worldReleases: '++id, releaseUid, projectId, worldId, revisionId, version, contentHash, createdAt',
worldNarrativeIndexCaches: '++id, projectId, worldId, &releaseId, lastAccessedAt',
worldDerivations: '++id, projectId, worldId, sourceWorkspaceUid, sourceWorkCode, sourceContentHash, targetRevisionId, targetReleaseId, createdAt',
worldviews: '++id, projectId',
storyCores: '++id, projectId',
powerSystems: '++id, projectId',
cultivationSystems: '++id, projectId, worldGroupId, name',
cultivationProgress: '++id, projectId, worldGroupId, characterId, cultivationSystemId, sourceChapterId, status',
geographies: '++id, projectId',
histories: '++id, projectId',
worldNodes: '++id, projectId, parentId, sortOrder',
historicalTimelineEvents: '++id, projectId, era, year',
historicalKeywords: '++id, projectId, category, era',
importantLocations: '++id, projectId, parentId, sortOrder',
worldRulesProfiles: '++id, projectId, worldGroupId',
characters: '++id, projectId, name, roleWeight, moralAxis, orderAxis, statusEvidenceChapterId',
characterRelations: '++id, projectId, fromCharacterId, toCharacterId',
outlineNodes: '++id, projectId, parentId, order, type',
chapters: '++id, projectId, outlineNodeId, order, status',
detailedOutlines: '++id, projectId, outlineNodeId',
emotionBeatCards: '++id, projectId, chapterId',
foreshadows: '++id, projectId, status, type',
storyArcs: '++id, projectId, type, sourceStoryCoreId, producerRunId',
narrativeModules: '++id, projectId, worldId, workId, kind, status, updatedAt',
narrativeNodes: '++id, projectId, moduleId, sourceOutlineNodeId, order',
narrativeBeats: '++id, projectId, moduleId, nodeKey, &[moduleId+beatKey], [moduleId+nodeKey], speakerCharacterId, order',
narrativeChoices: '++id, projectId, moduleId, sourceNodeKey, &[moduleId+choiceKey], [moduleId+sourceNodeKey], targetNodeKey, order',
characterDrivenPlans: '++id, projectId, status, parentPlanId, updatedAt',
storylineProgress: '++id, &arcId, projectId, status, lastActiveChapterId',
storylineCrossings: '++id, projectId, arcIdA, arcIdB, chapterId',
stateCards: '++id, projectId, category, entityName, lastChapterId',
itemLedger: '++id, projectId, itemName, chapterId',
storyTimelineEvents: '++id, projectId, chapterId, order',
notes: '++id, projectId, chapterId, pinned',
creativeRules: '++id, projectId',
codexCategories: '++id, projectId, domain, parentId, builtInKey, order',
codexEntries: '++id, projectId, categoryId, worldGroupId, order, producerRunId',
userStyleProfiles: '++id, projectId',
inspirationWorkspaces: '++id, projectId, updatedAt',
agentConversations: '++id, projectId, worldGroupId, status, updatedAt',
agentEvents: '++id, projectId, conversationId, durableRunId, [conversationId+sequence], kind, createdAt',
agentRuns: '++id, projectId, workId, productRuntimeSessionId, productBuildId, worldGroupId, conversationId, parentRunId, &[parentRunId+parentRelation], status, updatedAt',
agentRunEvents: '++id, projectId, worldGroupId, runId, &[runId+sequence], type, createdAt',
agentRunCheckpoints: '++id, projectId, worldGroupId, runId, &[runId+throughSequence], createdAt',
agentRunArtifacts: '++id, projectId, &[projectId+artifactKind+contentHash], contentHash, retentionState, createdAt',
nodeFlows: '++id, projectId, worldGroupId, updatedAt',
nodeRuns: '++id, projectId, flowId, status, updatedAt',
temporalFacts: '++id, projectId, worldGroupId, characterId, locationId, codexEntryId, predicate, status, sourceChapterId',
knowledgeLedger: '++id, projectId, worldGroupId, characterId, knowledgeKey, factId, sourceChapterId, status',
retrievalChunks: '++id, projectId, worldGroupId, sourceChapterId',
narrativeSummaryNodes: '++id, projectId, worldGroupId, level, sourceChapterId, sourceOutlineNodeId, status',
worldGroups: '++id, projectId, type, order',
worldGroupLinks: '++id, projectId, fromGroupId, toGroupId',
references: '++id, projectId, type, createdAt',
referenceAnalysisRuns: '++id, projectId, referenceId, [referenceId+version], status, updatedAt',
referenceChunkAnalysis: '++id, referenceId, analysisRunId, [analysisRunId+chunkIndex], chunkIndex',
referenceAnalysisSources: 'analysisRunId, fileHash, createdAt',
importSessions: '++id, projectId, status, updatedAt, fileHash, targetWorldGroupId',
importJobs: '++id, projectId, type, status, createdAt',
importLogs: '++id, sessionId, chunkIndex, createdAt',
importFiles: 'sessionId, fileHash, createdAt',
snapshots: '++id, projectId, type, createdAt',
promptTemplates: '++id, scope, moduleKey, isActive, updatedAt',
promptWorkflows: '++id, scope, isDefault, updatedAt',
aiUsageLog: '++id, projectId, timestamp, category, model'
} as const satisfies Record<string,string>
/**
 * Additive reader v14 schema. Keep the original v13 map untouched so Dexie
 * upgrades existing evobr-longform databases without destructive rebuilding.
 */
export const READER_STORES_V14 = {
readerSessions: '++id, projectId, workId, [projectId+workId], parentSessionId, forkTurnId, headTurnId, [projectId+status]',
readerTurns: '++id, projectId, sessionId, &[sessionId+turnOrdinal], [sessionId+parentTurnId], contentHash',
readerChoices: '++id, projectId, sessionId, turnId, &[turnId+choiceKey]',
readerDecisions: '++id, projectId, sessionId, &[sessionId+requestKey], sourceTurnId, choiceId, resultTurnId',
readerFacts: '++id, projectId, sessionId, originTurnId, [sessionId+status]',
readerKnowledge: '++id, projectId, sessionId, characterId, originTurnId',
readerMemory: '++id, projectId, sessionId, &[sessionId+throughTurnId], [sessionId+status]',
readerRetrievalChunks: '++id, projectId, sessionId, sourceTurnId, [sessionId+sourceTurnId]',
readerPublicationRuns: '++id, projectId, sessionId, &[sessionId+requestKey], runId, resultTurnId',
} as const satisfies Record<string, string>

export const STORYFORGE_STORES = {
  ...STORYFORGE_STORES_V13,
  ...READER_STORES_V14,
} as const satisfies Record<string, string>

export class StoryForgeDB extends Dexie {
readerSessions!: Table<ReaderSessionV1, number>
readerTurns!: Table<ReaderTurnV1, number>
readerChoices!: Table<ReaderChoiceV1, number>
readerDecisions!: Table<ReaderDecisionV1, number>
readerFacts!: Table<ReaderFactV1, number>
readerKnowledge!: Table<ReaderKnowledgeV1, number>
readerMemory!: Table<ReaderMemoryV1, number>
readerRetrievalChunks!: Table<ReaderRetrievalChunkV1, number>
readerPublicationRuns!: Table<ReaderPublicationRunV1, number>
projects!: Table<Project>
worlds!: Table<World, number>
works!: Table<Work, number>
workCharacterBindings!: Table<WorkCharacterBinding, number>
ownershipScopeChanges!: Table<OwnershipScopeChangeRecord, number>
worldviews!: Table<Worldview>
storyCores!: Table<StoryCore>
powerSystems!: Table<PowerSystem>
characters!: Table<Character>
outlineNodes!: Table<OutlineNode>
chapters!: Table<Chapter>
foreshadows!: Table<Foreshadow>
geographies!: Table<Geography>
histories!: Table<History>
creativeRules!: Table<CreativeRules>
characterRelations!: Table<CharacterRelation>
snapshots!: Table<Snapshot>
references!: Table<Reference>
promptTemplates!: Table<PromptTemplate>
detailedOutlines!: Table<DetailedOutline>
importJobs!: Table<ImportJob>
importSessions!: Table<ImportSession>
importLogs!: Table<ImportLog>
importFiles!: Table<ImportFileBlob, number>
promptWorkflows!: Table<PromptWorkflow>
referenceChunkAnalysis!: Table<ReferenceChunkAnalysis, number>
referenceAnalysisRuns!: Table<ReferenceAnalysisRun, number>
referenceAnalysisSources!: Table<ReferenceAnalysisSource, number>
stateCards!: Table<StateCard, number>
emotionBeatCards!: Table<EmotionBeatCard, number>
storyArcs!: Table<StoryArc, number>
notes!: Table<Note, number>
worldNodes!: Table<WorldNode, number>
historicalTimelineEvents!: Table<HistoricalTimelineEvent, number>
historicalKeywords!: Table<HistoricalKeyword, number>
importantLocations!: Table<ImportantLocation, number>
worldRulesProfiles!: Table<WorldRulesProfile, number>
worldGroups!: Table<WorldGroup, number>
worldGroupLinks!: Table<WorldGroupLink, number>
itemLedger!: Table<ItemLedgerEntry, number>
storyTimelineEvents!: Table<StoryTimelineEvent, number>
codexCategories!: Table<CodexCategory, number>
codexEntries!: Table<CodexEntry, number>
cultivationSystems!: Table<CultivationSystem, number>
cultivationProgress!: Table<CultivationProgress, number>
characterDrivenPlans!: Table<CharacterDrivenPlan, number>
inspirationWorkspaces!: Table<InspirationWorkspace, number>
userStyleProfiles!: Table<UserStyleProfile, number>
aiUsageLog!: Table<AIUsageEntry, number>
temporalFacts!: Table<TemporalFact, number>
knowledgeLedger!: Table<KnowledgeLedgerEntry, number>
storylineProgress!: Table<StorylineProgress, number>
storylineCrossings!: Table<StorylineCrossing, number>
retrievalChunks!: Table<RetrievalChunk, number>
narrativeSummaryNodes!: Table<NarrativeSummaryNode, number>
agentConversations!: Table<AgentConversation, number>
agentEvents!: Table<AgentEvent, number>
agentRuns!: Table<AgentRunRecord, number>
agentRunEvents!: Table<AgentRunEventRecord, number>
agentRunCheckpoints!: Table<AgentRunCheckpointRecord, number>
agentRunArtifacts!: Table<AgentRunArtifactRecordV1, number>
nodeFlows!: Table<NodeFlow, number>
nodeRuns!: Table<NodeRunRecord, number>
narrativeModules!: Table<NarrativeModule, number>
narrativeNodes!: Table<NarrativeNode, number>
narrativeBeats!: Table<NarrativeBeat, number>
narrativeChoices!: Table<NarrativeChoice, number>
worldRevisions!: Table<WorldRevision, number>
worldReleases!: Table<WorldRelease, number>
worldNarrativeIndexCaches!: Table<WorldNarrativeIndexCacheV1, number>
worldDerivations!: Table<WorldDerivationV1, number>
workspaceDocuments!: Table<WorkspaceDocumentBindingV1, number>
constructor(databaseName = STORYFORGE_DATABASE_NAME) {
  super(databaseName)
  this.version(13).stores(STORYFORGE_STORES_V13)
  this.version(STORYFORGE_SCHEMA_VERSION).stores(STORYFORGE_STORES)
}
}
export const db = new StoryForgeDB()

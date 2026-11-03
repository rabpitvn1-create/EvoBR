/**
 * Reader persistence v1. Local IndexedDB identities; never model-controlled.
 * The records are intentionally separate from authoring Chapter and Work Canon.
 * Runtime publication/lineage validation belongs to P3–P5, not these types.
 */
export interface ReaderRecordBaseV1 {
  id?: number
  projectId: number
  createdAt: number
}

export interface ReaderSessionV1 extends ReaderRecordBaseV1 {
  workId: number
  parentSessionId: number | null
  forkTurnId: number | null
  headTurnId: number | null
  revision: number
  status: 'active' | 'paused' | 'archived'
  canonBaselineRef: string
  canonBaselineHash: string
  /** Immutable complete versioned Canon snapshot, not a live World pointer. */
  canonBaselineSnapshotJson: string
  memoryReadyThroughTurnId: number | null
  updatedAt: number
}

export interface ReaderTurnV1 extends ReaderRecordBaseV1 {
  sessionId: number
  parentTurnId: number | null
  /** Session-local monotone ordinal; never a global narrative index. */
  turnOrdinal: number
  content: string
  contentHash: string
  status: 'published'
  sceneHintsJson: string | null
}

export interface ReaderChoiceV1 extends ReaderRecordBaseV1 {
  sessionId: number
  turnId: number
  choiceKey: string
  kind: 'branch' | 'continue'
  text: string
  order: number
  status: 'available'
}

export interface ReaderDecisionV1 extends ReaderRecordBaseV1 {
  sessionId: number
  requestKey: string
  sourceTurnId: number
  choiceId: number
  resultTurnId: number
}

export interface ReaderFactV1 extends ReaderRecordBaseV1 {
  sessionId: number
  originTurnId: number
  predicate: string
  subjectRef: string
  valueJson: string
  evidenceQuote: string
  sourceHash: string
  status: 'candidate' | 'confirmed' | 'retracted'
}

export interface ReaderKnowledgeV1 extends ReaderRecordBaseV1 {
  sessionId: number
  characterId: number
  originTurnId: number
  knowledgeKey: string
  statement: string
  sourceQuote: string
  status: 'candidate' | 'confirmed' | 'retracted'
}

export interface ReaderMemoryV1 extends ReaderRecordBaseV1 {
  sessionId: number
  throughTurnId: number
  summary: string
  continuityJson: string
  sourceTextHash: string
  lineageFingerprint: string
  summaryPolicyVersion: string
  status: 'ready' | 'stale' | 'failed'
  processingRunId: number | null
}

export interface ReaderRetrievalChunkV1 extends ReaderRecordBaseV1 {
  sessionId: number
  sourceTurnId: number
  content: string
  contentHash: string
  sourceQuote: string
}

export interface ReaderPublicationRunV1 extends ReaderRecordBaseV1 {
  sessionId: number
  requestKey: string
  /** Real durable Agent run ID, never an invented chapter ID. */
  runId: number
  candidateHash: string
  requestFingerprint: string
  contextManifestHash: string
  semanticArtifactHash: string
  expectedSessionRevision: number
  resultTurnId: number
  receiptJson: string
  status: 'committed'
}

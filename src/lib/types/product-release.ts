/** Passive narrative row contracts retained from upstream product-release.ts. */
import type { RagDocumentMetadata } from './rag-library'
export const NARRATIVE_BEAT_KINDS = ['narration', 'dialogue', 'action', 'system'] as const
export type NarrativeBeatKind = typeof NARRATIVE_BEAT_KINDS[number]
export interface NarrativeBeat extends RagDocumentMetadata {
  id?: number
  projectId: number
  moduleId: number
  nodeKey: string
  beatKey: string
  kind: NarrativeBeatKind
  speakerCharacterId?: number | null
  text: string
  order: number
  createdAt: number
  updatedAt: number
}
export interface NarrativeChoice extends RagDocumentMetadata {
  id?: number
  projectId: number
  moduleId: number
  sourceNodeKey: string
  choiceKey: string
  text: string
  description: string
  unavailableReason: string
  targetNodeKey: string
  displayConditionJson: string
  availableConditionJson: string
  effectsJson: string
  tagsJson: string
  order: number
  createdAt: number
  updatedAt: number
}

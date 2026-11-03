import type { NovelWorkflowProfile, Work, WorkKind } from '../types/world-ownership'

export const SHORT_NOVEL_MIN_WORDS = 5_000
export const SHORT_NOVEL_MAX_WORDS = 25_000
export const SHORT_NOVEL_DEFAULT_WORDS = 10_000

export function effectiveWorkKind(work: Pick<Work, 'kind'>): WorkKind {
  return work.kind
}

export function effectiveNovelProfile(
  work: Pick<Work, 'kind' | 'novelProfile'>,
): NovelWorkflowProfile | null {
  return work.kind === 'novel' ? work.novelProfile : null
}

export function assertShortNovelTargetWords(targetWordCount: number): void {
  if (
    !Number.isInteger(targetWordCount)
    || targetWordCount < SHORT_NOVEL_MIN_WORDS
    || targetWordCount > SHORT_NOVEL_MAX_WORDS
  ) {
    throw new Error(`短篇目标字数必须是 ${SHORT_NOVEL_MIN_WORDS.toLocaleString()}～${SHORT_NOVEL_MAX_WORDS.toLocaleString()} 的整数`)
  }
}

export function normalizeNewWorkClassification(input: {
  kind?: WorkKind
  novelProfile?: NovelWorkflowProfile | null
  targetWordCount: number
}): { kind: WorkKind; novelProfile: NovelWorkflowProfile | null } {
  if (input.kind != null && input.kind !== 'novel' || input.novelProfile != null && input.novelProfile !== 'long') {
    throw new Error('EvoBR only creates Long Form novels')
  }
  return { kind: 'novel', novelProfile: 'long' }
}

export function assertStoredWorkClassification(
  work: Pick<Work, 'kind' | 'novelProfile'> & Partial<Pick<Work, 'targetWordCount'>>,
): void {
  if (work.kind !== 'novel' || work.novelProfile !== 'long') {
    throw new Error('EvoBR only restores Long Form novels')
  }
}

export function deriveShortNovelStructure(
  targetWordCount: number,
  preferredChapterCount?: number,
): { volumeCount: 1; chapterCount: number; targetWordsPerChapter: number } {
  assertShortNovelTargetWords(targetWordCount)
  if (preferredChapterCount != null && (!Number.isInteger(preferredChapterCount) || preferredChapterCount < 3 || preferredChapterCount > 8)) {
    throw new Error('短篇建议章数必须为 3～8 的整数')
  }
  const chapterCount = preferredChapterCount ?? (
    targetWordCount < 13_000 ? 3
        : targetWordCount < 18_000 ? 4
          : targetWordCount < 22_000 ? 5
            : 6
  )
  return {
    volumeCount: 1,
    chapterCount,
    targetWordsPerChapter: Math.ceil(targetWordCount / chapterCount),
  }
}

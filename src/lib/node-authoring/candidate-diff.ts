export interface CandidateVariantDiff {
  variantIndex: number
  changedLines: number
  addedLines: number
  removedLines: number
}

function lines(value: string): string[] {
  return value.split(/\r?\n/)
}

/**
 * 用稳定的逐行比较给候选对照提供可读摘要；完整文本仍由 UI 展示，不持久化第二份内容。
 */
export function compareCandidateVariants(base: string, variants: readonly string[]): CandidateVariantDiff[] {
  const baseLines = lines(base)
  return variants.map((variant, variantIndex) => {
    if (variant === base) return { variantIndex, changedLines: 0, addedLines: 0, removedLines: 0 }
    const otherLines = lines(variant)
    const commonLength = Math.min(baseLines.length, otherLines.length)
    let changedLines = Math.abs(baseLines.length - otherLines.length)
    for (let index = 0; index < commonLength; index += 1) {
      if (baseLines[index] !== otherLines[index]) changedLines += 1
    }
    return {
      variantIndex,
      changedLines,
      addedLines: Math.max(0, otherLines.length - baseLines.length),
      removedLines: Math.max(0, baseLines.length - otherLines.length),
    }
  })
}

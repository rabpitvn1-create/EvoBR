import type { CSSProperties } from 'react'

/** The supplied transparent vector, shared by product shells and app icons. */
export default function BrandIcon({ size = 38 }: { size?: number }) {
  return <svg data-storyforge-brand viewBox="0 0 256 256" aria-hidden="true" focusable="false" width={size} height={size}
    style={{ display: 'block', width: size, height: size, flexShrink: 0,
      '--brand-ink': 'var(--skin-shell-ink, #ebefe1)',
      '--brand-accent': 'var(--skin-accent, #b68a68)',
      '--brand-highlight': 'var(--skin-shell-ink, #ebefe1)',
    } as CSSProperties}>
    <use href={`${import.meta.env.BASE_URL}brand/xuanxiang-mark.svg#mark`} />
  </svg>
}

import type { HarnessFailureClassV1 } from './run/harness-failure'

export const HARNESS_FAULT_POINTS_V1 = [
  'save.before-flush',
  'save.after-flush',
  'context.before-assemble',
  'context.after-assemble',
  'candidate.before-persist',
  'candidate.after-persist',
  'adoption.before-intent',
  'adoption.before-write',
  'adoption.after-write',
  'terminal.before-verify',
  'terminal.after-receipt',
] as const

export type HarnessFaultPointV1 = typeof HARNESS_FAULT_POINTS_V1[number]

const FAILURE_CLASS_BY_POINT: Record<HarnessFaultPointV1, HarnessFailureClassV1> = {
  'save.before-flush': 'save',
  'save.after-flush': 'save',
  'context.before-assemble': 'context',
  'context.after-assemble': 'context',
  'candidate.before-persist': 'candidate',
  'candidate.after-persist': 'candidate',
  'adoption.before-intent': 'adoption',
  'adoption.before-write': 'adoption',
  'adoption.after-write': 'adoption',
  'terminal.before-verify': 'terminal',
  'terminal.after-receipt': 'terminal',
}

const enabled = new Set<HarnessFaultPointV1>()

function available(): boolean {
  return import.meta.env.DEV || import.meta.env.MODE === 'test'
}

export class HarnessInjectedFaultV1 extends Error {
  readonly failureClass: HarnessFailureClassV1

  constructor(readonly point: HarnessFaultPointV1) {
    super(`开发态 Harness 故障注入：${point}`)
    this.name = 'HarnessInjectedFaultV1'
    this.failureClass = FAILURE_CLASS_BY_POINT[point]
  }
}

/** Test/development-only in-memory configuration. It is never persisted or exposed by product UI. */
export function configureHarnessFaultInjectionV1(
  points: readonly HarnessFaultPointV1[],
): void {
  if (!available()) throw new Error('生产环境禁止启用 Harness 故障注入')
  const allowed = new Set<string>(HARNESS_FAULT_POINTS_V1)
  if (points.some(point => !allowed.has(point))) throw new Error('Harness 故障注入点无效')
  enabled.clear()
  points.forEach(point => enabled.add(point))
}

export function maybeInjectHarnessFaultV1(point: HarnessFaultPointV1): void {
  if (!available() || !enabled.has(point)) return
  throw new HarnessInjectedFaultV1(point)
}

export function resetHarnessFaultInjectionV1(): void {
  if (!available()) throw new Error('生产环境禁止重置 Harness 故障注入')
  enabled.clear()
}

/** Retired editor addresses resolve to the single origin editor. Keep aliases at
 * the routing boundary only; persisted Harness receipts retain their identity. */
export function canonicalPowerModule<T extends string | null | undefined>(module: T): T | 'worldview-origin' {
  return module === 'power-system' ? 'worldview-origin' : module
}

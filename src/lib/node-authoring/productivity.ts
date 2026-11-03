import { nanoid } from 'nanoid'
import type { AuthoringEdge, AuthoringNodeGraph, AuthoringNodeInstance } from './contracts'

const NODE_WIDTH = 238
const NODE_HEIGHT = 168
const COLUMN_GAP = 110
const ROW_GAP = 72

export interface AuthoringGraphDiff {
  nodesAdded: number
  nodesRemoved: number
  nodesChanged: number
  edgesAdded: number
  edgesRemoved: number
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function edgeKey(edge: AuthoringEdge): string {
  return `${edge.sourceNodeId}\u0000${edge.sourcePortId}\u0000${edge.targetNodeId}\u0000${edge.targetPortId}`
}

export function compareAuthoringGraphs(
  before: AuthoringNodeGraph,
  after: AuthoringNodeGraph,
): AuthoringGraphDiff {
  const beforeNodes = new Map(before.nodes.map(node => [node.id, node]))
  const afterNodes = new Map(after.nodes.map(node => [node.id, node]))
  const beforeEdges = new Set(before.edges.map(edgeKey))
  const afterEdges = new Set(after.edges.map(edgeKey))
  return {
    nodesAdded: after.nodes.filter(node => !beforeNodes.has(node.id)).length,
    nodesRemoved: before.nodes.filter(node => !afterNodes.has(node.id)).length,
    nodesChanged: after.nodes.filter(node => {
      const previous = beforeNodes.get(node.id)
      return previous != null && stable(previous) !== stable(node)
    }).length,
    edgesAdded: after.edges.filter(edge => !beforeEdges.has(edgeKey(edge))).length,
    edgesRemoved: before.edges.filter(edge => !afterEdges.has(edgeKey(edge))).length,
  }
}

/** Deterministic left-to-right DAG layout. Cycles remain in their original final layer. */
export function autoLayoutAuthoringGraph(graph: AuthoringNodeGraph): AuthoringNodeGraph {
  const incoming = new Map(graph.nodes.map(node => [node.id, [] as string[]]))
  const outgoing = new Map(graph.nodes.map(node => [node.id, [] as string[]]))
  graph.edges.forEach(edge => {
    incoming.get(edge.targetNodeId)?.push(edge.sourceNodeId)
    outgoing.get(edge.sourceNodeId)?.push(edge.targetNodeId)
  })
  const indegree = new Map(Array.from(incoming, ([id, values]) => [id, values.length]))
  const layers = new Map<string, number>()
  const queue = graph.nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id)
  while (queue.length) {
    const id = queue.shift()!
    const layer = layers.get(id) ?? 0
    for (const target of outgoing.get(id) ?? []) {
      layers.set(target, Math.max(layers.get(target) ?? 0, layer + 1))
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) queue.push(target)
    }
  }
  const fallbackLayer = Math.max(0, ...layers.values()) + 1
  const rows = new Map<number, number>()
  return {
    ...graph,
    nodes: graph.nodes.map(node => {
      const layer = layers.get(node.id) ?? fallbackLayer
      const row = rows.get(layer) ?? 0
      rows.set(layer, row + 1)
      return {
        ...node,
        x: 60 + layer * (NODE_WIDTH + COLUMN_GAP),
        y: 60 + row * (NODE_HEIGHT + ROW_GAP),
      }
    }),
    viewport: { x: 0, y: 0, zoom: graph.nodes.length > 60 ? 0.55 : graph.nodes.length > 24 ? 0.7 : 0.85 },
  }
}

export function alignAuthoringNodes(
  graph: AuthoringNodeGraph,
  nodeIds: ReadonlySet<string>,
  axis: 'x' | 'y',
): AuthoringNodeGraph {
  const selected = graph.nodes.filter(node => nodeIds.has(node.id))
  if (selected.length < 2) return graph
  const value = selected.reduce((total, node) => total + node[axis], 0) / selected.length
  return {
    ...graph,
    nodes: graph.nodes.map(node => nodeIds.has(node.id) ? { ...node, [axis]: value } : node),
  }
}

export function groupAuthoringNodes(
  graph: AuthoringNodeGraph,
  nodeIds: ReadonlySet<string>,
  title = '节点分组',
): AuthoringNodeGraph {
  if (!nodeIds.size) return graph
  const id = `group-${nanoid(10)}`
  return {
    ...graph,
    nodes: graph.nodes.map(node => nodeIds.has(node.id) ? { ...node, groupId: id } : node),
    groups: [...(graph.groups ?? []), { id, title }],
  }
}

export function copyAuthoringSubgraph(
  graph: AuthoringNodeGraph,
  nodeIds: ReadonlySet<string>,
  offset = { x: 48, y: 48 },
): { graph: AuthoringNodeGraph; copiedNodeIds: string[] } {
  const selected = graph.nodes.filter(node => nodeIds.has(node.id))
  if (!selected.length) return { graph, copiedNodeIds: [] }
  const idMap = new Map(selected.map(node => [node.id, `node-${nanoid(10)}`]))
  const copiedNodes: AuthoringNodeInstance[] = selected.map(node => ({
    ...structuredClone(node),
    id: idMap.get(node.id)!,
    title: `${node.title} 副本`,
    x: node.x + offset.x,
    y: node.y + offset.y,
    groupId: undefined,
    favorite: false,
    lastOpenedAt: Date.now(),
  }))
  const copiedEdges = graph.edges
    .filter(edge => idMap.has(edge.sourceNodeId) && idMap.has(edge.targetNodeId))
    .map(edge => ({
      ...structuredClone(edge),
      id: `edge-${nanoid(10)}`,
      sourceNodeId: idMap.get(edge.sourceNodeId)!,
      targetNodeId: idMap.get(edge.targetNodeId)!,
    }))
  return {
    graph: { ...graph, nodes: [...graph.nodes, ...copiedNodes], edges: [...graph.edges, ...copiedEdges] },
    copiedNodeIds: copiedNodes.map(node => node.id),
  }
}

export function authoringGraphBounds(graph: AuthoringNodeGraph) {
  const minX = Math.min(0, ...graph.nodes.map(node => node.x))
  const minY = Math.min(0, ...graph.nodes.map(node => node.y))
  const maxX = Math.max(NODE_WIDTH, ...graph.nodes.map(node => node.x + NODE_WIDTH))
  const maxY = Math.max(NODE_HEIGHT, ...graph.nodes.map(node => node.y + NODE_HEIGHT))
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

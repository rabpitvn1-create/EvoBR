import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)])
const relative = file => path.relative(root, file).replaceAll('\\', '/')
const resolve = (from, specifier) => {
  const bare = specifier.split('?')[0]
  const base = bare.startsWith('@/') ? path.join(root, 'src', bare.slice(2)) : path.resolve(path.dirname(from), bare)
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}
const graph = new Map()
const packagesByFile = new Map()
for (const file of walk(path.join(root, 'src')).sort()) {
  const edges = new Map(), packages = new Set()
  const add = (specifier, kind) => {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
      packages.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0])
      return
    }
    const target = resolve(file, specifier)
    if (!target) throw new Error(`Unresolved ${relative(file)} -> ${specifier}`)
    const key = `${relative(target)}:${kind}`
    edges.set(key, { path: relative(target), kind })
  }
  const source = fs.readFileSync(file)
  if (/\.tsx?$/.test(file)) {
    const ast = ts.createSourceFile(file, source.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        add(node.moduleSpecifier.text, node.isTypeOnly || node.importClause?.isTypeOnly ? 'type' : 'module')
      }
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal.text, 'type')
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text, 'dynamic')
      if (ts.isNewExpression(node) && node.expression.getText(ast) === 'URL' && ts.isStringLiteral(node.arguments?.[0])
        && node.arguments[1]?.getText(ast) === 'import.meta.url') add(node.arguments[0].text, 'worker-or-asset')
      ts.forEachChild(node, visit)
    }
    visit(ast)
  } else if (file.endsWith('.css')) {
    for (const match of source.toString().matchAll(/(?:@import\s+|url\()["']([^"']+)["']/g)) {
      if (match[1].startsWith('.')) add(match[1], 'css-or-asset')
    }
  }
  graph.set(relative(file), [...edges.values()].sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind)))
  packagesByFile.set(relative(file), [...packages].sort())
}
const roots = ['src/main.tsx', 'src/vite-env.d.ts']
const queue = [...roots], reached = new Set(), parents = new Map()
while (queue.length) {
  const file = queue.shift()
  if (reached.has(file)) continue
  reached.add(file)
  for (const edge of graph.get(file) ?? []) {
    if (!parents.has(edge.path)) parents.set(edge.path, file)
    queue.push(edge.path)
  }
}
const result = {
  upstream: 'yuanbw2025/storyforge@9b4cb04be0605f51520fe8fa34eb4e94c2204cd3',
  roots,
  reachableFiles: [...reached].sort(),
  unreferencedSourceFiles: [...graph.keys()].filter(file => !reached.has(file)).sort(),
  packages: [...new Set([...reached].flatMap(file => packagesByFile.get(file) ?? []))].sort(),
  files: Object.fromEntries([...graph].filter(([file]) => reached.has(file)).map(([file, dependencies]) => [file, {
    parent: roots.includes(file) ? null : parents.get(file), dependencies,
  }])),
}
const output = path.join(root, 'docs/dependency-closure.json')
const content = JSON.stringify(result, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== content) throw new Error('Dependency closure changed; regenerate it with npm run gen:dependencies')
} else fs.writeFileSync(output, content)
if (result.unreferencedSourceFiles.length) throw new Error(`Unreferenced source files: ${result.unreferencedSourceFiles.join(', ')}`)
console.log(`[dependencies] ${reached.size} reachable files; ${result.packages.length} packages; every retained source has an entry path`)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)])
const errors = []
const excluded = /\/lib\/(?:adventure|open-world|ttrpg|avg|ai-town|character-interaction|motion-drama|comic|screenplay|short-novel|adaptation|product-production|product)\//
const resolve = (file, specifier) => {
  const bare = specifier.split('?')[0]
  const base = bare.startsWith('@/') ? path.join(root, 'src', bare.slice(2)) : path.resolve(path.dirname(file), bare)
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}
const check = (file, specifier) => {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return
  const resolved = resolve(file, specifier)
  if (!resolved) errors.push(`${path.relative(root, file)}: unresolved dependency ${specifier}`)
  else if (excluded.test(resolved)) errors.push(`${path.relative(root, file)}: excluded product dependency ${specifier}`)
}
const sourceFiles = files(path.join(root, 'src'))
for (const file of sourceFiles) {
  if (excluded.test(file)) errors.push(`Excluded product implementation: ${path.relative(root, file)}`)
  if (/\.tsx?$/.test(file)) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) check(file, node.moduleSpecifier.text)
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) check(file, node.argument.literal.text)
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) check(file, node.arguments[0].text)
      if (ts.isNewExpression(node) && node.expression.getText(source) === 'URL' && ts.isStringLiteral(node.arguments?.[0])
        && node.arguments[1]?.getText(source) === 'import.meta.url') check(file, node.arguments[0].text)
      ts.forEachChild(node, visit)
    }
    visit(source)
  } else if (file.endsWith('.css')) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/(?:@import\s+|url\()["']([^"']+)["']/g)) {
      if (match[1].startsWith('.')) check(file, match[1])
    }
  }
}
const entries = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/agent/ai-entry-registry.json'), 'utf8'))
for (const entry of [...entries.entries, ...entries.limitedTransports]) {
  for (const caller of entry.allowedCallers) if (!fs.existsSync(path.join(root, caller))) errors.push(`AI entry ${entry.entryId}: missing caller ${caller}`)
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`[architecture] ${sourceFiles.length} source/assets checked; imports, workers, themes and AI callers are closed; excluded product engines absent`)

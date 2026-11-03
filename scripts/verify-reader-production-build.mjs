#!/usr/bin/env node
/**
 * P7 production-output proof. Checks actual Vite-generated HTML asset URLs,
 * not a copied config string or mocked development path.
 */
import fs from 'node:fs'
import path from 'node:path'

const directory=path.resolve(process.argv[2]||'dist')
const base=process.argv[3]||'/EvoBR/'
if(!base.startsWith('/')||!base.endsWith('/')||base==='/'||base.includes('..'))
  throw new Error('Expected a non-root absolute Pages base ending in /')
const html=fs.readFileSync(path.join(directory,'index.html'),'utf8')
const refs=[
  ...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi),
].map(item=>item[1]).filter(url=>url.startsWith('/'))
if(refs.length<2)throw new Error('Production index is missing absolute built assets')
const buildRefs=refs.filter(url=>url.includes('/assets/'))
if(!buildRefs.some(url=>/\.js(?:\?|$)/.test(url))||
  !buildRefs.some(url=>/\.css(?:\?|$)/.test(url)))
  throw new Error('Expected a Vite-built JS entry and CSS reference')
for(const url of refs){
  if(!url.startsWith(base))throw new Error('Asset URL has wrong base: '+url)
  const relative=url.slice(base.length).split('?')[0]
  if(!relative||relative.includes('..'))throw new Error('Unsafe asset URL: '+url)
  const asset=path.join(directory,relative)
  if(!fs.existsSync(asset)||!fs.statSync(asset).isFile())
    throw new Error('Built asset missing: '+asset)
}
if(html.includes('/storyforge/assets/')||html.includes('/storyforge/brand/'))
  throw new Error('Default StoryForge base leaked into custom Pages production index')
console.log('[reader-release] PASS: '+refs.length+' production assets resolve under '+base)

/** U1.1 Reader presentation allowlist. Art is supplied by Muse in a separate commit.
 * Model JSON never owns URLs, asset aliases or Canon truth.
 */
export interface ReaderStageFocusV1 { x:number;y:number }
export interface ReaderStageManifestV1 {
  levels:Readonly<Record<string,string>>
  levelFocus:Readonly<Record<string,ReaderStageFocusV1>>
  protagonist:string
  entities:Readonly<Record<string,string>>
  aliases:Readonly<Record<string,string>>
  entityPriority:readonly string[]
}
const levelIds=['level-0','level-1','level-2','level-3','level-4','level-5','level-6'] as const
const entities=['smiler','clump','deathmoth','skin-stealer','wretch','duller',
  'slenderman','hostile-faceling'] as const
export const READER_STAGE_ASSETS_V1:ReaderStageManifestV1={
  levels:Object.fromEntries(levelIds.map(id=>[id,'/reader-assets/levels/'+id+'.webp'])),
  levelFocus:Object.fromEntries(levelIds.map(id=>[id,{x:50,y:id==='level-5'?28:50}])),
  protagonist:'/reader-assets/characters/cao-minh.webp',
  entities:{
    ...Object.fromEntries(entities.map(id=>[id,'/reader-assets/entities/'+id+'.webp'])),
    // Canon ENTITY.BROWNIES has no approved artwork in U1.1.
    brownies:'',
  },
  aliases:{brownie:'brownies'},
  entityPriority:entities,
}
export interface ReaderSceneHintsV1 {
  levelId:string
  entityIds:string[]
}
export function resolveReaderEntityIdV1(id:string):string|null {
  const key=READER_STAGE_ASSETS_V1.aliases[id]??id
  return Object.prototype.hasOwnProperty.call(READER_STAGE_ASSETS_V1.entities,key)?key:null
}
/** Hints are best-effort decoration, not a publication gate or Canon evidence. */
export function normalizeReaderSceneHintsV1(value:unknown):ReaderSceneHintsV1|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null
  const fields=value as Record<string,unknown>
  if(typeof fields.levelId!=='string'||
    !Object.prototype.hasOwnProperty.call(READER_STAGE_ASSETS_V1.levels,fields.levelId))
    return null
  if(!Array.isArray(fields.entityIds)||fields.entityIds.length>16||
    fields.entityIds.some(id=>typeof id!=='string'))return null
  const seen=new Set<string>()
  for(const id of fields.entityIds as string[]) {
    const resolved=resolveReaderEntityIdV1(id)
    if(resolved)seen.add(resolved)
  }
  return {levelId:fields.levelId,entityIds:[...seen].slice(0,3)}
}
export function serializeReaderSceneHintsV1(value:unknown):string|null {
  const normalized=normalizeReaderSceneHintsV1(value)
  return normalized?JSON.stringify({levelId:normalized.levelId,entityIds:normalized.entityIds}):null
}
export function parseReaderSceneHintsV1(raw:string|null):ReaderSceneHintsV1|null {
  if(!raw||raw.length>8192)return null
  try{return normalizeReaderSceneHintsV1(JSON.parse(raw) as unknown)}
  catch{return null}
}
export function prominentReaderEntityV1(
  hints:ReaderSceneHintsV1|null,
  assets:ReaderStageManifestV1=READER_STAGE_ASSETS_V1,
):{id:string;src:string}|null {
  if(!hints)return null
  const available=hints.entityIds.filter(id=>Boolean(assets.entities[id]))
  const selected=assets.entityPriority.find(id=>available.includes(id))
    ??available.sort()[0]
  return selected?{id:selected,src:assets.entities[selected]}:null
}
/** Vite/Pages base path is applied only to trusted manifest paths. */
export function readerStageAssetUrlV1(slot:string):string {
  if(!slot.startsWith('/reader-assets/'))throw Error('[readerStage] unregistered asset path')
  return import.meta.env.BASE_URL.replace(/\/$/,'')+slot
}

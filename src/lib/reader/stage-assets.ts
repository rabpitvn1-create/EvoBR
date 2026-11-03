/**
 * P6 Reader illustration manifest. These are asset SLOTS, not bundled artwork.
 * Put owned transparent PNG/WebP art at the declared paths in public/reader-assets/.
 * Never read a URL, entity name, or authority claim from model output.
 */
export interface ReaderStageManifestV1 {
  levels:Readonly<Record<string,string>>
  protagonist:string
  entities:Readonly<Record<string,string>>
}
export const READER_STAGE_ASSETS_V1:ReaderStageManifestV1={
  levels:{
    'level-0':'/reader-assets/levels/level-0.webp',
  },
  protagonist:'/reader-assets/characters/cao-minh.webp',
  entities:{
    'brownie':'/reader-assets/entities/brownie.webp',
  },
}
/** A rendering hint is never a Canon fact; unknown keys are discarded. */
export interface ReaderSceneHintsV1 {
  levelId:string
  entityIds:string[]
}
/**
 * Non-authoritative, best-effort decoration. All invalid or incomplete model
 * hints reduce to null; these checks must never veto Reader publication.
 */
export function normalizeReaderSceneHintsV1(value:unknown):ReaderSceneHintsV1|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null
  const fields=value as Record<string,unknown>
  if(typeof fields.levelId!=='string'||
    !Object.prototype.hasOwnProperty.call(READER_STAGE_ASSETS_V1.levels,fields.levelId))return null
  if(!Array.isArray(fields.entityIds)||fields.entityIds.length>16||
    fields.entityIds.some(id=>typeof id!=='string'))return null
  return {levelId:fields.levelId,entityIds:[...new Set(
    fields.entityIds.filter((id:string)=>
      Object.prototype.hasOwnProperty.call(READER_STAGE_ASSETS_V1.entities,id))
  )].slice(0,3)}
}
export function serializeReaderSceneHintsV1(value:unknown):string|null{
  const normalized=normalizeReaderSceneHintsV1(value)
  return normalized?JSON.stringify({levelId:normalized.levelId,entityIds:normalized.entityIds}):null
}
export function parseReaderSceneHintsV1(raw:string|null):ReaderSceneHintsV1|null{
  if(!raw||raw.length>8192)return null
  try{return normalizeReaderSceneHintsV1(JSON.parse(raw) as unknown)}
  catch{return null}
}
/** Vite/Pages base path is applied only to trusted manifest paths. */
export function readerStageAssetUrlV1(slot:string):string{
  if(!slot.startsWith('/reader-assets/'))throw Error('[readerStage] unregistered asset path')
  return import.meta.env.BASE_URL.replace(/\/$/,'')+slot
}

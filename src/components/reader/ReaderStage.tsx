import { useEffect, useMemo, useState } from 'react'
import { parseReaderSceneHintsV1, READER_STAGE_ASSETS_V1,
  readerStageAssetUrlV1, type ReaderStageManifestV1 } from '../../lib/reader/stage-assets'

/**
 * Presentation only. A background lives in a clipped surface; overlays live in
 * an independent, overflow-visible layer. Neither layer accepts input.
 */
export default function ReaderStage({sceneHintsJson,assets=READER_STAGE_ASSETS_V1}:{
  sceneHintsJson:string|null
  assets?:ReaderStageManifestV1
}) {
  const hints=useMemo(()=>parseReaderSceneHintsV1(sceneHintsJson),[sceneHintsJson])
  const background=hints ? assets.levels[hints.levelId] : undefined
  const protagonist=assets.protagonist
  const entities=useMemo(()=>hints?.entityIds
    .map(id=>({id,src:assets.entities[id]})).filter(
      (item):item is {id:string;src:string}=>Boolean(item.src))??[],
    [hints,assets])
  const [loaded,setLoaded]=useState({background:false,protagonist:false})
  const [failed,setFailed]=useState(false)
  const [hiddenEntities,setHiddenEntities]=useState<string[]>([])
  useEffect(()=>{
    setLoaded({background:false,protagonist:false})
    setFailed(false)
    setHiddenEntities([])
  },[background,protagonist,sceneHintsJson])
  if(!background||!protagonist||failed)return null
  const ready=loaded.background&&loaded.protagonist
  return <figure className="ebr-stage" aria-label="Minh họa tĩnh cho cảnh đã xuất bản"
    data-ready={ready?'true':'false'} data-level={hints?.levelId}>
    <div className="ebr-stage-window" aria-hidden="true">
      <img className="ebr-stage-background" src={readerStageAssetUrlV1(background)} alt=""
        onLoad={()=>setLoaded(prev=>({...prev,background:true}))}
        onError={()=>setFailed(true)}/>
    </div>
    <div className="ebr-stage-actors" aria-hidden="true">
      <img className="ebr-stage-protagonist" src={readerStageAssetUrlV1(protagonist)} alt=""
        onLoad={()=>setLoaded(prev=>({...prev,protagonist:true}))}
        onError={()=>setFailed(true)}/>
      {entities.filter(e=>!hiddenEntities.includes(e.id)).map(entity=>
        <img key={entity.id} className="ebr-stage-entity" data-entity={entity.id}
          src={readerStageAssetUrlV1(entity.src)} alt=""
          onError={()=>setHiddenEntities(prev=>[...prev,entity.id])}/>)}
    </div>
  </figure>
}

import { useMemo, useState } from 'react'
import { prominentReaderEntityV1, parseReaderSceneHintsV1, READER_STAGE_ASSETS_V1,
  readerStageAssetUrlV1, type ReaderStageManifestV1 } from '../../lib/reader/stage-assets'

/** Presentation only. Eligibility is decided before first paint from committed hints.
 * The 220px stage always keeps its layout box after image load/error.
 */
export default function ReaderStage({sceneHintsJson,assets=READER_STAGE_ASSETS_V1}:{
  sceneHintsJson:string|null
  assets?:ReaderStageManifestV1
}) {
  const hints=useMemo(()=>parseReaderSceneHintsV1(sceneHintsJson),[sceneHintsJson])
  const background=hints?assets.levels[hints.levelId]:undefined
  const selected=useMemo(()=>prominentReaderEntityV1(hints,assets),[hints,assets])
  const [failed,setFailed]=useState<string[]>([])
  if(!background)return null
  const fail=(slot:string)=>setFailed(previous=>previous.includes(slot)?previous:[...previous,slot])
  const focus=assets.levelFocus[hints!.levelId]??{x:50,y:50}
  return <figure className="ebr-stage" aria-label="Minh họa tĩnh của lượt truyện hiện tại"
    data-level={hints!.levelId}>
    <div className="ebr-stage-window" aria-hidden="true">
      {!failed.includes('background')&&
        <img className="ebr-stage-background" src={readerStageAssetUrlV1(background)}
          style={{objectPosition:focus.x+'% '+focus.y+'%'}} alt=""
          onError={()=>fail('background')}/>}
    </div>
    <div className="ebr-stage-actors" aria-hidden="true">
      {assets.protagonist&&!failed.includes('protagonist')&&
        <img className="ebr-stage-protagonist" src={readerStageAssetUrlV1(assets.protagonist)}
          alt="" onError={()=>fail('protagonist')}/>}
      {selected&&!failed.includes(selected.id)&&
        <img className="ebr-stage-entity" data-entity={selected.id}
          src={readerStageAssetUrlV1(selected.src)}
          alt="" onError={()=>fail(selected.id)}/>}
    </div>
  </figure>
}

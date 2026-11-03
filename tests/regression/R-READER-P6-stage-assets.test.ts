import {describe,expect,it} from 'vitest'
import {parseReaderSceneHintsV1,READER_STAGE_ASSETS_V1,
  readerStageAssetUrlV1} from '../../src/lib/reader/stage-assets'

describe('P6 static Reader stage contract',()=>{
  it('uses only registered, stable asset slots and deduplicates entity hints',()=>{
    expect(parseReaderSceneHintsV1(JSON.stringify({
      levelId:'level-0',entityIds:['brownie','brownie','unknown'],
    }))).toEqual({levelId:'level-0',entityIds:['brownie']})
    expect(READER_STAGE_ASSETS_V1.protagonist).toContain('/reader-assets/characters/')
    expect(readerStageAssetUrlV1(READER_STAGE_ASSETS_V1.levels['level-0']))
      .toContain('/reader-assets/levels/level-0.webp')
  })
  it('never accepts arbitrary entity URLs or unknown levels from the model',()=>{
    expect(parseReaderSceneHintsV1('{"levelId":"unknown","entityIds":["brownie"]}')).toBeNull()
    expect(parseReaderSceneHintsV1('{"levelId":"level-0","entityIds":["https://evil.invalid/a.png"]}'))
      .toEqual({levelId:'level-0',entityIds:[]})
    expect(parseReaderSceneHintsV1('not JSON')).toBeNull()
    expect(parseReaderSceneHintsV1(null)).toBeNull()
    expect(parseReaderSceneHintsV1('['+'x'.repeat(8192)+']')).toBeNull()
    expect(()=>readerStageAssetUrlV1('https://evil.invalid/a.png')).toThrow()
  })
})

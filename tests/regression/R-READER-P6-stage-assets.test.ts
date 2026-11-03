import {describe,expect,it} from 'vitest'
import {parseReaderSceneHintsV1,READER_STAGE_ASSETS_V1,
  prominentReaderEntityV1,resolveReaderEntityIdV1,serializeReaderSceneHintsV1,
  readerStageAssetUrlV1} from '../../src/lib/reader/stage-assets'

describe('U1.1 Reader static asset and hint contract',()=>{
  it('registers seven LEVEL backgrounds with centered focus and eight approved entity images',()=>{
    for(let i=0;i<=6;i++){
      const id='level-'+i
      expect(READER_STAGE_ASSETS_V1.levels[id]).toBe('/reader-assets/levels/'+id+'.webp')
      expect(READER_STAGE_ASSETS_V1.levelFocus[id]).toEqual({x:50,y:i===5?28:50})
    }
    expect(Object.values(READER_STAGE_ASSETS_V1.entities).filter(Boolean)).toHaveLength(8)
    expect(READER_STAGE_ASSETS_V1.protagonist).toBe('/reader-assets/characters/cao-minh.webp')
    expect(readerStageAssetUrlV1(READER_STAGE_ASSETS_V1.levels['level-0']))
      .toContain('/reader-assets/levels/level-0.webp')
  })
  it('resolves canon brownie alias to brownies but never invents missing art',()=>{
    expect(resolveReaderEntityIdV1('brownie')).toBe('brownies')
    expect(READER_STAGE_ASSETS_V1.entities.brownies).toBe('')
    expect(parseReaderSceneHintsV1(JSON.stringify({
      levelId:'level-0',entityIds:['brownie','brownies','smiler','smiler','unknown'],
    }))).toEqual({levelId:'level-0',entityIds:['brownies','smiler']})
    expect(prominentReaderEntityV1({levelId:'level-0',entityIds:['brownies']})).toBeNull()
  })
  it('always chooses one registered visible entity by manifest priority',()=>{
    const hint={levelId:'level-0',entityIds:['wretch','deathmoth','smiler']}
    expect(prominentReaderEntityV1(hint)?.id).toBe('smiler')
    expect(prominentReaderEntityV1({levelId:'level-0',entityIds:[]})).toBeNull()
  })
  it('rejects untrusted image URLs, unknown LEVEL and malformed hints without vetoing prose',()=>{
    expect(parseReaderSceneHintsV1('{"levelId":"unknown","entityIds":["smiler"]}')).toBeNull()
    expect(parseReaderSceneHintsV1('{"levelId":"level-0","entityIds":["https://evil.invalid/a.png"]}'))
      .toEqual({levelId:'level-0',entityIds:[]})
    expect(parseReaderSceneHintsV1('not JSON')).toBeNull()
    expect(parseReaderSceneHintsV1(null)).toBeNull()
    expect(parseReaderSceneHintsV1('['+'x'.repeat(8192)+']')).toBeNull()
    expect(serializeReaderSceneHintsV1({levelId:'level-2',entityIds:[{'name':'smiler'}]}))
      .toBeNull()
    expect(()=>readerStageAssetUrlV1('https://evil.invalid/a.png')).toThrow()
  })
})

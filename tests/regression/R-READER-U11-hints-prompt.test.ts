import {describe,expect,it} from 'vitest'
import {buildReaderChoiceMessagesV1,parseReaderBranchChoicesV1} from '../../src/lib/reader/choices'
import {normalizeReaderSceneHintsV1} from '../../src/lib/reader/stage-assets'
import type {ReaderRunHandleV1} from '../../src/lib/reader/run'

const prose='Cao Minh đang ở Level 0. Một Smiler hiện ra ở cuối hành lang vàng. Anh bước chậm lại trước ngã rẽ.'
const handle={
  identity:{sessionId:1},
  frozen:{contextManifestHash:'frozen-manifest',assembly:{text:'trusted snapshot'}},
} as unknown as ReaderRunHandleV1

describe('U1.1 choices visual metadata instructions',()=>{
  it('requests sceneHints in every JSON response, but only with grounded level',()=>{
    const messages=buildReaderChoiceMessagesV1(handle,prose,'frozen-prose-hash')
    const prompt=messages[0].content
    expect(prompt).toContain('Trường sceneHints PHẢI có mặt')
    expect(prompt).toContain('sceneHints:null')
    expect(prompt).toContain('Chỉ đọc finalProse ĐÃ DUYỆT')
    expect(prompt).toContain('level-6')
    expect(prompt).toContain('smiler')
    expect(prompt).toContain('brownies')
    expect(prompt).not.toContain('https://')
  })
  it('normalizes valid alias and drops unsupported entities while keeping branch quotes strict',()=>{
    const valid=JSON.stringify({
      choices:[{choiceKey:'look',text:'Quan sát ngã rẽ',sourceQuote:'ngã rẽ'}],
      sceneHints:{levelId:'level-0',entityIds:['brownie','smiler']},
    })
    expect(parseReaderBranchChoicesV1(valid,prose).choices).toHaveLength(1)
    expect(normalizeReaderSceneHintsV1(JSON.parse(valid).sceneHints))
      .toEqual({levelId:'level-0',entityIds:['brownies','smiler']})
    const fake=valid.replace('ngã rẽ','đoạn văn không tồn tại')
    expect(parseReaderBranchChoicesV1(fake,prose).choices).toHaveLength(0)
  })
  it('missing or malformed hint does not reject otherwise grounded branch JSON',()=>{
    for(const hints of [undefined,42,{levelId:'unknown',entityIds:[]}]){
      const output=JSON.stringify({choices:[{
        choiceKey:'look',text:'Quan sát ngã rẽ',sourceQuote:'ngã rẽ',
      }],...(hints===undefined?{}:{sceneHints:hints})})
      expect(parseReaderBranchChoicesV1(output,prose).choices).toHaveLength(1)
      expect(normalizeReaderSceneHintsV1(hints)).toBeNull()
    }
  })
})

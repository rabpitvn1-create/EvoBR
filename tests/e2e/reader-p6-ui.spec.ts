import {test,expect} from '@playwright/test'

const story=[
  'Cao Minh đứng trước cánh cửa và nghe tiếng đèn kêu rền trong hành lang vắng. Anh nén hơi thở, bàn tay đặt lên mép cửa, rồi nhìn vào khoảng tối phía sau.',
  'Cao Minh bước qua cánh cửa. Ánh đèn phía sau nhạt đi, và tiếng chân anh dội lại trong một hành lang mới. Anh nhận ra mình không còn ở chỗ cũ.',
  'Cao Minh quay lại cánh cửa vừa khép. Lòng bàn tay anh lạnh đi khi nhận ra tiếng động ở phía bên kia đã ngừng hẳn.',
]
function routeProvider(page:import('@playwright/test').Page){
  let proseIndex=0
  const calls:string[]=[]
  return page.route('**/reader-ui-mock/v1/chat/completions',async route=>{
    const payload=route.request().postDataJSON() as {messages:Array<{role:string;content:string}>}
    const system=payload.messages[0]?.content??''
    let stage:string,output:string
    if(system.includes('Bạn là người viết tiểu thuyết')){
      stage='reader-prose';output=story[Math.min(proseIndex++,story.length-1)]
    }else if(system.includes('bộ đánh giá ngữ nghĩa V3')){
      stage='reader-v3-review';output='{"issues":[]}'
    }else if(system.includes('Bạn tạo LỰA CHỌN ĐỌC TIẾP')){
      stage='reader-choices'
      output=JSON.stringify({choices:[{choiceKey:'open-door',text:'Quan sát cánh cửa',
        sourceQuote:'cánh cửa'}]})
    }else if(system.includes('bộ kiểm tra CHỈ-ĐỌC')){
      stage='reader-choice-verifier';output='{"issues":[]}'
    }else{
      throw Error('Unexpected reader model call '+system.slice(0,80))
    }
    calls.push(stage)
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      id:'reader-p6-mock',object:'chat.completion',created:1,model:'mock-reader',
      choices:[{index:0,message:{role:'assistant',content:output},finish_reason:'stop'}],
      usage:{prompt_tokens:250,completion_tokens:90,total_tokens:340},
    })})
  }).then(()=>calls)
}
async function seedWorkspace(page:import('@playwright/test').Page){
  return page.evaluate(async()=>{
    const {db}=await import('/storyforge/src/lib/db/schema.ts')
    const {seedCurrentWorkspace}=await import('/storyforge/tests/helpers/current-workspace.ts')
    const {useAIConfigStore}=await import('/storyforge/src/stores/ai-config.ts')
    await db.delete();await db.open()
    const {scope}=await seedCurrentWorkspace('Truyện đọc EvoBR')
    useAIConfigStore.getState().setConfig({
      provider:'custom',apiKey:'mock-transport',baseUrl:'/reader-ui-mock/v1',
      model:'mock-reader',temperature:0.6,maxTokens:1800,contextWindow:160000,
    })
    return scope
  })
}
test('P6: session → opening → choice → next turn → reload → old-turn fork',async({page})=>{
  await page.goto('./')
  const scope=await seedWorkspace(page)
  const calls=await routeProvider(page)
  await page.goto('./reader/'+scope.projectId+'/'+scope.workId)
  await expect(page.getByRole('heading',{name:'Truyện đọc EvoBR'})).toBeVisible()
  await page.getByRole('button',{name:'+ Tạo mới'}).click()
  await expect(page.locator('.ebr-reader-turn')).toHaveCount(1,{timeout:45_000})
  await expect(page.getByText(story[0])).toBeVisible()
  await expect(page.getByRole('button',{name:'Quan sát cánh cửa'})).toBeVisible()
  await page.getByRole('button',{name:'Quan sát cánh cửa'}).click()
  await expect(page.locator('.ebr-reader-turn')).toHaveCount(2,{timeout:45_000})
  await expect(page.getByText(story[1])).toBeVisible()
  const previousCalls=calls.length
  await page.reload()
  await expect(page.locator('.ebr-reader-turn')).toHaveCount(2)
  await expect(page.getByText(story[0])).toBeVisible()
  await expect(page.getByText(story[1])).toBeVisible()
  expect(calls).toHaveLength(previousCalls)
  await page.getByRole('button',{name:'Rẽ nhánh từ trang 1'}).click()
  await expect(page.locator('.ebr-reader-turn')).toHaveCount(1)
  await expect(page.locator('.ebr-reader-session-list button')).toHaveCount(2)
  await expect(page.getByRole('button',{name:'Quan sát cánh cửa'})).toBeVisible()
  await page.getByRole('button',{name:'Quan sát cánh cửa'}).click()
  await expect(page.locator('.ebr-reader-turn')).toHaveCount(2,{timeout:45_000})
  await expect(page.getByText(story[2])).toBeVisible()
  await expect(page.getByText(story[1])).toHaveCount(0)
  expect(calls.filter(c=>c==='reader-prose')).toHaveLength(3)
  expect(calls.filter(c=>c==='reader-choices')).toHaveLength(3)
  expect(calls.filter(c=>c==='reader-choice-verifier')).toHaveLength(3)
  expect(calls.filter(c=>c==='reader-v3-review')).toHaveLength(3)
})
test('P6: static stage clips background, keeps actors outside, hides missing hints/assets',async({page})=>{
  await page.route('**/reader-assets/**',route=>route.fulfill({
    status:200,contentType:'image/svg+xml',
    body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#9a8f78"/></svg>',
  }))
  await page.goto('./')
  const scope=await page.evaluate(async()=>{
    const {db}=await import('/storyforge/src/lib/db/schema.ts')
    const {seedCurrentWorkspace}=await import('/storyforge/tests/helpers/current-workspace.ts')
    const {createRootReaderSessionV1}=await import('/storyforge/src/lib/reader/baseline.ts')
    const {sha256Text}=await import('/storyforge/src/lib/ai/chapter-memory/text-normalization.ts')
    await db.delete();await db.open()
    const {scope}=await seedCurrentWorkspace('Sân khấu tĩnh')
    const make=async(sceneHintsJson:string|null)=>{
      const id=await createRootReaderSessionV1(scope,{maxSnapshotBytes:2000000})
      const content='Cao Minh đứng im trong ánh sáng vàng, lắng nghe tiếng động xa xa.'
      const turnId=await db.readerTurns.add({
        projectId:scope.projectId,sessionId:id,parentTurnId:null,turnOrdinal:1,
        content,contentHash:await sha256Text(content),status:'published',
        sceneHintsJson,createdAt:Date.now(),
      })
      const choiceId=await db.readerChoices.add({
        projectId:scope.projectId,sessionId:id,turnId,choiceKey:'continue',
        kind:'continue',text:'Đọc tiếp',order:0,status:'available',createdAt:Date.now(),
      })
      const receipt={
        version:1,sessionId:id,requestKey:'visual-test-'+id,
        requestFingerprint:'a'.repeat(64),runId:1,candidateHash:'b'.repeat(64),
        contextManifestHash:'c'.repeat(64),semanticArtifactHash:'d'.repeat(64),
        expectedRevision:0,previousHeadTurnId:null,resultTurnId:turnId,
        resultRevision:1,contentHash:await sha256Text(content),
        choices:[{id:choiceId,choiceKey:'continue',kind:'continue',text:'Đọc tiếp'}],
        decisionId:null,
      }
      await db.readerPublicationRuns.add({
        projectId:scope.projectId,sessionId:id,requestKey:receipt.requestKey,runId:1,
        candidateHash:receipt.candidateHash,requestFingerprint:receipt.requestFingerprint,
        contextManifestHash:receipt.contextManifestHash,
        semanticArtifactHash:receipt.semanticArtifactHash,expectedSessionRevision:0,
        resultTurnId:turnId,receiptJson:JSON.stringify(receipt),status:'committed',
        createdAt:Date.now(),
      })
      await db.readerSessions.update(id,{headTurnId:turnId,revision:1})
      return id
    }
    const withHints=await make(JSON.stringify({levelId:'level-0',entityIds:['brownie']}))
    const withoutHints=await make(null)
    return {...scope,withHints,withoutHints}
  })
  await page.goto('./reader/'+scope.projectId+'/'+scope.workId+'?session='+scope.withHints)
  const stage=page.locator('.ebr-stage[data-ready="true"]')
  await expect(stage).toBeVisible()
  await expect(page.locator('.ebr-stage-entity[data-entity="brownie"]')).toBeVisible()
  const positions=await page.evaluate(()=>{
    const frame=document.querySelector('.ebr-stage')!
    const bg=document.querySelector('.ebr-stage-window')!
    const actors=document.querySelector('.ebr-stage-actors')!
    const protagonist=document.querySelector('.ebr-stage-protagonist')!
    return {
      rootOverflow:getComputedStyle(frame).overflow,
      bgOverflow:getComputedStyle(bg).overflow,
      actorsOverflow:getComputedStyle(actors).overflow,
      frameTop:frame.getBoundingClientRect().top,
      characterTop:protagonist.getBoundingClientRect().top,
    }
  })
  expect(positions.rootOverflow).toBe('visible')
  expect(positions.bgOverflow).toBe('hidden')
  expect(positions.actorsOverflow).toBe('visible')
  expect(positions.characterTop).toBeLessThan(positions.frameTop)
  await page.goto('./reader/'+scope.projectId+'/'+scope.workId+'?session='+scope.withoutHints)
  await expect(page.locator('.ebr-stage')).toHaveCount(0)
  await expect(page.locator('.ebr-reader-turn')).toHaveCount(1)
  await page.unroute('**/reader-assets/**')
  await page.route('**/reader-assets/**',route=>route.abort())
  await page.goto('./reader/'+scope.projectId+'/'+scope.workId+'?session='+scope.withHints)
  await expect(page.locator('.ebr-stage')).toHaveCount(0)
  await expect(page.locator('.ebr-reader-turn')).toHaveCount(1)
})

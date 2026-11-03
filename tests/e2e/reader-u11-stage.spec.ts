import {test,expect,type Page} from '@playwright/test'

const svg='<svg xmlns="http://www.w3.org/2000/svg" width="760" height="440"><rect width="760" height="440" fill="#79704a"/></svg>'
async function seed(page:Page){
  await page.goto('./')
  return page.evaluate(async()=>{
    const {db}=await import('/storyforge/src/lib/db/schema.ts')
    const {seedCurrentWorkspace}=await import('/storyforge/tests/helpers/current-workspace.ts')
    const {createRootReaderSessionV1}=await import('/storyforge/src/lib/reader/baseline.ts')
    const {sha256Text}=await import('/storyforge/src/lib/ai/chapter-memory/text-normalization.ts')
    await db.delete();await db.open()
    const {scope}=await seedCurrentWorkspace('U1.1 LEVEL illustrations')
    const make=async(levelId:string|null,entityIds:string[],repetitions=1)=>{
      const sessionId=await createRootReaderSessionV1(scope,{maxSnapshotBytes:2000000})
      const content='Cao Minh dừng lại. Những bức tường chìm trong ánh sáng mỏng, và từng tiếng động nhỏ vang lên từ cuối hành lang.'.repeat(repetitions)
      const contentHash=await sha256Text(content)
      const turnId=await db.readerTurns.add({
        projectId:scope.projectId,sessionId,parentTurnId:null,turnOrdinal:1,
        content,contentHash,status:'published',sceneHintsJson:levelId===null?null:
          JSON.stringify({levelId,entityIds}),createdAt:Date.now(),
      })
      const choiceId=await db.readerChoices.add({
        projectId:scope.projectId,sessionId,turnId,choiceKey:'continue',
        kind:'continue',text:'Đọc tiếp',order:0,status:'available',createdAt:Date.now(),
      })
      const receipt={version:1,sessionId,requestKey:'u11-'+sessionId,requestFingerprint:'a'.repeat(64),
        runId:1,candidateHash:'b'.repeat(64),contextManifestHash:'c'.repeat(64),
        semanticArtifactHash:'d'.repeat(64),expectedRevision:0,previousHeadTurnId:null,
        resultTurnId:turnId,resultRevision:1,contentHash,
        choices:[{id:choiceId,choiceKey:'continue',kind:'continue',text:'Đọc tiếp'}],decisionId:null}
      await db.readerPublicationRuns.add({
        projectId:scope.projectId,sessionId,requestKey:receipt.requestKey,
        runId:1,candidateHash:receipt.candidateHash,
        requestFingerprint:receipt.requestFingerprint,
        contextManifestHash:receipt.contextManifestHash,
        semanticArtifactHash:receipt.semanticArtifactHash,expectedSessionRevision:0,
        resultTurnId:turnId,receiptJson:JSON.stringify(receipt),status:'committed',createdAt:Date.now(),
      })
      await db.readerSessions.update(sessionId,{headTurnId:turnId,revision:1})
      return sessionId
    }
    const levels=[]
    for(let i=0;i<=6;i++)levels.push(await make('level-'+i,i===0?['wretch','smiler']:[]))
    const missing=await make(null,[])
    const unknown=await make('level-unknown',[])
    const longSession=await make('level-0',[],45)
    return {...scope,levels,missing,unknown,longSession}
  })
}
function path(scope:{projectId:number;workId:number},sessionId:number){
  return './reader/'+scope.projectId+'/'+scope.workId+'?session='+sessionId
}
test('U1.1 stage: 412px geometry, 0 horizontal overflow, one entity and 44px actions',async({page})=>{
  await page.setViewportSize({width:412,height:915})
  await page.route('**/reader-assets/**',route=>route.fulfill({
    status:200,contentType:'image/svg+xml',body:svg,
  }))
  const scope=await seed(page)
  await page.goto(path(scope,scope.levels[0]))
  const stage=page.locator('.ebr-stage')
  await expect(stage).toHaveCount(1)
  await expect(stage.locator('.ebr-stage-entity')).toHaveCount(1)
  await expect(stage.locator('[data-entity="smiler"]')).toHaveCount(1)
  const size=await page.evaluate(()=>{
    const box=(q:string)=>document.querySelector(q)!.getBoundingClientRect()
    const frame=box('.ebr-stage'),person=box('.ebr-stage-protagonist')
    const entity=box('.ebr-stage-entity'),para=box('.ebr-reader-turn p')
    const button=box('.ebr-reader-overflow')
    return {
      overflow:document.documentElement.scrollWidth-window.innerWidth,
      frame:{x:frame.x,width:frame.width,height:frame.height,top:frame.top,bottom:frame.bottom},
      person:{right:person.right,height:person.height,top:person.top,bottom:person.bottom},
      entity:{left:entity.left,width:entity.width,height:entity.height,bottom:entity.bottom},
      paraTop:para.top,
      button:{width:button.width,height:button.height},
      bgOverflow:getComputedStyle(document.querySelector('.ebr-stage-window')!).overflow,
      actorsOverflow:getComputedStyle(document.querySelector('.ebr-stage-actors')!).overflow,
      stagePosition:getComputedStyle(document.querySelector('.ebr-stage')!).position,
    }
  })
  expect(size.overflow).toBeLessThanOrEqual(0)
  expect(size.frame.width).toBe(380)
  expect(size.frame.height).toBe(140)
  expect(size.frame.x).toBe(16)
  expect(size.person.height).toBe(260)
  expect(size.person.top).toBe(size.frame.top-80)
  expect(size.person.bottom).toBe(size.frame.bottom+40)
  expect(size.entity.width).toBe(180)
  expect(size.entity.height).toBe(180)
  expect(size.entity.bottom).toBe(size.frame.bottom+31)
  expect(size.entity.left).toBeGreaterThanOrEqual(16)
  expect(size.person.right).toBeLessThanOrEqual(412)
  expect(size.bgOverflow).toBe('hidden')
  expect(size.actorsOverflow).toBe('visible')
  expect(size.button.width).toBeGreaterThanOrEqual(44)
  expect(size.button.height).toBeGreaterThanOrEqual(44)
  await page.goto(path(scope,scope.missing))
  await expect(page.locator('.ebr-stage')).toHaveCount(0)
  await expect(page.locator('.ebr-reader-turn p')).toHaveCount(1)
  await page.goto(path(scope,scope.unknown))
  await expect(page.locator('.ebr-stage')).toHaveCount(0)
})
test('U1.1 delayed image load cannot move prose; missing Cao Minh keeps stage reserved',async({page})=>{
  await page.setViewportSize({width:412,height:915})
  let release!:()=>void
  const held=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/reader-assets/**',async route=>{
    await held
    if(route.request().url().includes('/characters/cao-minh.webp')){
      await route.abort('failed')
    }else{
      await route.fulfill({status:200,contentType:'image/svg+xml',body:svg})
    }
  })
  const scope=await seed(page)
  await page.goto(path(scope,scope.levels[0]),{waitUntil:'domcontentloaded'})
  const stage=page.locator('.ebr-stage')
  await expect(stage).toHaveCount(1)
  const before=await page.locator('.ebr-reader-turn p').evaluate(el=>el.offsetTop)
  release()
  await expect(page.locator('.ebr-stage-protagonist')).toHaveCount(0)
  await expect(stage).toHaveCount(1)
  const after=await page.locator('.ebr-reader-turn p').evaluate(el=>el.offsetTop)
  expect(after).toBe(before)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(0)
})
test('U1.1 actual mobile art: all seven LEVELs load and produce review screenshots',async({page})=>{
  await page.setViewportSize({width:412,height:915})
  const scope=await seed(page)
  for(let i=0;i<=6;i++){
    await page.goto(path(scope,scope.levels[i]))
    await expect(page.locator('.ebr-stage[data-level="level-'+i+'"]')).toHaveCount(1)
    const image=page.locator('.ebr-stage-background')
    await expect(image).toHaveCSS('object-position',i===5?'50% 28%':'50% 50%')
    await expect(image).toHaveJSProperty('complete',true)
    expect(await image.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect(page.locator('.ebr-stage-protagonist')).toHaveJSProperty('complete',true)
    expect(await page.locator('.ebr-stage-protagonist').evaluate(
      el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await page.screenshot({path:'test-results/u11-level-'+i+'.png',fullPage:false})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth))
      .toBeLessThanOrEqual(0)
  }
})

test('U1.1 reopening Reader chooses recent session and restores saved reading scroll',async({page})=>{
  await page.setViewportSize({width:412,height:915})
  await page.route('**/reader-assets/**',route=>route.fulfill({
    status:200,contentType:'image/svg+xml',body:svg,
  }))
  const scope=await seed(page)
  await page.goto(path(scope,scope.longSession))
  await expect(page.locator('.ebr-reader-turn')).toHaveCount(1)
  const key='evobr-reader-scroll-v1:'+scope.projectId+':'+scope.workId+':'+scope.longSession
  await page.evaluate(()=>window.scrollTo(0,520))
  await expect.poll(()=>page.evaluate(k=>Number(localStorage.getItem(k)),key)).toBeGreaterThan(400)
  const saved=await page.evaluate(k=>Number(localStorage.getItem(k)),key)
  await page.reload()
  await expect(page.locator('.ebr-reader-turn')).toHaveCount(1)
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(400)
  expect(Math.abs((await page.evaluate(()=>window.scrollY))-saved)).toBeLessThanOrEqual(2)
  await page.goto('./reader/'+scope.projectId+'/'+scope.workId)
  await expect(page.locator('.ebr-reader-session-toggle')).toContainText('#'+scope.longSession)
  await expect(page.locator('.ebr-reader-turn')).toHaveCount(1)
})

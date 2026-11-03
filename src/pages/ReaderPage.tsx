import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { db } from '../lib/db/schema'
import { resolveScope } from '../lib/workspace/scope'
import { readReaderPublishedViewV1 } from '../lib/reader/readback'
import { createRootReaderSessionV1, forkReaderSessionV1 } from '../lib/reader/baseline'
import { publishReaderTurnV1, recoverReaderPublicationV1 } from '../lib/reader/recovery'
import type { ReaderTurnIntentV1 } from '../lib/reader/publication'
import type { ReaderChoiceV1, ReaderSessionV1, ReaderTurnV1 } from '../lib/types/reader'
import type { WorkspaceScope } from '../lib/types'
import { useAIConfigStore } from '../stores/ai-config'
import ReaderStage from '../components/reader/ReaderStage'
import './reader.css'

const MAX_BASELINE_BYTES=2_000_000
const INPUT_BUDGET_TOKENS=120_000
function message(error:unknown):string {
  return error instanceof Error?error.message:String(error)
}
function pendingStorageKey(scope:WorkspaceScope):string {
  return 'evobr-reader-pending-v1:'+scope.projectId+':'+scope.workId
}
type PendingRequestV1={intent:ReaderTurnIntentV1;workId:number}
function readPending(scope:WorkspaceScope):PendingRequestV1|null{
  try {
    const raw=sessionStorage.getItem(pendingStorageKey(scope))
    if(!raw)return null
    const value=JSON.parse(raw) as PendingRequestV1
    return value?.workId===scope.workId&&value.intent?.sessionId>0 &&
      typeof value.intent.requestKey==='string'?value:null
  }catch{return null}
}
interface ReaderViewV1 {
  session:ReaderSessionV1
  turns:ReaderTurnV1[]
  choices:ReaderChoiceV1[]
}
export default function ReaderPage(){
  const {projectId:rawProjectId,workId:rawWorkId}=useParams()
  const projectId=Number(rawProjectId),workId=Number(rawWorkId)
  const [params,setParams]=useSearchParams()
  const sessionParam=Number(params.get('session'))
  const selectedSessionId=Number.isSafeInteger(sessionParam)&&sessionParam>0?sessionParam:null
  const [scope,setScope]=useState<WorkspaceScope|null>(null)
  const [workTitle,setWorkTitle]=useState('')
  const [sessions,setSessions]=useState<ReaderSessionV1[]>([])
  const [view,setView]=useState<ReaderViewV1|null>(null)
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [uncertain,setUncertain]=useState(false)
  const mounted=useRef(true)
  const inFlight=useRef(false)
  const refreshId=useRef(0)

  const selectSession=useCallback((id:number|null)=>{
    setParams(id===null?{}:{session:String(id)},{replace:true})
  },[setParams])

  const load=useCallback(async(currentId:number|null)=>{
    const sequence=++refreshId.current
    const work=Number.isSafeInteger(workId)&&workId>0?await db.works.get(workId):undefined
    if(!work||work.projectId!==projectId)throw Error('Không tìm thấy tác phẩm Reader đã chọn.')
    const nextScope=await resolveScope({scope:{
      projectId,worldId:work.worldId,workId:work.id!,
    }})
    const listed=(await db.readerSessions.where('workId').equals(workId).toArray())
      .filter(item=>item.projectId===projectId)
      .sort((a,b)=>b.updatedAt-a.updatedAt)
    const target=currentId===null?listed[0]?.id:null
    const id=currentId??target??null
    if(currentId!==null&&!listed.some(s=>s.id===currentId))
      throw Error('Phiên đọc không thuộc tác phẩm này.')
    const next:ReaderViewV1|null=id===null?null:
      await readReaderPublishedViewV1(nextScope,id)
    if(!mounted.current||sequence!==refreshId.current)return
    setScope(nextScope);setWorkTitle(work.title);setSessions(listed);setView(next)
    if(currentId===null&&id!==null)selectSession(id)
  },[projectId,workId,selectSession])

  useEffect(()=>{
    mounted.current=true
    let active=true
    setLoading(true);setError('');setUncertain(false)
    void (async()=>{
      try{
        await load(selectedSessionId)
        if(!active)return
        const work=await db.works.get(workId)
        if(!work||work.projectId!==projectId)return
        const nextScope={projectId,worldId:work.worldId,workId}
        const pending=readPending(nextScope)
        if(pending){
          const receipt=await recoverReaderPublicationV1({
            workspace:nextScope,intent:pending.intent,
          })
          if(!active)return
          if(receipt){
            sessionStorage.removeItem(pendingStorageKey(nextScope))
            await load(pending.intent.sessionId)
            selectSession(pending.intent.sessionId)
          }else{
            setUncertain(true)
          }
        }
      }catch(cause){if(active)setError(message(cause))}
      finally{if(active)setLoading(false)}
    })()
    return ()=>{active=false;mounted.current=false;refreshId.current++}
  },[load,selectedSessionId,projectId,workId,selectSession])

  const recheck=async()=>{
    if(!scope||inFlight.current)return
    setError('')
    try{
      const pending=readPending(scope)
      if(!pending){setUncertain(false);return}
      const recovered=await recoverReaderPublicationV1({
        workspace:scope,intent:pending.intent,
      })
      if(recovered){
        sessionStorage.removeItem(pendingStorageKey(scope))
        setUncertain(false)
        selectSession(pending.intent.sessionId)
        await load(pending.intent.sessionId)
      }else{
        setUncertain(true)
        setError('Chưa có biên nhận xuất bản. Chưa thể xác nhận lượt này đã hoàn thành.')
      }
    }catch(cause){setError(message(cause))}
  }
  const requestTurn=async(currentScope:WorkspaceScope,intent:ReaderTurnIntentV1)=>{
    if(inFlight.current)return
    inFlight.current=true;setBusy(true);setUncertain(false);setError('')
    sessionStorage.setItem(pendingStorageKey(currentScope),
      JSON.stringify({workId:currentScope.workId,intent} satisfies PendingRequestV1))
    try{
      const configured=useAIConfigStore.getState().config
      // The P4 governed adapter requires a positive output reservation;
      // the existing app preset uses 0 to mean unlimited.
      const config={...configured,maxTokens:configured.maxTokens>0?configured.maxTokens:1800}
      await publishReaderTurnV1({
        workspace:currentScope,intent,config,
        inputBudgetTokens:INPUT_BUDGET_TOKENS,
        maxBaselineBytes:MAX_BASELINE_BYTES,maxChoiceRetries:0,
      })
      sessionStorage.removeItem(pendingStorageKey(currentScope))
      selectSession(intent.sessionId)
      await load(intent.sessionId)
    }catch(cause){
      // A network failure may be after a real commit. Read receipt before
      // deciding the outcome; never display the uncommitted candidate.
      try{
        const recovered=await recoverReaderPublicationV1({
          workspace:currentScope,intent,
        })
        if(recovered){
          sessionStorage.removeItem(pendingStorageKey(currentScope))
          selectSession(intent.sessionId)
          await load(intent.sessionId)
          return
        }
      }catch{/* retain the original error and pending intent */}
      setError('Lượt đọc chưa được xác nhận xuất bản: '+message(cause))
      setUncertain(true)
      await load(intent.sessionId).catch(()=>{})
    }finally{
      if(mounted.current){inFlight.current=false;setBusy(false)}
    }
  }
  const create=async()=>{
    if(!scope||busy||inFlight.current)return
    inFlight.current=true;setBusy(true);setError('')
    try{
      const id=await createRootReaderSessionV1(scope,{maxSnapshotBytes:MAX_BASELINE_BYTES})
      selectSession(id)
      await load(id)
      inFlight.current=false;setBusy(false)
      await requestTurn(scope,{kind:'opening',sessionId:id,
        requestKey:crypto.randomUUID(),expectedRevision:0})
    }catch(cause){setError('Không tạo được phiên đọc: '+message(cause))}
    finally{inFlight.current=false;setBusy(false)}
  }
  const open=async()=>{
    if(!scope||!view||busy||uncertain)return
    await requestTurn(scope,{kind:'opening',sessionId:view.session.id!,
      requestKey:crypto.randomUUID(),expectedRevision:view.session.revision})
  }
  const choose=async(id:number)=>{
    if(!scope||!view||busy||uncertain||view.session.headTurnId===null)return
    const selected=view.choices.find(c=>c.id===id)
    if(!selected)return
    await requestTurn(scope,{kind:'choice',sessionId:view.session.id!,
      sourceTurnId:view.session.headTurnId,choiceId:id,
      requestKey:crypto.randomUUID(),expectedRevision:view.session.revision})
  }
  const fork=async(turnId:number)=>{
    if(!scope||!view||busy||uncertain||inFlight.current)return
    inFlight.current=true;setBusy(true);setError('')
    try{
      const id=await forkReaderSessionV1(scope,view.session.id!,turnId)
      selectSession(id)
      await load(id)
    }catch(cause){setError('Không thể tạo nhánh đọc: '+message(cause))}
    finally{inFlight.current=false;setBusy(false)}
  }

  return <main className="ebr-reader">
    <header className="ebr-reader-header">
      <Link to="/long" className="ebr-reader-back">← Thư viện</Link>
      <div className="ebr-reader-title">
        <span>EVOBR · READER</span>
        <h1>{workTitle||'Không gian đọc'}</h1>
      </div>
    </header>
    {loading&&<p role="status" className="ebr-reader-status">Đang mở các trang đã xuất bản…</p>}
    {error&&<div role="alert" className="ebr-reader-error">{error}</div>}
    {uncertain&&<div className="ebr-reader-uncertain" role="status">
      Trạng thái lượt trước chưa được xác nhận. Không tự gửi lại yêu cầu sinh nội dung.
      <button type="button" onClick={()=>void recheck()} disabled={busy}>Kiểm tra biên nhận</button>
      <button type="button" onClick={()=>{if(scope)sessionStorage.removeItem(pendingStorageKey(scope));setUncertain(false);setError('')}}
        disabled={busy}>Hủy trạng thái chờ</button>
    </div>}
    {!loading&&scope&&<div className="ebr-reader-layout">
      <aside className="ebr-reader-sessions" aria-label="Danh sách phiên đọc">
        <div className="ebr-reader-aside-heading">
          <h2>Phiên đọc</h2>
          <button type="button" onClick={()=>void create()} disabled={busy||uncertain}>+ Tạo mới</button>
        </div>
        {sessions.length===0&&<p>Chưa có phiên đọc. Bắt đầu một hành trình mới.</p>}
        <div className="ebr-reader-session-list">
          {sessions.map(session=><button type="button" key={session.id}
            aria-current={session.id===view?.session.id?'true':undefined}
            disabled={busy} onClick={()=>selectSession(session.id!)}>
            <span>{session.parentSessionId===null?'Hành trình':'Nhánh truyện'} #{session.id}</span>
            <small>{session.status==='archived'?'Đã lưu trữ':
              session.revision===0&&session.headTurnId===null?'Chưa mở đầu':
              'Đã xuất bản · phiên bản '+session.revision}</small>
          </button>)}
        </div>
      </aside>
      <section className="ebr-reader-story" aria-label="Trang đọc">
        {!view?<div className="ebr-reader-empty"><h2>Chưa có trang đọc</h2><p>Tạo phiên mới để bắt đầu câu chuyện.</p>
          <button type="button" disabled={busy||uncertain} onClick={()=>void create()}>Bắt đầu đọc</button></div>:
          <>
            {view.turns.length>0&&<ReaderStage key={view.session.headTurnId}
              sceneHintsJson={view.turns.at(-1)?.sceneHintsJson??null}/>}
            <div className="ebr-reader-paper">
              {view.turns.length===0?<div className="ebr-reader-empty">
                <h2>Trang đầu còn trắng</h2>
                <p>Chưa có lượt nào được xuất bản trong phiên này.</p>
                {view.session.parentSessionId===null&&view.session.revision===0&&
                  <button type="button" disabled={busy||uncertain} onClick={()=>void open()}>
                    Viết đoạn mở đầu</button>}
              </div>:view.turns.map((turn,index)=><article className="ebr-reader-turn" key={turn.id}
                data-turn-id={turn.id} aria-label={'Trang '+(index+1)}>
                <div className="ebr-reader-turn-top"><span>Trang {index+1}</span>
                  <button type="button" disabled={busy||uncertain}
                    onClick={()=>void fork(turn.id!)} aria-label={'Rẽ nhánh từ trang '+(index+1)}>
                    Rẽ nhánh từ đây</button></div>
                {turn.content.split(/\n\s*\n/u).filter(Boolean).map((paragraph,i)=>
                  <p key={i}>{paragraph}</p>)}
              </article>)}
            </div>
            {view.turns.length>0&&view.session.status==='active'&&<div className="ebr-reader-choices"
              aria-label="Lựa chọn tiếp theo">
              <h2>Chuyện gì sẽ xảy ra tiếp?</h2>
              {view.choices.map(c=><button type="button" key={c.id} disabled={busy||uncertain}
                data-choice-id={c.id} onClick={()=>void choose(c.id!)}>
                <span>{c.kind==='continue'?'Đọc tiếp':c.text}</span><span aria-hidden="true">›</span>
              </button>)}
              {view.choices.length===0&&<p>Chưa có lựa chọn hợp lệ ở đầu truyện hiện tại.</p>}
            </div>}
            {busy&&<p role="status" className="ebr-reader-status">
              Đang viết và kiểm chứng lượt truyện. Chỉ trang đã xuất bản mới xuất hiện tại đây…
            </p>}
          </>}
      </section>
    </div>}
  </main>
}

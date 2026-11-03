import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router'
const Library = lazy(() => import('./pages/LongformLibraryPage'))
const Workspace = lazy(() => import('./pages/WorkspacePage'))
const Settings = lazy(() => import('./components/settings/SettingsPage'))
const Reader = lazy(() => import('./pages/ReaderPage'))
export default function App() {
 return <Suspense fallback={<p role="status">Loading EvoBR Long Form…</p>}><Routes>
 <Route path="/long" element={<Library/>}/><Route path="/workspace/:projectId" element={<Workspace/>}/>
 <Route path="/reader/:projectId/:workId" element={<Reader/>}/>
 <Route path="/settings" element={<Settings/>}/><Route path="/home/settings" element={<Settings/>}/>
 <Route path="*" element={<Navigate replace to="/long"/>}/></Routes></Suspense>
}

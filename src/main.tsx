import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import ErrorBoundary from './components/shared/ErrorBoundary'
import { DialogProvider } from './components/shared/Dialog'
import { ToastProvider } from './components/shared/Toast'
import { openCurrentSchema } from './lib/db/ensure-schema'
import { validateRegistry } from './lib/registry/validate'
import { usePromptStore } from './stores/prompt'
import { useWorkflowStore } from './stores/workflow'
import { applyStoryForgeTheme, resolveStoryForgeTheme } from './lib/theme-bootstrap'
import './index.css'
async function bootstrap() {
 applyStoryForgeTheme(resolveStoryForgeTheme(localStorage.getItem('storyforge-theme')))
 validateRegistry()
 await openCurrentSchema()
 await usePromptStore.getState().init()
 await useWorkflowStore.getState().init()
 if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {})
 ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><DialogProvider><ErrorBoundary><BrowserRouter basename={import.meta.env.BASE_URL}><ToastProvider><App/></ToastProvider></BrowserRouter></ErrorBoundary></DialogProvider></React.StrictMode>)
}
void bootstrap().catch(error => { ReactDOM.createRoot(document.getElementById('root')!).render(<main role="alert"><h1>EvoBR could not start</h1><pre>{String(error)}</pre></main>) })

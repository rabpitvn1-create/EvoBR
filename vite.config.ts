import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { localCodexPlugin } from './scripts/local-codex/bridge.mjs'
import { providerProxies } from './scripts/distribution/proxies.mjs'
export default defineConfig({ base: process.env.EVOBR_BASE_PATH || '/storyforge/', plugins: [react(), localCodexPlugin()], resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } }, server: { proxy: providerProxies }, preview: { proxy: providerProxies }, build: { chunkSizeWarningLimit: 2000 } })

// Writes dist-snapshot/snapshot.js: every API answer the UI needs, for a read-only static build.
//   LIFELONG_DB=data/demo.db npx tsx server/cli/snapshot.ts "label shown on the page"
import '../env'
import express from 'express'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { api } from '../api'

const app = express().use('/api', api)
const server = app.listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
const get = async (p: string) => (await fetch(base + p)).json()

const routes: Record<string, unknown> = {}
for (const p of ['/overview', '/progress', '/predictions', '/plan', '/settings', '/sync']) routes[p] = await get(p)
const activities = []
for (let page = 0; ; page++) {
  const r = (await get(`/activities?page=${page}`)) as { total: number; items: unknown[] }
  activities.push(...r.items)
  if (activities.length >= r.total || !r.items.length) break
}
server.close()

const label = process.argv[2] ?? 'Read-only snapshot.'
mkdirSync('dist-snapshot', { recursive: true })
// ASCII-only output so the file reads correctly whatever charset it is served with.
const json = JSON.stringify({ label, routes, activities }).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
writeFileSync('dist-snapshot/snapshot.js', `window.__SNAPSHOT__=${json};\n`)
console.log(`snapshot.js written (${activities.length} activities)`)

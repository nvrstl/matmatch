import { Router, json } from 'express'
import { activitiesPage, overview, plan, prepare, progress, type Computed } from '../shared/compute'
import { cleanSettings, effectiveSettings, type ProfilePrefs } from '../shared/dataset'
import { localToday } from '../shared/dates'
import type { Settings } from '../shared/types'
import { allActivities, getDb, kvGet, kvSet, wellness } from './db'
import { getSyncStatus, runSync } from './garmin/sync'

// Everything is derived from the local DB on request; cache until the data changes.
let cache: { key: string; data: Computed } | null = null

function dataVersion() {
  const r = getDb()
    .prepare("SELECT (SELECT COUNT(*) FROM activities) || ':' || (SELECT COUNT(*) FROM daily) || ':' || (SELECT value FROM kv WHERE key = 'last_sync') AS v")
    .get() as { v: string | null }
  return `${r.v}:${localToday()}`
}

function data(): Computed {
  const key = dataVersion()
  if (!cache || cache.key !== key) {
    const ds = {
      activities: allActivities(),
      daily: wellness.daily(),
      sleep: wellness.sleep(),
      hrv: wellness.hrv(),
      weight: wellness.weight(),
      profile: kvGet<ProfilePrefs>('profile'),
    }
    cache = { key, data: prepare(ds, localToday()) }
  }
  return cache.data
}

const settings = () => effectiveSettings(kvGet<Partial<Settings>>('settings'), kvGet<ProfilePrefs>('profile'))

export const api = Router()
api.use(json())

api.get('/overview', (_req, res) => res.json(overview(data())))
api.get('/progress', (_req, res) => res.json(progress(data())))
api.get('/predictions', (_req, res) => res.json(data().predictions))
api.get('/plan', (_req, res) => res.json(plan(data(), settings())))

api.get('/activities', (req, res) => {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  res.json(activitiesPage(data().ds.activities, str(req.query.sport), str(req.query.q), Math.max(0, Number(req.query.page) || 0)))
})

api.get('/settings', (_req, res) => res.json(settings()))

api.put('/settings', (req, res) => {
  kvSet('settings', { ...settings(), ...cleanSettings(req.body as Partial<Settings>) })
  res.json(settings())
})

api.get('/sync', (_req, res) => res.json(getSyncStatus()))

api.post('/sync', (req, res) => {
  const status = getSyncStatus()
  if (!status.hasKey) return res.status(400).json({ error: 'GARMIN_API_KEY is not set in .env' })
  if (status.running) return res.status(409).json({ error: 'Sync already running' })
  runSync({ full: req.query.full === '1' }).catch(() => {}) // status endpoint reports errors
  res.status(202).json(getSyncStatus())
})

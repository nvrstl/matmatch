import { Router, json } from 'express'
import { activitiesPage, activityById, overview, plannedDay, prepare, progress, resolvePlan, type Computed, type PlanStore } from '../shared/compute'
import { cleanSettings, effectiveSettings, type ProfilePrefs } from '../shared/dataset'
import { localToday, weekStart } from '../shared/dates'
import type { Settings, WeekPlan } from '../shared/types'
import { allActivities, getDb, kvDelete, kvGet, kvSet, wellness } from './db'
import { GarminClient } from './garmin/client'
import { fetchWorkout } from './garmin/fetch'
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

const plans: PlanStore = {
  get: (w) => kvGet<WeekPlan>(`plan:${w}`),
  set: (p) => kvSet(`plan:${p.weekStart}`, p),
  remove: (w) => kvDelete(`plan:${w}`),
}

export const api = Router()
api.use(json())

api.get('/overview', (_req, res) => res.json(overview(data())))
api.get('/progress', (_req, res) => res.json(progress(data())))
api.get('/predictions', (_req, res) => res.json(data().predictions))
api.get('/plan', (req, res) => {
  const which = req.query.week === 'current' ? 'current' : 'next'
  res.json(resolvePlan(data(), settings(), which, plans, !getSyncStatus().running && kvGet('last_sync') !== null))
})
api.get('/planned/:date', (req, res) => res.json(plannedDay(String(req.params.date), plans)))

api.get('/activities', (req, res) => {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  res.json(activitiesPage(data().ds.activities, str(req.query.sport), str(req.query.q), Math.max(0, Number(req.query.page) || 0)))
})

api.get('/activities/:id', (req, res) => res.json(activityById(data().ds.activities, Number(req.params.id))))

// Workout detail is fetched from Garmin on demand and cached in the local DB.
let workoutClient: GarminClient | null = null
api.get('/activity/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id)) return res.status(400).json({ error: 'Bad activity id' })
  const cached = kvGet<unknown>(`workout:${id}`)
  if (cached) return res.json(cached)
  if (!process.env.GARMIN_API_KEY) return res.status(400).json({ error: 'GARMIN_API_KEY is not set in .env' })
  try {
    workoutClient ??= new GarminClient(process.env.GARMIN_API_KEY)
    const detail = await fetchWorkout(workoutClient, id)
    if (!detail) return res.status(404).json({ error: 'Garmin has no file for this activity.' })
    kvSet(`workout:${id}`, detail)
    res.json(detail)
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

api.get('/settings', (_req, res) => res.json(settings()))

api.put('/settings', (req, res) => {
  kvSet('settings', { ...settings(), ...cleanSettings(req.body as Partial<Settings>) })
  plans.remove(weekStart(localToday())) // new goal or schedule: re-plan the current week too
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

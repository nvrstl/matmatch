import { Router, json } from 'express'
import { localToday } from '../shared/dates'
import type { Activity, Overview, Progress, SeriesPoint, Settings, Sport } from '../shared/types'
import { allActivities, getDb, getSettings, kvGet, saveSettings, wellness } from './db'
import { getSyncStatus, runSync } from './garmin/sync'
import { loadSeries, weeklyRunKm } from './analytics/load'
import { planNextWeek } from './analytics/plan'
import { halfPredictionHistory, hrContext, isPaceRun, predictRaces } from './analytics/predict'
import { readiness } from './analytics/readiness'

// Everything is derived from the local DB on request; cache until the data changes.
let cache: { key: string; data: ReturnType<typeof compute> } | null = null

function dataVersion() {
  const r = getDb()
    .prepare("SELECT (SELECT COUNT(*) FROM activities) || ':' || (SELECT COUNT(*) FROM daily) || ':' || (SELECT value FROM kv WHERE key = 'last_sync') AS v")
    .get() as { v: string | null }
  return `${r.v}:${localToday()}`
}

function compute() {
  const acts = allActivities()
  const daily = wellness.daily()
  const restingSeries = daily.filter((d) => d.resting_hr).map((d) => ({ date: d.date, value: d.resting_hr! }))
  const today = localToday()
  const hr = hrContext(acts, restingSeries, today)
  const load = loadSeries(acts, hr, today)
  return { acts, daily, restingSeries, today, hr, load, sleep: wellness.sleep(), hrv: wellness.hrv(), weight: wellness.weight() }
}

function data() {
  const key = dataVersion()
  if (!cache || cache.key !== key) cache = { key, data: compute() }
  return cache.data
}

/** Settings saved by the user win; otherwise seed from the Garmin profile's training-day preferences. */
function effectiveSettings(): Settings {
  const saved = kvGet<Partial<Settings>>('settings')
  const s = getSettings()
  if (saved) return s
  const profile = kvGet<{ availableTrainingDays?: string[]; preferredLongTrainingDays?: string[] }>('profile')
  const idx = (d: string) => ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].indexOf(d.toUpperCase())
  const avail = (profile?.availableTrainingDays ?? []).map(idx).filter((i) => i >= 0)
  const long = (profile?.preferredLongTrainingDays ?? []).map(idx).filter((i) => i >= 0)
  if (avail.length) {
    s.runDaysPerWeek = Math.max(3, avail.length)
    s.restDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !avail.includes(d))
  }
  if (long.length) s.longRunDay = long[0]
  return s
}

const monthly = (points: { date: string; value: number }[], agg: 'mean' | 'sum' = 'mean'): SeriesPoint[] => {
  const by = new Map<string, number[]>()
  for (const p of points) {
    const m = p.date.slice(0, 7)
    if (!by.has(m)) by.set(m, [])
    by.get(m)!.push(p.value)
  }
  return [...by.entries()].map(([m, xs]) => {
    const s = xs.reduce((a, b) => a + b, 0)
    return { date: `${m}-15`, value: Math.round((agg === 'sum' ? s : s / xs.length) * 10) / 10 }
  })
}

export const api = Router()
api.use(json())

api.get('/overview', (_req, res) => {
  const { acts, today, load, daily, hrv, sleep, restingSeries } = data()
  const byS = new Map<Sport, { count: number; km: number; hours: number }>()
  for (const a of acts) {
    const e = byS.get(a.sport) ?? { count: 0, km: 0, hours: 0 }
    e.count++
    e.km += a.distanceM / 1000
    e.hours += a.durationS / 3600
    byS.set(a.sport, e)
  }
  const weekly = weeklyRunKm(acts, today, 52)
  const lastLoad = load[load.length - 1] ?? null
  const pred = predictRaces(acts, restingSeries, today)
  const rhr = daily.filter((d) => d.resting_hr).slice(-67)
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)
  const out: Overview = {
    hasData: acts.length > 0,
    firstDate: acts[0]?.date ?? null,
    lastDate: acts[acts.length - 1]?.date ?? null,
    lifetime: [...byS.entries()]
      .map(([sport, v]) => ({ sport, count: v.count, km: Math.round(v.km), hours: Math.round(v.hours) }))
      .sort((a, b) => b.hours - a.hours),
    thisWeekKm: weekly[51].km,
    lastWeekKm: weekly[50].km,
    avg4wKm: Math.round(((weekly[47].km + weekly[48].km + weekly[49].km + weekly[50].km) / 4) * 10) / 10,
    weekly,
    load: lastLoad,
    restingHr: avg(rhr.slice(-7).map((d) => d.resting_hr!)),
    restingHrBaseline: avg(rhr.slice(0, -7).map((d) => d.resting_hr!)),
    vo2max: pred.garminVo2max,
    half: pred.predictions.find((p) => p.race === 'half') ?? null,
    readiness: readiness(today, daily, hrv, sleep, lastLoad),
  }
  res.json(out)
})

api.get('/progress', (_req, res) => {
  const { acts, load, daily, sleep, hrv, weight, restingSeries } = data()
  const years = new Map<number, Progress['yearly'][number]>()
  for (const a of acts) {
    const y = Number(a.date.slice(0, 4))
    const e = years.get(y) ?? { year: y, run: 0, bike: 0, swim: 0, other: 0 }
    const h = a.durationS / 3600
    if (a.sport === 'run') e.run += h
    else if (a.sport === 'bike') e.bike += h
    else if (a.sport === 'swim') e.swim += h
    else e.other += h
    years.set(y, e)
  }
  const runs = acts.filter((a) => a.sport === 'run')
  // Easy pace trend: median pace of steady runs in a low HR band, per month.
  const hr = hrContext(acts, restingSeries, localToday())
  const easy: SeriesPoint[] = []
  if (hr.maxHr) {
    const band = runs.filter((a) => isPaceRun(a) && a.avgHr && a.avgHr < hr.maxHr! * 0.8 && a.distanceM > 4000)
    easy.push(...monthly(band.map((a) => ({ date: a.date, value: a.durationS / (a.distanceM / 1000) }))))
  }
  const progress: Progress = {
    yearly: [...years.values()]
      .sort((a, b) => a.year - b.year)
      .map((y) => ({ year: y.year, run: Math.round(y.run), bike: Math.round(y.bike), swim: Math.round(y.swim), other: Math.round(y.other) })),
    monthlyRunKm: monthly(runs.map((a) => ({ date: a.date, value: a.distanceM / 1000 })), 'sum'),
    halfPrediction: halfPredictionHistory(acts, restingSeries),
    halfRaces: runs
      .filter((a) => a.fastest.half && isPaceRun(a))
      .map((a) => ({ date: a.date, value: Math.round(a.fastest.half!) })),
    vo2max: monthly(runs.filter((a) => a.vo2max).map((a) => ({ date: a.date, value: a.vo2max! }))),
    restingHr: monthly(restingSeries),
    ctl: load.filter((_, i) => i % 7 === 0).map((p) => ({ date: p.date, value: Math.round(p.ctl * 10) / 10 })),
    sleepHours: monthly(sleep.filter((s) => s.total_s).map((s) => ({ date: s.date, value: s.total_s! / 3600 }))),
    hrv: monthly(hrv.filter((h) => h.last_night).map((h) => ({ date: h.date, value: h.last_night! }))),
    weight: monthly(weight.filter((w) => w.kg).map((w) => ({ date: w.date, value: w.kg! }))),
    steps: monthly(daily.filter((d) => d.steps).map((d) => ({ date: d.date, value: d.steps! }))),
    easyPace: easy,
  }
  res.json(progress)
})

api.get('/predictions', (_req, res) => {
  const { acts, restingSeries, today } = data()
  res.json(predictRaces(acts, restingSeries, today))
})

api.get('/plan', (_req, res) => {
  const { acts, restingSeries, today, daily, hrv, sleep, load } = data()
  const pred = predictRaces(acts, restingSeries, today)
  res.json(
    planNextWeek({
      acts,
      settings: effectiveSettings(),
      vdot: pred.vdot,
      predictedHalfSeconds: pred.predictions.find((p) => p.race === 'half')?.seconds ?? null,
      readiness: readiness(today, daily, hrv, sleep, load[load.length - 1] ?? null),
      today,
    }),
  )
})

api.get('/activities', (req, res) => {
  const { acts } = data()
  const sport = typeof req.query.sport === 'string' ? req.query.sport : ''
  const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : ''
  const page = Math.max(0, Number(req.query.page) || 0)
  const filtered: Activity[] = []
  for (let i = acts.length - 1; i >= 0; i--) {
    const a = acts[i]
    if (sport && a.sport !== sport) continue
    if (q && !a.name.toLowerCase().includes(q) && !a.date.includes(q)) continue
    filtered.push(a)
  }
  res.json({ total: filtered.length, items: filtered.slice(page * 50, page * 50 + 50) })
})

api.get('/settings', (_req, res) => res.json(effectiveSettings()))

api.put('/settings', (req, res) => {
  const b = req.body as Partial<Settings>
  const patch: Partial<Settings> = {}
  if ('goalRaceDate' in b) patch.goalRaceDate = b.goalRaceDate && /^\d{4}-\d{2}-\d{2}$/.test(b.goalRaceDate) ? b.goalRaceDate : null
  if ('goalHalfSeconds' in b) patch.goalHalfSeconds = b.goalHalfSeconds && b.goalHalfSeconds > 3000 ? Math.round(b.goalHalfSeconds) : null
  if (typeof b.runDaysPerWeek === 'number') patch.runDaysPerWeek = Math.max(3, Math.min(7, Math.round(b.runDaysPerWeek)))
  if (typeof b.longRunDay === 'number' && b.longRunDay >= 0 && b.longRunDay <= 6) patch.longRunDay = b.longRunDay
  if (Array.isArray(b.restDays)) patch.restDays = b.restDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  if ('maxWeeklyKm' in b) patch.maxWeeklyKm = b.maxWeeklyKm && b.maxWeeklyKm > 0 ? b.maxWeeklyKm : null
  saveSettings({ ...effectiveSettings(), ...patch })
  res.json(effectiveSettings())
})

api.get('/sync', (_req, res) => res.json(getSyncStatus()))

api.post('/sync', (req, res) => {
  const status = getSyncStatus()
  if (!status.hasKey) return res.status(400).json({ error: 'GARMIN_API_KEY is not set in .env' })
  if (status.running) return res.status(409).json({ error: 'Sync already running' })
  runSync({ full: req.query.full === '1' }).catch(() => {}) // status endpoint reports errors
  res.status(202).json(getSyncStatus())
})

// Every view the UI shows, computed from a Dataset. Used by the local server and, in the hosted
// version, directly in the browser.
import { loadSeries, weeklyRunKm } from './analytics/load'
import { planNextWeek } from './analytics/plan'
import { halfPredictionHistory, hrContext, isPaceRun, predictRaces } from './analytics/predict'
import { readiness } from './analytics/readiness'
import type { Dataset } from './dataset'
import { weekStart } from './dates'
import type { Activity, Overview, PredictionResult, Progress, SeriesPoint, Settings, Sport, WeekPlan } from './types'

export interface Computed {
  ds: Dataset
  today: string
  restingSeries: { date: string; value: number }[]
  load: ReturnType<typeof loadSeries>
  predictions: PredictionResult
}

export function prepare(ds: Dataset, today: string): Computed {
  const restingSeries = ds.daily.filter((d) => d.resting_hr).map((d) => ({ date: d.date, value: d.resting_hr! }))
  const hr = hrContext(ds.activities, restingSeries, today)
  return {
    ds,
    today,
    restingSeries,
    load: loadSeries(ds.activities, hr, today),
    predictions: predictRaces(ds.activities, restingSeries, today),
  }
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

const lastLoad = (c: Computed) => c.load[c.load.length - 1] ?? null
const currentReadiness = (c: Computed) => readiness(c.today, c.ds.daily, c.ds.hrv, c.ds.sleep, lastLoad(c))

export function overview(c: Computed): Overview {
  const acts = c.ds.activities
  const byS = new Map<Sport, { count: number; km: number; hours: number }>()
  for (const a of acts) {
    const e = byS.get(a.sport) ?? { count: 0, km: 0, hours: 0 }
    e.count++
    e.km += a.distanceM / 1000
    e.hours += a.durationS / 3600
    byS.set(a.sport, e)
  }
  const weekly = weeklyRunKm(acts, c.today, 52)
  const rhr = c.ds.daily.filter((d) => d.resting_hr).slice(-67)
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)
  return {
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
    load: lastLoad(c),
    restingHr: avg(rhr.slice(-7).map((d) => d.resting_hr!)),
    restingHrBaseline: avg(rhr.slice(0, -7).map((d) => d.resting_hr!)),
    vo2max: c.predictions.garminVo2max,
    half: c.predictions.predictions.find((p) => p.race === 'half') ?? null,
    readiness: currentReadiness(c),
  }
}

export function progress(c: Computed): Progress {
  const { activities: acts, daily, sleep, hrv, weight } = c.ds
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
  const hr = hrContext(acts, c.restingSeries, c.today)
  const easy: SeriesPoint[] = []
  if (hr.maxHr) {
    const band = runs.filter((a) => isPaceRun(a) && a.avgHr && a.avgHr < hr.maxHr! * 0.8 && a.distanceM > 4000)
    easy.push(...monthly(band.map((a) => ({ date: a.date, value: a.durationS / (a.distanceM / 1000) }))))
  }
  return {
    yearly: [...years.values()]
      .sort((a, b) => a.year - b.year)
      .map((y) => ({ year: y.year, run: Math.round(y.run), bike: Math.round(y.bike), swim: Math.round(y.swim), other: Math.round(y.other) })),
    monthlyRunKm: monthly(runs.map((a) => ({ date: a.date, value: a.distanceM / 1000 })), 'sum'),
    halfPrediction: halfPredictionHistory(acts, c.restingSeries),
    halfRaces: runs.filter((a) => a.fastest.half && isPaceRun(a)).map((a) => ({ date: a.date, value: Math.round(a.fastest.half!) })),
    vo2max: monthly(runs.filter((a) => a.vo2max).map((a) => ({ date: a.date, value: a.vo2max! }))),
    restingHr: monthly(c.restingSeries),
    ctl: c.load.filter((_, i) => i % 7 === 0).map((p) => ({ date: p.date, value: Math.round(p.ctl * 10) / 10 })),
    sleepHours: monthly(sleep.filter((s) => s.total_s).map((s) => ({ date: s.date, value: s.total_s! / 3600 }))),
    hrv: monthly(hrv.filter((h) => h.last_night).map((h) => ({ date: h.date, value: h.last_night! }))),
    weight: monthly(weight.filter((w) => w.kg).map((w) => ({ date: w.date, value: w.kg! }))),
    steps: monthly(daily.filter((d) => d.steps).map((d) => ({ date: d.date, value: d.steps! }))),
    easyPace: easy,
  }
}

export function plan(c: Computed, settings: Settings, which: 'current' | 'next' = 'next'): WeekPlan {
  return planNextWeek({
    acts: c.ds.activities,
    settings,
    vdot: c.predictions.vdot,
    predictedHalfSeconds: c.predictions.predictions.find((p) => p.race === 'half')?.seconds ?? null,
    readiness: currentReadiness(c),
    today: c.today,
    which,
  })
}

/** Where plans are kept, so "what was planned" stays fixed once a week has started. */
export interface PlanStore {
  get(weekStart: string): WeekPlan | null
  set(plan: WeekPlan): void
  remove(weekStart: string): void
}

/**
 * A future week is re-planned every time (it adapts to the latest data); once the week starts, the
 * plan is frozen so each day's session, and the comparison with what you ran, stays put.
 */
export function resolvePlan(
  c: Computed,
  settings: Settings,
  which: 'current' | 'next',
  store: PlanStore,
  /** false while data is still downloading: plan from what's there, but don't freeze it */
  dataComplete = true,
): WeekPlan {
  const fresh = plan(c, settings, which)
  const saved = store.get(fresh.weekStart)
  if (saved && fresh.weekStart <= c.today) return saved
  if (dataComplete) store.set(fresh)
  return fresh
}

/** The planned session for a date, if a plan for that week was ever made. */
export function plannedDay(date: string, store: PlanStore) {
  return store.get(weekStart(date))?.days.find((d) => d.date === date) ?? null
}

export function activitiesPage(acts: Activity[], sport: string, q: string, page: number) {
  const needle = q.toLowerCase()
  const filtered: Activity[] = []
  for (let i = acts.length - 1; i >= 0; i--) {
    const a = acts[i]
    if (sport && a.sport !== sport) continue
    if (needle && !a.name.toLowerCase().includes(needle) && !a.date.includes(needle)) continue
    filtered.push(a)
  }
  return { total: filtered.length, items: filtered.slice(page * 50, page * 50 + 50) }
}

export const activityById = (acts: Activity[], id: number) => acts.find((a) => a.id === id) ?? null

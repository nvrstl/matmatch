// Training load: Garmin's per-activity load when present, otherwise Banister TRIMP from heart rate,
// otherwise a duration-based estimate. Fitness (CTL, 42-day) / fatigue (ATL, 7-day) / form (TSB).
import { addDays, weekStart } from '../dates'
import type { Activity, LoadPoint } from '../types'
import type { HrContext } from './predict'

export function activityLoad(a: Activity, hr: HrContext): number {
  if (a.trainingLoad && a.trainingLoad > 0) return a.trainingLoad
  const minutes = a.durationS / 60
  if (a.avgHr && hr.restingHr && hr.maxHr && hr.maxHr > hr.restingHr) {
    const x = Math.max(0, Math.min(1, (a.avgHr - hr.restingHr) / (hr.maxHr - hr.restingHr)))
    return minutes * x * 0.64 * Math.exp(1.92 * x)
  }
  // ~ moderate effort: TRIMP of 70 % HRR is ≈ 1.7 per minute
  return minutes * (a.sport === 'walk' ? 0.5 : 1.2)
}

export function loadSeries(acts: Activity[], hr: HrContext, until: string): LoadPoint[] {
  if (!acts.length) return []
  const perDay = new Map<string, number>()
  for (const a of acts) perDay.set(a.date, (perDay.get(a.date) ?? 0) + activityLoad(a, hr))
  const out: LoadPoint[] = []
  let ctl = 0
  let atl = 0
  const kC = 1 - Math.exp(-1 / 42)
  const kA = 1 - Math.exp(-1 / 7)
  for (let d = acts[0].date; d <= until; d = addDays(d, 1)) {
    const load = perDay.get(d) ?? 0
    ctl += (load - ctl) * kC
    atl += (load - atl) * kA
    out.push({ date: d, load, ctl, atl, tsb: ctl - atl })
  }
  return out
}

/** Running km per week (Monday start) for the `n` weeks ending with the week containing `asOf`. */
export function weeklyRunKm(acts: Activity[], asOf: string, n: number): { weekStart: string; km: number }[] {
  const first = addDays(weekStart(asOf), -7 * (n - 1))
  const weeks = Array.from({ length: n }, (_, i) => ({ weekStart: addDays(first, 7 * i), km: 0 }))
  for (const a of acts) {
    if (a.sport !== 'run' || a.date < first || a.date > asOf) continue
    const idx = Math.floor((Date.parse(a.date) - Date.parse(first)) / (7 * 86_400_000))
    if (weeks[idx]) weeks[idx].km += a.distanceM / 1000
  }
  return weeks.map((w) => ({ ...w, km: Math.round(w.km * 10) / 10 }))
}

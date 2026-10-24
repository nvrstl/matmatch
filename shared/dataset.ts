// The normalized data everything is computed from. Stored in SQLite locally, or on the device
// (browser storage) in the hosted version.
import type { Activity, Settings } from './types'

export interface DailyRow {
  date: string
  steps: number | null
  resting_hr: number | null
  stress_avg: number | null
  bb_max: number | null
}

export interface SleepRow {
  date: string
  total_s: number | null
  score: number | null
}

export interface HrvRow {
  date: string
  last_night: number | null
  weekly_avg: number | null
  status: string | null
}

export interface WeightRow {
  date: string
  kg: number | null
}

/** The training-day preferences from the Garmin profile that seed the planner. */
export interface ProfilePrefs {
  availableTrainingDays?: string[]
  preferredLongTrainingDays?: string[]
}

export interface Dataset {
  activities: Activity[] // sorted by start time
  daily: DailyRow[] // all sorted by date
  sleep: SleepRow[]
  hrv: HrvRow[]
  weight: WeightRow[]
  profile: ProfilePrefs | null
}

export const emptyDataset = (): Dataset => ({ activities: [], daily: [], sleep: [], hrv: [], weight: [], profile: null })

export const DEFAULT_SETTINGS: Settings = {
  goalRaceDate: null,
  goalHalfSeconds: null,
  runDaysPerWeek: 5,
  longRunDay: 6,
  restDays: [0, 4],
  maxWeeklyKm: null,
}

/** Newer rows replace older ones with the same id/date. */
export function mergeDataset(base: Dataset, next: Partial<Dataset>): Dataset {
  const upsert = <T>(a: T[], b: T[] | undefined, key: (x: T) => string | number, sortKey: (x: T) => string) => {
    if (!b?.length) return a
    const m = new Map(a.map((x) => [key(x), x]))
    for (const x of b) m.set(key(x), x)
    return [...m.values()].sort((x, y) => (sortKey(x) < sortKey(y) ? -1 : sortKey(x) > sortKey(y) ? 1 : 0))
  }
  const byDate = (x: { date: string }) => x.date
  return {
    activities: upsert(base.activities, next.activities, (a) => a.id, (a) => a.startLocal),
    daily: upsert(base.daily, next.daily, byDate, byDate),
    sleep: upsert(base.sleep, next.sleep, byDate, byDate),
    hrv: upsert(base.hrv, next.hrv, byDate, byDate),
    weight: upsert(base.weight, next.weight, byDate, byDate),
    profile: next.profile ?? base.profile,
  }
}

/** Saved settings win; otherwise seed run days and long-run day from the Garmin profile. */
export function effectiveSettings(saved: Partial<Settings> | null, profile: ProfilePrefs | null): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) }
  if (saved) return s
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

/** Validate a settings patch from the UI. */
export function cleanSettings(b: Partial<Settings>): Partial<Settings> {
  const patch: Partial<Settings> = {}
  if ('goalRaceDate' in b) patch.goalRaceDate = b.goalRaceDate && /^\d{4}-\d{2}-\d{2}$/.test(b.goalRaceDate) ? b.goalRaceDate : null
  if ('goalHalfSeconds' in b) patch.goalHalfSeconds = b.goalHalfSeconds && b.goalHalfSeconds > 3000 ? Math.round(b.goalHalfSeconds) : null
  if (typeof b.runDaysPerWeek === 'number') patch.runDaysPerWeek = Math.max(3, Math.min(7, Math.round(b.runDaysPerWeek)))
  if (typeof b.longRunDay === 'number' && b.longRunDay >= 0 && b.longRunDay <= 6) patch.longRunDay = b.longRunDay
  if (Array.isArray(b.restDays)) patch.restDays = b.restDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  if ('maxWeeklyKm' in b) patch.maxWeeklyKm = b.maxWeeklyKm && b.maxWeeklyKm > 0 ? b.maxWeeklyKm : null
  return patch
}

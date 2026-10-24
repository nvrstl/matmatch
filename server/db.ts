import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DEFAULT_SETTINGS, type DailyRow, type HrvRow, type SleepRow, type WeightRow } from '../shared/dataset'
import type { Activity, RaceKey, Settings, Sport } from '../shared/types'

const DB_PATH = resolve(process.env.LIFELONG_DB ?? 'data/lifelong.db')

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true })
  db = new DatabaseSync(DB_PATH)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      start_local TEXT NOT NULL,
      name TEXT,
      type_key TEXT,
      sport TEXT,
      distance_m REAL,
      duration_s REAL,
      elev_gain_m REAL,
      avg_hr REAL,
      max_hr REAL,
      calories REAL,
      training_load REAL,
      vo2max REAL,
      f_1k REAL, f_mile REAL, f_5k REAL, f_10k REAL, f_half REAL, f_marathon REAL,
      raw TEXT
    );
    CREATE INDEX IF NOT EXISTS activities_date ON activities(date);
    CREATE TABLE IF NOT EXISTS daily (
      date TEXT PRIMARY KEY,
      steps INTEGER, resting_hr INTEGER, min_hr INTEGER, max_hr INTEGER,
      stress_avg INTEGER, bb_max INTEGER, bb_min INTEGER,
      kcal_total INTEGER, kcal_active INTEGER, im_moderate INTEGER, im_vigorous INTEGER,
      raw TEXT
    );
    CREATE TABLE IF NOT EXISTS sleep (
      date TEXT PRIMARY KEY,
      total_s INTEGER, deep_s INTEGER, light_s INTEGER, rem_s INTEGER, awake_s INTEGER,
      score INTEGER, raw TEXT
    );
    CREATE TABLE IF NOT EXISTS hrv (
      date TEXT PRIMARY KEY,
      last_night INTEGER, weekly_avg INTEGER, status TEXT, raw TEXT
    );
    CREATE TABLE IF NOT EXISTS weight (
      date TEXT PRIMARY KEY,
      kg REAL, bmi REAL, body_fat REAL
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)
  return db
}

export function kvGet<T>(key: string): T | null {
  const row = getDb().prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as T) : null
}

export function kvSet(key: string, value: unknown) {
  getDb()
    .prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value))
}

// ---------------------------------------------------------------------------
// Activities

export interface ActivityRow {
  id: number
  date: string
  start_local: string
  name: string | null
  type_key: string | null
  sport: string | null
  distance_m: number | null
  duration_s: number | null
  elev_gain_m: number | null
  avg_hr: number | null
  max_hr: number | null
  calories: number | null
  training_load: number | null
  vo2max: number | null
  f_1k: number | null
  f_mile: number | null
  f_5k: number | null
  f_10k: number | null
  f_half: number | null
  f_marathon: number | null
}

export function upsertActivity(a: Activity, raw: unknown) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO activities
       (id, date, start_local, name, type_key, sport, distance_m, duration_s, elev_gain_m, avg_hr, max_hr,
        calories, training_load, vo2max, f_1k, f_mile, f_5k, f_10k, f_half, f_marathon, raw)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      a.id, a.date, a.startLocal, a.name, a.typeKey, a.sport, a.distanceM, a.durationS, a.elevGainM,
      a.avgHr, a.maxHr, a.calories, a.trainingLoad, a.vo2max,
      a.fastest['1k'] ?? null, a.fastest.mile ?? null, a.fastest['5k'] ?? null, a.fastest['10k'] ?? null,
      a.fastest.half ?? null, a.fastest.marathon ?? null,
      raw === undefined ? null : JSON.stringify(raw),
    )
}

export function rowToActivity(r: ActivityRow): Activity {
  const fastest: Activity['fastest'] = {}
  const pairs: [RaceKey | '1k' | 'mile', number | null][] = [
    ['1k', r.f_1k], ['mile', r.f_mile], ['5k', r.f_5k], ['10k', r.f_10k], ['half', r.f_half], ['marathon', r.f_marathon],
  ]
  for (const [k, v] of pairs) if (v) fastest[k] = v
  return {
    id: r.id,
    date: r.date,
    startLocal: r.start_local,
    name: r.name ?? '',
    typeKey: r.type_key ?? 'other',
    sport: (r.sport ?? 'other') as Sport,
    distanceM: r.distance_m ?? 0,
    durationS: r.duration_s ?? 0,
    elevGainM: r.elev_gain_m,
    avgHr: r.avg_hr,
    maxHr: r.max_hr,
    calories: r.calories,
    trainingLoad: r.training_load,
    vo2max: r.vo2max,
    fastest,
  }
}

export function allActivities(): Activity[] {
  const rows = getDb()
    .prepare(
      `SELECT id, date, start_local, name, type_key, sport, distance_m, duration_s, elev_gain_m, avg_hr, max_hr,
              calories, training_load, vo2max, f_1k, f_mile, f_5k, f_10k, f_half, f_marathon
       FROM activities ORDER BY start_local`,
    )
    .all() as unknown as ActivityRow[]
  return rows.map(rowToActivity)
}

// ---------------------------------------------------------------------------
// Wellness

export const wellness = {
  daily: () =>
    getDb().prepare('SELECT date, steps, resting_hr, stress_avg, bb_max FROM daily ORDER BY date').all() as unknown as DailyRow[],
  sleep: () => getDb().prepare('SELECT date, total_s, score FROM sleep ORDER BY date').all() as unknown as SleepRow[],
  hrv: () =>
    getDb().prepare('SELECT date, last_night, weekly_avg, status FROM hrv ORDER BY date').all() as unknown as HrvRow[],
  weight: () => getDb().prepare('SELECT date, kg FROM weight ORDER BY date').all() as unknown as WeightRow[],
}

export function tableCounts(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of ['activities', 'daily', 'sleep', 'hrv', 'weight']) {
    out[t] = (getDb().prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
  }
  return out
}

// ---------------------------------------------------------------------------
// Settings

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...DEFAULT_SETTINGS, ...(kvGet<Partial<Settings>>('settings') ?? {}), ...patch }
  kvSet('settings', next)
  return next
}

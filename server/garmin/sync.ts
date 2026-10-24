// Pulls lifelong history from the Personal API into SQLite. Re-runs are incremental.
import { chunks } from '../../shared/chunks'
import { addDays, localToday } from '../../shared/dates'
import type { SyncStatus } from '../../shared/types'
import { getDb, kvGet, kvSet, tableCounts, upsertActivity } from '../db'
import { GarminClient } from './client'
import { fetchActivities, fetchDaily, fetchHrv, fetchProfile, fetchSleep, fetchWeight, RANGE_DAYS } from './fetch'

const status: SyncStatus = {
  running: false,
  phase: 'idle',
  message: '',
  startedAt: null,
  finishedAt: null,
  error: null,
  hasKey: false,
  counts: {},
}

export function getSyncStatus(): SyncStatus {
  const last = kvGet<{ finishedAt: string; error: string | null }>('last_sync')
  return {
    ...status,
    finishedAt: status.finishedAt ?? last?.finishedAt ?? null,
    error: status.error ?? last?.error ?? null,
    hasKey: Boolean(process.env.GARMIN_API_KEY),
    counts: tableCounts(),
  }
}

const report = (phase: string, message: string, log = true) => {
  status.phase = phase
  status.message = message
  if (log) console.log(`[sync] ${phase}: ${message}`)
}

export async function runSync(opts: { full?: boolean } = {}): Promise<void> {
  if (status.running) throw new Error('A sync is already running')
  const key = process.env.GARMIN_API_KEY
  if (!key) throw new Error('GARMIN_API_KEY is not set. Add it to .env (see .env.example).')

  Object.assign(status, { running: true, startedAt: new Date().toISOString(), finishedAt: null, error: null })
  const client = new GarminClient(key)
  const db = getDb()
  const today = localToday()
  const cursors = opts.full ? {} : (kvGet<Record<string, string>>('sync_cursors') ?? {})
  const saveCursor = (k: string, v: string) => {
    cursors[k] = v
    kvSet('sync_cursors', cursors)
  }

  try {
    // --- Profile settings (training-day preferences seed the planner) --------------
    report('profile', 'Reading profile settings')
    const profile = await fetchProfile(client)
    if (profile) kvSet('profile', profile)

    // --- Activities: page through everything, newest first ------------------------
    const since = cursors.activities ? addDays(cursors.activities, -3) : undefined
    report('activities', since ? `New activities since ${since}` : 'Fetching all activities')
    const acts = await fetchActivities(client, {
      since,
      today,
      onPage: (n) => report('activities', `Activities fetched: ${n}`, n % 1000 === 0),
    })
    db.exec('BEGIN')
    for (const { row, raw } of acts) upsertActivity(row, raw)
    db.exec('COMMIT')
    report('activities', `Activities fetched: ${acts.length}`)
    saveCursor('activities', today)

    // --- Wellness ranges: start from history start, or resume from the cursor -------
    const first = (db.prepare('SELECT MIN(date) AS d FROM activities').get() as { d: string | null }).d
    const historyStart = process.env.GARMIN_HISTORY_START ?? first ?? addDays(today, -5 * 365)
    const from = (k: string) => (cursors[k] ? addDays(cursors[k], -7) : historyStart)

    const ranged = async <T>(
      name: keyof typeof RANGE_DAYS,
      fetchRange: (a: string, b: string) => Promise<T[]>,
      insert: (row: T) => void,
    ) => {
      let n = 0
      const parts = chunks(from(name), today, RANGE_DAYS[name])
      for (const [i, [a, b]] of parts.entries()) {
        report(name, `${a} → ${b} (${i + 1}/${parts.length}), ${n} records`, false)
        const rows = await fetchRange(a, b)
        db.exec('BEGIN')
        for (const r of rows) insert(r)
        db.exec('COMMIT')
        n += rows.length
      }
      report(name, `${n} records`)
      saveCursor(name, today)
    }

    const insDaily = db.prepare(
      `INSERT OR REPLACE INTO daily (date, steps, resting_hr, min_hr, max_hr, stress_avg, bb_max, bb_min,
        kcal_total, kcal_active, im_moderate, im_vigorous, raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    await ranged('daily', (a, b) => fetchDaily(client, a, b), ({ row: d, raw }) =>
      insDaily.run(d.date, d.steps, d.resting_hr, d.min_hr, d.max_hr, d.stress_avg, d.bb_max, d.bb_min,
        d.kcal_total, d.kcal_active, d.im_moderate, d.im_vigorous, JSON.stringify(raw)),
    )

    const insSleep = db.prepare(
      'INSERT OR REPLACE INTO sleep (date, total_s, deep_s, light_s, rem_s, awake_s, score, raw) VALUES (?,?,?,?,?,?,?,?)',
    )
    await ranged('sleep', (a, b) => fetchSleep(client, a, b), ({ row: s, raw }) =>
      insSleep.run(s.date, s.total_s, s.deep_s, s.light_s, s.rem_s, s.awake_s, s.score, JSON.stringify(raw)),
    )

    const insHrv = db.prepare('INSERT OR REPLACE INTO hrv (date, last_night, weekly_avg, status, raw) VALUES (?,?,?,?,?)')
    await ranged('hrv', (a, b) => fetchHrv(client, a, b), ({ row: h, raw }) =>
      insHrv.run(h.date, h.last_night, h.weekly_avg, h.status, JSON.stringify(raw)),
    )

    const insWeight = db.prepare('INSERT OR REPLACE INTO weight (date, kg, bmi, body_fat) VALUES (?,?,?,?)')
    await ranged('weight', (a, b) => fetchWeight(client, a, b), ({ row: w }) => insWeight.run(w.date, w.kg, w.bmi, w.body_fat))

    report('done', 'Sync complete')
    kvSet('last_sync', { finishedAt: new Date().toISOString(), error: null })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    status.error = msg
    report('error', msg)
    kvSet('last_sync', { finishedAt: new Date().toISOString(), error: msg })
    throw e
  } finally {
    status.running = false
    status.finishedAt = new Date().toISOString()
  }
}

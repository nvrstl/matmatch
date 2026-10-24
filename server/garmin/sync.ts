// Pulls lifelong history from the Personal API into SQLite. Re-runs are incremental.
import { addDays, localToday } from '../../shared/dates'
import type { SyncStatus } from '../../shared/types'
import { getDb, kvGet, kvSet, tableCounts, upsertActivity } from '../db'
import { GarminClient } from './client'
import { mapActivity, mapDaily, mapHrv, mapSleep, mapWeight } from './map'

type Obj = Record<string, unknown>

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

/** Split [from, to] into consecutive inclusive chunks of at most `days` days. */
export function chunks(from: string, to: string, days: number): [string, string][] {
  const out: [string, string][] = []
  for (let start = from; start <= to; start = addDays(start, days)) {
    const end = addDays(start, days - 1)
    out.push([start, end < to ? end : to])
  }
  return out
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
    const profile = await client.get<Obj>('/userprofile-service/userprofile/settings')
    if (profile) kvSet('profile', profile)

    // --- Activities: page through everything, newest first ------------------------
    const since = cursors.activities ? addDays(cursors.activities, -3) : undefined
    let fetched = 0
    for (let start = 0; ; start += 100) {
      report('activities', since ? `New activities since ${since}: ${fetched}` : `Activities fetched: ${fetched}`, start % 1000 === 0)
      const page = await client.get<Obj[]>('/activitylist-service/activities/search/activities', {
        start,
        limit: 100,
        sortOrder: 'desc',
        excludeChildren: false,
        startDate: since,
        endDate: since ? today : undefined,
      })
      if (!page?.length) break
      db.exec('BEGIN')
      for (const raw of page) {
        const a = mapActivity(raw)
        if (a) upsertActivity(a, raw)
      }
      db.exec('COMMIT')
      fetched += page.length
      if (page.length < 100) break
    }
    report('activities', `Activities fetched: ${fetched}`)
    saveCursor('activities', today)

    // --- Wellness ranges: start from history start, or resume from the cursor -------
    const first = (db.prepare('SELECT MIN(date) AS d FROM activities').get() as { d: string | null }).d
    const historyStart = process.env.GARMIN_HISTORY_START ?? first ?? addDays(today, -5 * 365)
    const from = (k: string) => (cursors[k] ? addDays(cursors[k], -7) : historyStart)

    const ranged = async (
      name: string,
      days: number,
      fetchRange: (a: string, b: string) => Promise<number>,
    ) => {
      let n = 0
      const parts = chunks(from(name), today, days)
      for (const [i, [a, b]] of parts.entries()) {
        report(name, `${a} → ${b} (${i + 1}/${parts.length}), ${n} records`, false)
        db.exec('BEGIN')
        try {
          n += await fetchRange(a, b)
          db.exec('COMMIT')
        } catch (e) {
          db.exec('ROLLBACK')
          throw e
        }
      }
      report(name, `${n} records`)
      saveCursor(name, today)
    }

    const insDaily = db.prepare(
      `INSERT OR REPLACE INTO daily (date, steps, resting_hr, min_hr, max_hr, stress_avg, bb_max, bb_min,
        kcal_total, kcal_active, im_moderate, im_vigorous, raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    await ranged('daily', 365, async (a, b) => {
      const res = await client.get<{ data?: Obj[] }>('/usersummary-service/v2/dailysummaries', { startDate: a, endDate: b })
      const rows = res?.data ?? []
      for (const raw of rows) {
        const d = mapDaily(raw)
        insDaily.run(d.date, d.steps, d.resting_hr, d.min_hr, d.max_hr, d.stress_avg, d.bb_max, d.bb_min,
          d.kcal_total, d.kcal_active, d.im_moderate, d.im_vigorous, JSON.stringify(raw))
      }
      return rows.length
    })

    const insSleep = db.prepare(
      'INSERT OR REPLACE INTO sleep (date, total_s, deep_s, light_s, rem_s, awake_s, score, raw) VALUES (?,?,?,?,?,?,?,?)',
    )
    await ranged('sleep', 31, async (a, b) => {
      const rows = (await client.get<Obj[]>('/sleep-service/sleep/dailySleepSummariesByDate', { startDate: a, endDate: b })) ?? []
      let n = 0
      for (const raw of rows) {
        const s = mapSleep(raw)
        if (!s.total_s) continue
        insSleep.run(s.date, s.total_s, s.deep_s, s.light_s, s.rem_s, s.awake_s, s.score, JSON.stringify(raw))
        n++
      }
      return n
    })

    const insHrv = db.prepare('INSERT OR REPLACE INTO hrv (date, last_night, weekly_avg, status, raw) VALUES (?,?,?,?,?)')
    await ranged('hrv', 31, async (a, b) => {
      const res = await client.get<{ hrvSummaries?: Obj[] }>(`/hrv-service/hrv/daily/${a}/${b}`)
      const rows = res?.hrvSummaries ?? []
      for (const raw of rows) {
        const h = mapHrv(raw)
        insHrv.run(h.date, h.last_night, h.weekly_avg, h.status, JSON.stringify(raw))
      }
      return rows.length
    })

    const insWeight = db.prepare('INSERT OR REPLACE INTO weight (date, kg, bmi, body_fat) VALUES (?,?,?,?)')
    await ranged('weight', 365, async (a, b) => {
      const rows = (await client.get<Obj[]>(`/weight-service/weight/all/${a}/${b}`)) ?? []
      let n = 0
      for (const raw of rows) {
        const w = mapWeight(raw)
        if (!w?.kg) continue
        insWeight.run(w.date, w.kg, w.bmi, w.body_fat)
        n++
      }
      return n
    })

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

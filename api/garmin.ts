// Vercel serverless function: the hosted app's only server code. It holds the Garmin key
// (GARMIN_API_KEY env var), checks the app password (APP_PASSWORD env var) and returns one slice
// of normalized data per call; the browser drives the sync and keeps the data on the device.
//
//   GET /api/garmin?part=check                        → 204 if the password is right
//   GET /api/garmin?part=profile
//   GET /api/garmin?part=activities[&since=YYYY-MM-DD]
//   GET /api/garmin?part=wellness&from=YYYY-MM-DD&to=YYYY-MM-DD   (at most 366 days)
import { createHash, timingSafeEqual } from 'node:crypto'
import { chunks } from '../shared/chunks.js'
import { daysBetween } from '../shared/dates.js'
import { GarminApiError, GarminClient } from '../server/garmin/client.js'
import { fetchActivities, fetchDaily, fetchHrv, fetchProfile, fetchSleep, fetchWeight, RANGE_DAYS } from '../server/garmin/fetch.js'

export const maxDuration = 60

let cached: { key: string; client: GarminClient } | null = null

const DATE = /^\d{4}-\d{2}-\d{2}$/
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

function passwordOk(given: string | null): boolean {
  const expected = process.env.APP_PASSWORD
  if (!expected || !given) return false
  const h = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(h(given), h(expected))
}

/** Run async jobs with limited concurrency, keeping order. */
async function pool<T>(jobs: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++
        out[i] = await jobs[i]()
      }
    }),
  )
  return out
}

export async function GET(request: Request): Promise<Response> {
  if (!process.env.APP_PASSWORD) return json({ error: 'APP_PASSWORD is not configured on the server.' }, 503)
  if (!passwordOk(request.headers.get('x-app-password'))) return json({ error: 'Wrong password.' }, 401)
  const key = process.env.GARMIN_API_KEY
  if (!key) return json({ error: 'GARMIN_API_KEY is not configured on the server.' }, 503)

  const url = new URL(request.url)
  const part = url.searchParams.get('part')
  // Reused while this function instance stays warm, so a sync needs only one token request.
  if (!cached || cached.key !== key) cached = { key, client: new GarminClient(key, 0) }
  const { client } = cached
  try {
    switch (part) {
      case 'check':
        return new Response(null, { status: 204 })
      case 'profile': {
        const p = await fetchProfile(client)
        return json({
          availableTrainingDays: p?.availableTrainingDays ?? [],
          preferredLongTrainingDays: p?.preferredLongTrainingDays ?? [],
        })
      }
      case 'activities': {
        const since = url.searchParams.get('since')
        const today = url.searchParams.get('today')
        if ((since && !DATE.test(since)) || !today || !DATE.test(today)) return json({ error: 'Bad dates' }, 400)
        const acts = await fetchActivities(client, { since: since ?? undefined, today })
        return json(acts.map((a) => a.row))
      }
      case 'wellness': {
        const from = url.searchParams.get('from')
        const to = url.searchParams.get('to')
        if (!from || !to || !DATE.test(from) || !DATE.test(to) || to < from || daysBetween(from, to) > 366) {
          return json({ error: 'Bad range' }, 400)
        }
        const rows = <T>(fetcher: (a: string, b: string) => Promise<{ row: T }[]>, days: number) =>
          chunks(from, to, days).map(([a, b]) => async () => (await fetcher(a, b)).map((r) => r.row))
        const flat = async <T>(jobs: (() => Promise<T[]>)[]) => (await pool(jobs, 6)).flat()
        const [daily, sleep, hrv, weight] = await Promise.all([
          flat(rows((a, b) => fetchDaily(client, a, b), RANGE_DAYS.daily)),
          flat(rows((a, b) => fetchSleep(client, a, b), RANGE_DAYS.sleep)),
          flat(rows((a, b) => fetchHrv(client, a, b), RANGE_DAYS.hrv)),
          flat(rows((a, b) => fetchWeight(client, a, b), RANGE_DAYS.weight)),
        ])
        return json({
          daily: daily.map((d) => ({ date: d.date, steps: d.steps, resting_hr: d.resting_hr, stress_avg: d.stress_avg, bb_max: d.bb_max })),
          sleep: sleep.map((s) => ({ date: s.date, total_s: s.total_s, score: s.score })),
          hrv,
          weight: weight.map((w) => ({ date: w.date, kg: w.kg })),
        })
      }
      default:
        return json({ error: 'Unknown part' }, 400)
    }
  } catch (e) {
    const status = e instanceof GarminApiError && e.status === 401 ? 502 : 500
    return json({ error: e instanceof Error ? e.message : String(e) }, status)
  }
}

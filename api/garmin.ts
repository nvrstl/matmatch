// Vercel serverless function: the hosted app's only server code. Anyone can use the app with
// their own Garmin Personal API key. The key and data stay on each person's device; this function
// only relays requests to Garmin (the browser can't call Garmin directly) and stores nothing.
// It never uses a server-side key, so nobody can read anyone else's data through it.
//
//   GET /api/garmin?part=token        header x-garmin-key   → { token, expiresAt }
//   GET /api/garmin?part=profile      header x-garmin-token
//   GET /api/garmin?part=activities&today=YYYY-MM-DD[&since=YYYY-MM-DD]
//   GET /api/garmin?part=wellness&from=YYYY-MM-DD&to=YYYY-MM-DD   (at most 366 days)
//
// The browser keeps the 24h token and reuses it, because Garmin rate-limits token requests.
// A 401 response with { reason: 'token' } means "get a new token"; { reason: 'key' } means the
// key itself was rejected. A 429 { reason: 'rate', retryInSeconds } means "pause, then retry"
// (Garmin allows ~100 requests a minute per user).
import { chunks } from '../shared/chunks.js'
import { daysBetween } from '../shared/dates.js'
import { GarminApiError, GarminClient } from '../server/garmin/client.js'
import { fetchActivities, fetchDaily, fetchHrv, fetchProfile, fetchSleep, fetchWeight, RANGE_DAYS } from '../server/garmin/fetch.js'

export const maxDuration = 60

const DATE = /^\d{4}-\d{2}-\d{2}$/
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

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

// A Garmin key or token is a long opaque string; reject anything else before calling Garmin.
const plausible = (s: string | null): s is string => !!s && s.length >= 20 && s.length <= 4096 && /^[\x21-\x7e]+$/.test(s)

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const part = url.searchParams.get('part')

  try {
    if (part === 'token') {
      const key = request.headers.get('x-garmin-key')
      if (!plausible(key)) return json({ error: 'Paste your Garmin Personal API key.', reason: 'key' }, 400)
      try {
        return json(await new GarminClient(key, 0).exchangeKey())
      } catch (e) {
        if (e instanceof GarminApiError && (e.status === 401 || e.status === 403)) {
          return json({ error: 'Garmin rejected this key. Check it, or create a new one in Garmin Connect.', reason: 'key' }, 401)
        }
        throw e
      }
    }

    const token = request.headers.get('x-garmin-token')
    if (!plausible(token)) return json({ error: 'Missing Garmin token.', reason: 'token' }, 401)
    const client = GarminClient.withToken(token)

    switch (part) {
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
        // One shared queue, 4 requests at a time: Garmin answers bigger bursts with 429s.
        type Rows = { kind: 'daily' | 'sleep' | 'hrv' | 'weight'; rows: unknown[] }
        const jobs: (() => Promise<Rows>)[] = []
        const add = <T>(kind: Rows['kind'], fetcher: (a: string, b: string) => Promise<{ row: T }[]>) => {
          for (const [a, b] of chunks(from, to, RANGE_DAYS[kind])) {
            jobs.push(async () => ({ kind, rows: (await fetcher(a, b)).map((r) => r.row) }))
          }
        }
        add('daily', (a, b) => fetchDaily(client, a, b))
        add('sleep', (a, b) => fetchSleep(client, a, b))
        add('hrv', (a, b) => fetchHrv(client, a, b))
        add('weight', (a, b) => fetchWeight(client, a, b))
        const results = await pool(jobs, 4)
        const of = <T>(kind: Rows['kind']) => results.filter((r) => r.kind === kind).flatMap((r) => r.rows as T[])
        const daily = of<Awaited<ReturnType<typeof fetchDaily>>[number]['row']>('daily')
        const sleep = of<Awaited<ReturnType<typeof fetchSleep>>[number]['row']>('sleep')
        const hrv = of<Awaited<ReturnType<typeof fetchHrv>>[number]['row']>('hrv')
        const weight = of<Awaited<ReturnType<typeof fetchWeight>>[number]['row']>('weight')
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
    if (e instanceof GarminApiError && e.status === 401) return json({ error: 'The Garmin token expired.', reason: 'token' }, 401)
    if (e instanceof GarminApiError && e.status === 429) {
      return json({ error: e.message, reason: 'rate', retryInSeconds: e.retryInSeconds ?? 30 }, 429)
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, 502)
  }
}

// One function per Garmin Personal API data type, returning normalized rows (plus the raw DTO,
// which the local SQLite store keeps). Shared by the local sync and the hosted (Vercel) function.
import type { Activity } from '../../shared/types.js'
import type { GarminClient } from './client.js'
import { mapActivity, mapDaily, mapHrv, mapSleep, mapWeight } from './map.js'

type Obj = Record<string, unknown>
export interface WithRaw<T> {
  row: T
  raw: Obj
}

/** Range limits per request, in days (from Garmin's API reference and testing). */
export const RANGE_DAYS = { daily: 365, sleep: 31, hrv: 31, weight: 365 } as const

export async function fetchProfile(client: GarminClient) {
  return client.get<Obj>('/userprofile-service/userprofile/settings')
}

/** All activities (or those since a date), newest first, 100 per page. */
export async function fetchActivities(
  client: GarminClient,
  opts: { since?: string; today: string; onPage?: (fetched: number) => void },
): Promise<WithRaw<Activity>[]> {
  const out: WithRaw<Activity>[] = []
  for (let start = 0; ; start += 100) {
    const page = await client.get<Obj[]>('/activitylist-service/activities/search/activities', {
      start,
      limit: 100,
      sortOrder: 'desc',
      excludeChildren: false,
      startDate: opts.since,
      endDate: opts.since ? opts.today : undefined,
    })
    if (!page?.length) break
    for (const raw of page) {
      const row = mapActivity(raw)
      if (row) out.push({ row, raw })
    }
    opts.onPage?.(out.length)
    if (page.length < 100) break
  }
  return out
}

export async function fetchDaily(client: GarminClient, from: string, to: string) {
  const res = await client.get<{ data?: Obj[] }>('/usersummary-service/v2/dailysummaries', { startDate: from, endDate: to })
  return (res?.data ?? []).map((raw) => ({ row: mapDaily(raw), raw }))
}

export async function fetchSleep(client: GarminClient, from: string, to: string) {
  const rows = (await client.get<Obj[]>('/sleep-service/sleep/dailySleepSummariesByDate', { startDate: from, endDate: to })) ?? []
  return rows.map((raw) => ({ row: mapSleep(raw), raw })).filter((s) => s.row.total_s)
}

export async function fetchHrv(client: GarminClient, from: string, to: string) {
  const res = await client.get<{ hrvSummaries?: Obj[] }>(`/hrv-service/hrv/daily/${from}/${to}`)
  return (res?.hrvSummaries ?? []).map((raw) => ({ row: mapHrv(raw), raw }))
}

export async function fetchWeight(client: GarminClient, from: string, to: string) {
  // weight/all answers 400 for ranges; the range endpoint returns each day's latest weigh-in.
  const res = await client.get<{ dailyWeightSummaries?: Obj[] }>(`/weight-service/weight/range/${from}/${to}`)
  const out: WithRaw<NonNullable<ReturnType<typeof mapWeight>>>[] = []
  for (const day of res?.dailyWeightSummaries ?? []) {
    const raw = { calendarDate: day.summaryDate, ...((day.latestWeight as Obj | undefined) ?? {}) }
    const row = mapWeight(raw)
    if (row?.kg) out.push({ row, raw })
  }
  return out
}

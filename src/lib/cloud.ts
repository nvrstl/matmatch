// Hosted mode (VITE_CLOUD=1, e.g. on Vercel): data lives on this device (IndexedDB), is pulled
// from Garmin through the password-protected /api/garmin function, and every view is computed
// in the browser with the same code the local server uses.
import { chunks } from '../../shared/chunks'
import { activitiesPage, overview, plan, prepare, progress, type Computed } from '../../shared/compute'
import { cleanSettings, effectiveSettings, emptyDataset, mergeDataset, type Dataset, type ProfilePrefs } from '../../shared/dataset'
import { addDays, localToday } from '../../shared/dates'
import type { Activity, Settings, SyncStatus } from '../../shared/types'

export const IS_CLOUD = Boolean(import.meta.env.VITE_CLOUD)

// ---------------------------------------------------------------------------
// Tiny IndexedDB key-value store (localStorage is too small for years of data)

const idb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('lifelong', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv').objectStore('kv').get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      /* storage unavailable: the app still works for this session */
    }
  },
}

// ---------------------------------------------------------------------------
// State

interface Meta {
  lastSync: string | null // local date of the last successful sync
  finishedAt: string | null
  /** An unfinished sync: health data is saved through `doneThrough`, continue from there. */
  pending?: { from: string; to: string; doneThrough: string | null; activitiesDone: boolean } | null
}

let dataset: Dataset = emptyDataset()
let meta: Meta = { lastSync: null, finishedAt: null }
let computed: { version: number; c: Computed } | null = null
let version = 0
const status: SyncStatus = {
  running: false,
  phase: 'idle',
  message: '',
  startedAt: null,
  finishedAt: null,
  error: null,
  hasKey: true,
  counts: {},
}

const loaded = (async () => {
  try {
    dataset = (await idbGet<Dataset>('dataset')) ?? emptyDataset()
    meta = (await idbGet<Meta>('meta')) ?? meta
  } catch {
    /* private mode etc.: start empty */
  }
})()

const changed = () => {
  version++
  window.dispatchEvent(new Event('lifelong:data'))
}

function current(): Computed {
  const today = localToday()
  if (!computed || computed.version !== version || computed.c.today !== today) {
    computed = { version, c: prepare(dataset, today) }
  }
  return computed.c
}

// ---------------------------------------------------------------------------
// Garmin connection: each person's own key, kept on their device only

const KEY = 'lifelong:garmin-key'
const TOKEN = 'lifelong:garmin-token'

export const getKey = () => ls.get(KEY)

const connected = () => window.dispatchEvent(new Event('lifelong:auth'))

/** Shown on the Sync page while waiting for Garmin. */
let onWait: ((message: string) => void) | null = null
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * One call to /api/garmin, patiently: waits out Garmin's per-minute limit for as long as it asks
 * (up to 20 minutes in total) and retries brief outages (Garmin hiccups, timeouts, no network).
 */
async function call(params: Record<string, string>, headers: Record<string, string>) {
  let waited = 0
  for (let outage = 0; ; ) {
    let res: Response
    try {
      res = await fetch(`/api/garmin?${new URLSearchParams(params)}`, { headers })
    } catch {
      res = new Response(null, { status: 599 }) // offline or connection dropped
    }
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      reason?: 'key' | 'token' | 'rate'
      retryInSeconds?: number
    }
    if (res.status === 429 && waited < 20 * 60) {
      const wait = Math.max(5, Math.min(300, Number(body.retryInSeconds) || 30))
      for (let left = wait; left > 0; left--) {
        onWait?.(`Garmin allows a limited number of requests per minute. Continuing in ${left} s…`)
        await pause(1000)
      }
      waited += wait
      continue
    }
    if (res.status >= 500 && outage < 4) {
      outage++
      onWait?.(res.status === 599 ? 'No connection, retrying…' : 'Garmin didn’t answer, retrying…')
      await pause(5000 * 2 ** (outage - 1))
      continue
    }
    if (res.status === 429) {
      throw new Error('Garmin is limiting requests right now. Your progress is saved; sync again in a few minutes to continue.')
    }
    return { res, body }
  }
}

/** Exchange the key for a 24h token and keep it; Garmin rate-limits token requests. */
async function newToken(key: string): Promise<string> {
  const { res, body } = await call({ part: 'token' }, { 'x-garmin-key': key })
  if (!res.ok) throw new Error(body.error ?? `Couldn't reach Garmin (${res.status}).`)
  const { token, expiresAt } = body as unknown as { token: string; expiresAt: number }
  ls.set(TOKEN, JSON.stringify({ token, expiresAt }))
  return token
}

function savedToken(): string | null {
  try {
    const t = JSON.parse(ls.get(TOKEN) ?? 'null') as { token: string; expiresAt: number } | null
    return t && t.expiresAt > Date.now() ? t.token : null
  } catch {
    return null
  }
}

async function garmin<T>(params: Record<string, string>): Promise<T> {
  const key = getKey()
  if (!key) throw new Error('Connect your Garmin account first.')
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = savedToken() ?? (await newToken(key))
    const { res, body } = await call(params, { 'x-garmin-token': token })
    if (res.ok) return body as T
    if (res.status === 401 && body.reason === 'token' && attempt === 0) {
      ls.set(TOKEN, null) // expired or revoked: get a fresh one and retry once
      continue
    }
    throw new Error(body.error ?? `Request failed (${res.status})`)
  }
  throw new Error('Garmin rejected the connection. Reconnect with a new key on the Sync page.')
}

/** Validate and store a key. A different key than before means a different person: clear the data. */
export async function connect(key: string): Promise<void> {
  const k = key.trim()
  await newToken(k)
  const fingerprint = k.slice(-12)
  if (ls.get('lifelong:key-fp') !== fingerprint) await forgetDeviceData()
  ls.set('lifelong:key-fp', fingerprint)
  ls.set(KEY, k)
  connected()
}

/** Remove the key, token and all data from this device. */
export async function disconnect() {
  for (const k of [KEY, TOKEN, 'lifelong:key-fp', 'lifelong:settings']) ls.set(k, null)
  await forgetDeviceData()
  connected()
}

async function forgetDeviceData() {
  dataset = emptyDataset()
  meta = { lastSync: null, finishedAt: null }
  await idbSet('dataset', dataset).catch(() => {})
  await idbSet('meta', meta).catch(() => {})
  changed()
}

// ---------------------------------------------------------------------------
// Sync: the browser drives it, one small request per slice, so no call hits a time limit.

export async function sync(full = false): Promise<void> {
  if (status.running) return
  await loaded
  const today = localToday()
  Object.assign(status, { running: true, startedAt: new Date().toISOString(), error: null })
  const report = (phase: string, message: string) => {
    Object.assign(status, { phase, message })
    window.dispatchEvent(new Event('lifelong:sync'))
  }
  const save = async () => {
    await idbSet('dataset', dataset).catch(() => {})
    await idbSet('meta', meta).catch(() => {})
  }
  let phase = 'profile'
  onWait = (message) => report(phase, message)
  try {
    if (full) {
      dataset = emptyDataset()
      meta = { ...meta, lastSync: null, pending: null }
    }
    const resuming = Boolean(meta.pending)
    const incremental = !resuming && meta.lastSync !== null

    if (!meta.pending?.activitiesDone) {
      phase = 'activities'
      report(phase, incremental ? `New activities since ${meta.lastSync}` : 'Downloading all activities')
      const profile = await garmin<ProfilePrefs>({ part: 'profile' })
      const activities = await garmin<Activity[]>({
        part: 'activities',
        today,
        ...(incremental ? { since: addDays(meta.lastSync!, -3) } : {}),
      })
      dataset = mergeDataset(dataset, { activities, profile })
      const first = dataset.activities[0]?.date ?? addDays(today, -5 * 365)
      meta = {
        ...meta,
        pending: { from: incremental ? addDays(meta.lastSync!, -7) : first, to: today, doneThrough: null, activitiesDone: true },
      }
      await save()
      changed()
    }

    const pending = meta.pending!
    const start = pending.doneThrough ? addDays(pending.doneThrough, 1) : pending.from
    const parts = start <= today ? chunks(start, today, 365) : []
    for (const [i, [a, b]] of parts.entries()) {
      phase = 'health'
      report(phase, `Health data ${a.slice(0, 4)}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ''}${resuming ? ', continuing where it stopped' : ''}`)
      const w = await garmin<Pick<Dataset, 'daily' | 'sleep' | 'hrv' | 'weight'>>({ part: 'wellness', from: a, to: b })
      dataset = mergeDataset(dataset, w)
      meta = { ...meta, pending: { ...pending, doneThrough: b } }
      await save() // an interrupted sync resumes from here
      changed()
    }

    meta = { lastSync: today, finishedAt: new Date().toISOString(), pending: null }
    await save()
    report('done', 'Up to date')
    changed()
  } catch (e) {
    status.error = e instanceof Error ? e.message : String(e)
    report('error', status.error)
  } finally {
    onWait = null
    status.running = false
    status.finishedAt = new Date().toISOString()
    window.dispatchEvent(new Event('lifelong:sync'))
  }
}

/** Sync on open when the data is more than 3 hours old, or finish an interrupted sync. */
export async function autoSync() {
  await loaded
  if (!getKey()) return
  const age = meta.finishedAt ? Date.now() - Date.parse(meta.finishedAt) : Infinity
  if (meta.pending || age > 3 * 3600_000) void sync()
}

// ---------------------------------------------------------------------------
// The same routes the local server answers

const settings = (): Settings => {
  let saved: Partial<Settings> | null
  try {
    saved = JSON.parse(ls.get('lifelong:settings') ?? 'null')
  } catch {
    saved = null
  }
  return effectiveSettings(saved, dataset.profile)
}

export async function cloudFetch<T>(path: string, init?: RequestInit): Promise<T> {
  await loaded
  const url = new URL(path, 'http://x')
  const method = init?.method ?? 'GET'
  const p = url.pathname
  if (p === '/settings' && method === 'PUT') {
    const next = { ...settings(), ...cleanSettings(JSON.parse(String(init?.body ?? '{}'))) }
    ls.set('lifelong:settings', JSON.stringify(next))
    changed()
    return settings() as T
  }
  if (p === '/sync' && method === 'POST') {
    void sync(url.searchParams.get('full') === '1')
    return { ...status, running: true } as T
  }
  switch (p) {
    case '/overview':
      return overview(current()) as T
    case '/progress':
      return progress(current()) as T
    case '/predictions':
      return current().predictions as T
    case '/plan':
      return plan(current(), settings()) as T
    case '/settings':
      return settings() as T
    case '/activities':
      return activitiesPage(
        dataset.activities,
        url.searchParams.get('sport') ?? '',
        url.searchParams.get('q') ?? '',
        Number(url.searchParams.get('page')) || 0,
      ) as T
    case '/sync':
      return {
        ...status,
        finishedAt: meta.finishedAt ?? status.finishedAt,
        counts: {
          activities: dataset.activities.length,
          daily: dataset.daily.length,
          sleep: dataset.sleep.length,
          hrv: dataset.hrv.length,
          weight: dataset.weight.length,
        },
      } as T
  }
  throw new Error(`Unknown route ${p}`)
}

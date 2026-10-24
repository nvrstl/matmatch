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
// Password

export const getPassword = () => ls.get('lifelong:pw')

export class AuthError extends Error {}

async function garmin<T>(params: Record<string, string>): Promise<T> {
  const res = await fetch(`/api/garmin?${new URLSearchParams(params)}`, {
    headers: { 'x-app-password': getPassword() ?? '' },
  })
  if (res.status === 401) {
    ls.set('lifelong:pw', null)
    window.dispatchEvent(new Event('lifelong:auth'))
    throw new AuthError('Wrong password.')
  }
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body as T
}

export async function signIn(password: string): Promise<void> {
  ls.set('lifelong:pw', password)
  try {
    await garmin({ part: 'check' })
  } catch (e) {
    ls.set('lifelong:pw', null)
    throw e
  }
  window.dispatchEvent(new Event('lifelong:auth'))
}

export function signOut() {
  ls.set('lifelong:pw', null)
  window.dispatchEvent(new Event('lifelong:auth'))
}

export async function forgetDeviceData() {
  dataset = emptyDataset()
  meta = { lastSync: null, finishedAt: null }
  await idbSet('dataset', dataset)
  await idbSet('meta', meta)
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
  try {
    const incremental = !full && meta.lastSync !== null
    report('profile', 'Reading your Garmin profile')
    const profile = await garmin<ProfilePrefs>({ part: 'profile' })

    report('activities', incremental ? `New activities since ${meta.lastSync}` : 'Downloading all activities')
    const activities = await garmin<Activity[]>({
      part: 'activities',
      today,
      ...(incremental ? { since: addDays(meta.lastSync!, -3) } : {}),
    })
    let next = mergeDataset(full ? emptyDataset() : dataset, { activities, profile })

    const first = next.activities[0]?.date ?? addDays(today, -5 * 365)
    const from = incremental ? addDays(meta.lastSync!, -7) : first
    const parts = chunks(from, today, 365)
    for (const [i, [a, b]] of parts.entries()) {
      report('health', `Health data ${a.slice(0, 4)}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ''}`)
      const w = await garmin<Pick<Dataset, 'daily' | 'sleep' | 'hrv' | 'weight'>>({ part: 'wellness', from: a, to: b })
      next = mergeDataset(next, w)
    }

    dataset = next
    meta = { lastSync: today, finishedAt: new Date().toISOString() }
    await idbSet('dataset', dataset).catch(() => {})
    await idbSet('meta', meta).catch(() => {})
    report('done', 'Up to date')
    changed()
  } catch (e) {
    status.error = e instanceof Error ? e.message : String(e)
    report('error', status.error)
  } finally {
    status.running = false
    status.finishedAt = new Date().toISOString()
    window.dispatchEvent(new Event('lifelong:sync'))
  }
}

/** Sync on open when the data is more than 3 hours old. */
export async function autoSync() {
  await loaded
  if (!getPassword()) return
  const age = meta.finishedAt ? Date.now() - Date.parse(meta.finishedAt) : Infinity
  if (age > 3 * 3600_000) void sync()
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

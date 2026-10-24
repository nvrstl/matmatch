import { useCallback, useEffect, useState } from 'react'
import type { Activity } from '../../shared/types'
import { cloudFetch, IS_CLOUD } from './cloud'

// Static snapshot mode (VITE_STATIC=1): answers come from data baked into snapshot.js, read-only.
export const IS_STATIC = Boolean(import.meta.env.VITE_STATIC)

interface Snapshot {
  label: string
  routes: Record<string, unknown>
  activities: Activity[]
}

function fromSnapshot<T>(path: string, init?: RequestInit): T {
  const snap = (window as unknown as { __SNAPSHOT__: Snapshot }).__SNAPSHOT__
  if (init?.method && init.method !== 'GET') throw new Error('This is a read-only snapshot. Run the app locally to change settings or sync.')
  const url = new URL(path, 'http://x')
  if (url.pathname === '/activities') {
    const sport = url.searchParams.get('sport') ?? ''
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    const page = Number(url.searchParams.get('page')) || 0
    const items = snap.activities.filter(
      (a) => (!sport || a.sport === sport) && (!q || a.name.toLowerCase().includes(q) || a.date.includes(q)),
    )
    return { total: items.length, items: items.slice(page * 50, page * 50 + 50) } as T
  }
  return snap.routes[url.pathname] as T
}

export const snapshotLabel = () =>
  IS_STATIC ? (window as unknown as { __SNAPSHOT__: Snapshot }).__SNAPSHOT__.label : null

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (IS_STATIC) return fromSnapshot<T>(path, init)
  if (IS_CLOUD) return cloudFetch<T>(path, init)
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body as T
}

/** Fetch JSON from the local API; `reload` re-fetches. */
export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    apiFetch<T>(path)
      .then((d) => alive && (setData(d), setError(null), setLoadedPath(path)))
      .catch((e: Error) => alive && (setError(e.message), setLoadedPath(path)))
    return () => {
      alive = false
    }
  }, [path, tick])
  // Hosted mode: re-read when a sync lands or progresses.
  useEffect(() => {
    if (!IS_CLOUD) return
    const bump = () => setTick((t) => t + 1)
    window.addEventListener('lifelong:data', bump)
    if (path === '/sync') window.addEventListener('lifelong:sync', bump)
    return () => {
      window.removeEventListener('lifelong:data', bump)
      window.removeEventListener('lifelong:sync', bump)
    }
  }, [path])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  /** true once the current path has answered (data may legitimately be null) */
  const loaded = loadedPath === path
  return { data, error, reload, loaded }
}

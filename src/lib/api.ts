import { useCallback, useEffect, useState } from 'react'
import type { Activity } from '../../shared/types'

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
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    apiFetch<T>(path)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [path, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, reload }
}

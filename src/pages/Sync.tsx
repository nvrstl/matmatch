import { useEffect, useState } from 'react'
import type { SyncStatus } from '../../shared/types'
import { Card, Loading, PageHeader, StatusPill, buttonCls } from '../components/ui'
import { apiFetch, useApi } from '../lib/api'

const LABELS: Record<string, string> = {
  activities: 'Activities',
  daily: 'Daily summaries',
  sleep: 'Nights of sleep',
  hrv: 'HRV readings',
  weight: 'Weigh-ins',
}

export default function Sync() {
  const { data, error, reload } = useApi<SyncStatus>('/sync')
  const [err, setErr] = useState<string | null>(null)

  // Poll while a sync is running.
  useEffect(() => {
    if (!data?.running) return
    const t = setInterval(reload, 1500)
    return () => clearInterval(t)
  }, [data?.running, reload])

  if (!data) return <Loading error={error} />
  const start = async (full: boolean) => {
    setErr(null)
    try {
      await apiFetch(`/sync${full ? '?full=1' : ''}`, { method: 'POST' })
      reload()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <>
      <PageHeader title="Sync">
        Data is pulled from the Garmin Connect Personal API and stored only on this machine (data/lifelong.db).
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Garmin connection"
          action={<StatusPill state={data.hasKey ? 'good' : 'bad'} label={data.hasKey ? 'API key configured' : 'No API key'} />}
        >
          {data.hasKey ? (
            <>
              <p className="text-sm text-ink-2">
                {data.running
                  ? `Syncing — ${data.phase}: ${data.message}`
                  : data.finishedAt
                    ? `Last sync ${new Date(data.finishedAt).toLocaleString()}.`
                    : 'Not synced yet. The first sync pulls your whole history and can take a while.'}
              </p>
              {data.error && !data.running && (
                <p className="mt-2 text-sm" style={{ color: 'var(--color-critical)' }}>
                  {data.error}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button className={buttonCls} disabled={data.running} onClick={() => start(false)}>
                  {data.running ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  className="rounded-lg border border-line px-3.5 py-2 text-sm text-ink-2 hover:text-ink disabled:opacity-50"
                  disabled={data.running}
                  onClick={() => start(true)}
                >
                  Re-download everything
                </button>
              </div>
              {err && <p className="mt-2 text-sm" style={{ color: 'var(--color-critical)' }}>{err}</p>}
            </>
          ) : (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-2">
              <li>
                In Garmin Connect on the web, open <strong>Account settings → Personal API Key</strong> and create a key. It’s
                shown only once.
              </li>
              <li>
                Put it in a file called <code className="rounded bg-[var(--wash)] px-1">.env</code> in the project folder:{' '}
                <code className="rounded bg-[var(--wash)] px-1">GARMIN_API_KEY=…</code>
              </li>
              <li>Restart the app and press “Sync now” (or run <code className="rounded bg-[var(--wash)] px-1">npm run sync</code>).</li>
            </ol>
          )}
        </Card>
        <Card title="Stored locally">
          <table className="tabular w-full text-sm">
            <tbody className="divide-y divide-line">
              {Object.entries(data.counts).map(([k, v]) => (
                <tr key={k}>
                  <td className="py-2 text-ink-2">{LABELS[k] ?? k}</td>
                  <td className="py-2 text-right font-medium">{v.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  )
}

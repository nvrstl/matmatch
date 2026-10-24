import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { autoSync, connect, getKey, IS_CLOUD } from '../lib/cloud'
import { buttonCls, inputCls } from './ui'

/** Hosted mode: each person connects their own Garmin key once per device, then it syncs itself. */
export function CloudGate({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(() => !IS_CLOUD || Boolean(getKey()))
  useEffect(() => {
    if (!IS_CLOUD) return
    const onAuth = () => setConnected(Boolean(getKey()))
    window.addEventListener('lifelong:auth', onAuth)
    return () => window.removeEventListener('lifelong:auth', onAuth)
  }, [])
  useEffect(() => {
    if (connected && IS_CLOUD) void autoSync()
  }, [connected])
  return connected ? <>{children}</> : <Connect />
}

function Connect() {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await connect(key)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="gutter flex min-h-screen items-center justify-center py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-9 w-9" />
          <div>
            <div className="text-lg font-semibold leading-tight">Lifelong</div>
            <div className="text-[13px] text-ink-2">Your running history, race predictions and next week’s plan</div>
          </div>
        </div>
        <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h1 className="text-[17px] font-semibold">Connect your Garmin</h1>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] text-ink-2">
            <li>
              Sign in to{' '}
              <a href="https://connect.garmin.com" target="_blank" rel="noreferrer" className="text-accent underline">
                Garmin Connect
              </a>{' '}
              on the web.
            </li>
            <li>
              Open <strong>Account settings → Personal API Key</strong> and create a key. Garmin shows it only once.
            </li>
            <li>Paste it here.</li>
          </ol>
          <label htmlFor="garmin-key" className="mt-4 block text-[13px] text-ink-2">
            Garmin Personal API key
          </label>
          <input
            id="garmin-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className={`${inputCls} mt-1 font-mono`}
            placeholder="GCDC_…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          {error && (
            <p className="mt-2 text-[13px]" style={{ color: 'var(--color-critical)' }}>
              {error}
            </p>
          )}
          <button className={`${buttonCls} mt-4 w-full`} disabled={busy || key.trim().length < 20}>
            {busy ? 'Checking with Garmin…' : 'Connect'}
          </button>
          <p className="mt-4 text-[12px] leading-relaxed text-muted">
            Your key and your data stay on this device. The server only passes requests on to Garmin and stores nothing.
            You can disconnect at any time on the Sync page.
          </p>
        </form>
      </div>
    </div>
  )
}

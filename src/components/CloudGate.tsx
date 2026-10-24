import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { autoSync, getPassword, IS_CLOUD, signIn } from '../lib/cloud'
import { buttonCls, inputCls } from './ui'

/** Hosted mode: ask for the app password once per device, then sync in the background. */
export function CloudGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(() => !IS_CLOUD || Boolean(getPassword()))
  useEffect(() => {
    if (!IS_CLOUD) return
    const onAuth = () => setAuthed(Boolean(getPassword()))
    window.addEventListener('lifelong:auth', onAuth)
    return () => window.removeEventListener('lifelong:auth', onAuth)
  }, [])
  useEffect(() => {
    if (authed && IS_CLOUD) void autoSync()
  }, [authed])
  return authed ? <>{children}</> : <SignIn />
}

function SignIn() {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(pw)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="gutter flex min-h-screen items-center justify-center py-10">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6">
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
          <div>
            <div className="text-[17px] font-semibold">Lifelong</div>
            <div className="text-[12px] text-muted">Your Garmin history</div>
          </div>
        </div>
        <label htmlFor="pw" className="mt-6 block text-[13px] text-ink-2">
          Password
        </label>
        <input
          id="pw"
          type="password"
          autoComplete="current-password"
          autoFocus
          className={`${inputCls} mt-1`}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        {error && (
          <p className="mt-2 text-[13px]" style={{ color: 'var(--color-critical)' }}>
            {error}
          </p>
        )}
        <button className={`${buttonCls} mt-4 w-full`} disabled={busy || !pw}>
          {busy ? 'Checking…' : 'Open my dashboard'}
        </button>
        <p className="mt-4 text-[12px] text-muted">Your data is downloaded from Garmin and kept on this device only.</p>
      </form>
    </div>
  )
}

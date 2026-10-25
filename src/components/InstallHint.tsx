import { useEffect, useState } from 'react'

interface InstallPrompt extends Event {
  prompt: () => Promise<void>
}

const DISMISSED = 'lifelong:install-dismissed'
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/**
 * Suggest adding the app to the home screen: it opens full-screen, and (on iPhone) the browser
 * then stops clearing its saved data after a week without a visit.
 */
export function InstallHint() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [hidden, setHidden] = useState(() => {
    try {
      return isStandalone() || localStorage.getItem(DISMISSED) === '1'
    } catch {
      return isStandalone()
    }
  })
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault() // show our own button instead of the browser's mini-bar
      setPrompt(e as InstallPrompt)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  if (hidden || (!mobile && !prompt)) return null

  const dismiss = () => {
    setHidden(true)
    try {
      localStorage.setItem(DISMISSED, '1')
    } catch {
      /* fine */
    }
  }
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" className="h-10 w-10 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Add Lifelong to your home screen</div>
          <p className="mt-0.5 text-[13px] text-ink-2">
            It opens like an app and your phone keeps your data and Garmin connection, so you never have to reconnect.
          </p>
          {prompt ? (
            <button
              className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white"
              onClick={async () => {
                await prompt.prompt().catch(() => {})
                dismiss()
              }}
            >
              Install app
            </button>
          ) : isIOS() ? (
            <p className="mt-2 text-[13px] text-ink-2">
              In Safari, tap <strong>Share</strong> <span aria-hidden>⎋</span> then <strong>Add to Home Screen</strong>. You’ll
              connect once more inside the app.
            </p>
          ) : (
            <p className="mt-2 text-[13px] text-ink-2">
              Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.
            </p>
          )}
        </div>
        <button onClick={dismiss} className="text-muted" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </section>
  )
}

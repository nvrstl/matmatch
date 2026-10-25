import type { ReactNode } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { snapshotLabel } from './lib/api'
import Activities from './pages/Activities'
import Pacing from './pages/Pacing'
import Plan from './pages/Plan'
import Progress from './pages/Progress'
import Races from './pages/Races'
import Sync from './pages/Sync'
import Today from './pages/Today'
import Workout from './pages/Workout'

// 24px line icons, drawn with currentColor so they follow the theme.
const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
)
const ICONS = {
  today: icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  plan: icon(<><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4M7.5 13h3M7.5 17h6" /></>),
  races: icon(<><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>),
  progress: icon(<><path d="M3 20h18" /><path d="M6 16l4-5 3 3 5-7" /></>),
  more: icon(<><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>),
}

const TABS = [
  { to: '/', label: 'Today', icon: ICONS.today, match: (p: string) => p === '/' },
  { to: '/plan', label: 'Plan', icon: ICONS.plan, match: (p: string) => p.startsWith('/plan') },
  { to: '/races', label: 'Races', icon: ICONS.races, match: (p: string) => p.startsWith('/races') },
  { to: '/progress', label: 'Progress', icon: ICONS.progress, match: (p: string) => p.startsWith('/progress') },
  { to: '/more', label: 'More', icon: ICONS.more, match: (p: string) => ['/more', '/activities', '/activity', '/sync'].some((x) => p.startsWith(x)) },
]

const SIDEBAR = [
  { to: '/', label: 'Today' },
  { to: '/plan', label: 'Training plan' },
  { to: '/races', label: 'Race predictions' },
  { to: '/races/pacing', label: 'Race-day pacing' },
  { to: '/progress', label: 'Lifelong progress' },
  { to: '/activities', label: 'Activities' },
  { to: '/sync', label: 'Sync' },
]

export default function App() {
  const { pathname } = useLocation()
  return (
    <div className="min-h-screen md:flex">
      {/* Desktop: sidebar */}
      <aside className="hidden border-r border-line bg-surface md:sticky md:top-0 md:block md:h-screen md:w-56 md:shrink-0">
        <Brand />
        <nav className="flex flex-col gap-1 px-3">
          {SIDEBAR.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm transition ${isActive ? 'bg-[var(--wash)] font-medium text-ink' : 'text-ink-2 hover:text-ink'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="gutter safe-top mx-auto w-full max-w-6xl pb-28 md:pb-8">
        {snapshotLabel() && (
          <div className="mb-5 rounded-xl border border-line bg-[var(--wash)] px-4 py-3 text-[13px] text-ink-2">{snapshotLabel()}</div>
        )}
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/races" element={<Races />} />
          <Route path="/races/pacing" element={<Pacing />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/activities" element={<Activities />} />
          <Route path="/activity/:id" element={<Workout />} />
          <Route path="/sync" element={<Sync />} />
          <Route path="/more" element={<More />} />
        </Routes>
      </main>

      {/* Phone: bottom tab bar, clear of the home indicator */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur md:hidden"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        }}
        aria-label="Main"
      >
        <ul className="grid grid-cols-5">
          {TABS.map((t) => {
            const active = t.match(pathname)
            return (
              <li key={t.to}>
                <Link
                  to={t.to}
                  aria-current={active ? 'page' : undefined}
                  className={`flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] ${active ? 'font-semibold text-accent' : 'text-ink-2'}`}
                >
                  {t.icon}
                  {t.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-5 py-5">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7" />
      <div>
        <div className="text-[15px] font-semibold leading-tight">Lifelong</div>
        <div className="text-[11px] text-muted">Your Garmin history</div>
      </div>
    </div>
  )
}

/** Phone-only menu for the screens that don't get a tab. */
function More() {
  const items = [
    { to: '/activities', label: 'Activities', sub: 'Every run and workout, with splits and zones' },
    { to: '/races/pacing', label: 'Race-day pacing', sub: 'Splits and checkpoints for a target time' },
    { to: '/sync', label: 'Sync', sub: 'Garmin connection and data on this device' },
  ]
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">More</h1>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {items.map((i) => (
          <li key={i.to}>
            <Link to={i.to} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <span>
                <span className="block text-[15px] font-medium">{i.label}</span>
                <span className="block text-[12px] text-muted">{i.sub}</span>
              </span>
              <span className="text-muted" aria-hidden>›</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

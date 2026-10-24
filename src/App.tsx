import { NavLink, Route, Routes } from 'react-router-dom'
import Activities from './pages/Activities'
import Overview from './pages/Overview'
import Plan from './pages/Plan'
import Progress from './pages/Progress'
import Races from './pages/Races'
import Sync from './pages/Sync'
import { snapshotLabel } from './lib/api'

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/progress', label: 'Lifelong progress' },
  { to: '/races', label: 'Race predictions' },
  { to: '/plan', label: 'Next week' },
  { to: '/activities', label: 'Activities' },
  { to: '/sync', label: 'Sync' },
]

export default function App() {
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-3 md:px-5 md:py-5">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7" />
          <div>
            <div className="text-[15px] font-semibold leading-tight">Lifelong</div>
            <div className="text-[11px] text-muted">Your Garmin history</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${isActive ? 'bg-[var(--wash)] font-medium text-ink' : 'text-ink-2 hover:text-ink'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="gutter mx-auto w-full max-w-6xl py-6 md:py-8">
        {snapshotLabel() && (
          <div className="mb-5 rounded-xl border border-line bg-[var(--wash)] px-4 py-3 text-[13px] text-ink-2">
            {snapshotLabel()}
          </div>
        )}
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/races" element={<Races />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/activities" element={<Activities />} />
          <Route path="/sync" element={<Sync />} />
        </Routes>
      </main>
    </div>
  )
}

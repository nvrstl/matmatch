import { NavLink } from 'react-router-dom'

/** Switch between the two race views. */
export function RacesTabs() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 transition ${isActive ? 'bg-[var(--wash)] font-medium text-ink' : 'text-ink-2 hover:text-ink'}`
  return (
    <nav className="mb-4 inline-flex rounded-lg border border-line bg-surface p-0.5 text-[13px]" aria-label="Races">
      <NavLink to="/races" end className={cls}>
        Predictions
      </NavLink>
      <NavLink to="/races/pacing" className={cls}>
        Pacing card
      </NavLink>
    </nav>
  )
}

import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function navClass({ isActive }: { isActive: boolean }) {
  return `rounded-lg px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors sm:px-3 ${
    isActive ? 'bg-sand-100 text-ink-900' : 'text-ink-700 hover:bg-sand-100'
  }`
}

export default function Navbar() {
  const { session, profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <header className="sticky top-0 z-20 border-b border-sand-200 bg-sand-50/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:px-4">
        <Link to="/" className="flex shrink-0 items-center gap-1.5">
          <span className="text-xl">🧘</span>
          <span className="font-display text-xl font-medium tracking-tight text-clay-500 sm:text-2xl">
            Matmatch
          </span>
        </Link>

        <nav className="flex items-center gap-0.5 sm:gap-1">
          {session && profile ? (
            <>
              {profile.role === 'school' && (
                <NavLink to="/teachers" className={navClass}>
                  Zoek leraren
                </NavLink>
              )}
              {profile.role === 'teacher' && (
                <NavLink to="/profile" className={navClass}>
                  Mijn profiel
                </NavLink>
              )}
              <NavLink to="/bookings" className={navClass}>
                Boekingen
              </NavLink>
              <button
                onClick={handleSignOut}
                className="btn-ghost ml-0.5 px-2.5 sm:px-5"
                aria-label="Uitloggen"
              >
                <span className="material-symbols-outlined text-[20px] sm:hidden">logout</span>
                <span className="hidden sm:inline">Uitloggen</span>
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login" className={navClass}>
                Inloggen
              </NavLink>
              <Link to="/signup" className="btn-primary ml-1">
                Aanmelden
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

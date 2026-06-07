import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { Role } from '../lib/types'

export default function Signup() {
  const [params] = useSearchParams()
  const initialRole = (params.get('role') === 'school' ? 'school' : 'teacher') as Role

  const [role, setRole] = useState<Role>(initialRole)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { signUp } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (fullName.trim().length < 2) return setError('Vul je naam in.')
    if (password.length < 6) return setError('Wachtwoord moet minstens 6 tekens zijn.')

    setBusy(true)
    const { error } = await signUp({ email, password, role, fullName: fullName.trim() })
    setBusy(false)

    if (error) return setError(error)
    navigate(role === 'teacher' ? '/profile' : '/teachers', { replace: true })
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="card p-8">
        <h1 className="text-2xl font-bold text-ink-900">Account aanmaken</h1>
        <p className="mt-1 text-sm text-ink-700/70">
          Kies hoe je Matmatch wil gebruiken.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          {(['teacher', 'school'] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                role === r
                  ? 'border-clay-500 bg-clay-500/5'
                  : 'border-sand-200 hover:bg-sand-100'
              }`}
            >
              <span className="text-xl">{r === 'teacher' ? '🧘' : '🏫'}</span>
              <p className="mt-1 text-sm font-semibold text-ink-900">
                {r === 'teacher' ? 'Yogaleraar' : 'Yogaschool'}
              </p>
              <p className="text-xs text-ink-700/60">
                {r === 'teacher' ? 'Ik geef lessen' : 'Ik boek leraren'}
              </p>
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="label">
              {role === 'teacher' ? 'Volledige naam' : 'Naam van de school'}
            </label>
            <input
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={role === 'teacher' ? 'Lien Peeters' : 'Studio Anand'}
              autoComplete="name"
            />
          </div>
          <div>
            <label className="label">E-mail</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jij@voorbeeld.be"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label className="label">Wachtwoord</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minstens 6 tekens"
              autoComplete="new-password"
              required
            />
          </div>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Bezig…' : 'Account aanmaken'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-700/70">
          Al een account?{' '}
          <Link to="/login" className="font-semibold text-clay-500 hover:underline">
            Inloggen
          </Link>
        </p>
      </div>
    </div>
  )
}

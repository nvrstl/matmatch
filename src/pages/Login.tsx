import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { signIn } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await signIn(email, password)
    setBusy(false)
    if (error) return setError(error)
    navigate('/bookings', { replace: true })
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="card p-8">
        <h1 className="text-2xl font-bold text-ink-900">Inloggen</h1>
        <p className="mt-1 text-sm text-ink-700/70">Welkom terug bij Matmatch.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="label">E-mail</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Bezig…' : 'Inloggen'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-700/70">
          Nog geen account?{' '}
          <Link to="/signup" className="font-semibold text-clay-500 hover:underline">
            Aanmelden
          </Link>
        </p>
      </div>
    </div>
  )
}

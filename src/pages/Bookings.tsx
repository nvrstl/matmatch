import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Booking, BookingStatus } from '../lib/types'
import { EmptyState, Spinner, StatusBadge } from '../components/ui'
import { formatDate, formatRate, shortTime } from '../lib/format'

type Row = Booking & {
  school: { id: string; name: string; city: string } | null
  teacher: { id: string; city: string; profile: { full_name: string } | null } | null
}

const FILTERS: { key: 'upcoming' | 'pending' | 'all'; label: string }[] = [
  { key: 'pending', label: 'In afwachting' },
  { key: 'upcoming', label: 'Bevestigd' },
  { key: 'all', label: 'Alles' },
]

export default function Bookings() {
  const { session, profile } = useAuth()
  const isTeacher = profile?.role === 'teacher'

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'upcoming' | 'pending' | 'all'>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session) return
    const column = isTeacher ? 'teacher_id' : 'school_id'
    const { data } = await supabase
      .from('bookings')
      .select(
        '*, school:school_profiles(id, name, city), teacher:teacher_profiles(id, city, profile:profiles(full_name))',
      )
      .eq(column, session.user.id)
      .order('date', { ascending: true })
    setRows((data as Row[] | null) ?? [])
    setLoading(false)
  }, [session, isTeacher])

  useEffect(() => {
    load()
  }, [load])

  async function setStatus(id: string, status: BookingStatus) {
    setBusyId(id)
    const { error } = await supabase.from('bookings').update({ status }).eq('id', id)
    setBusyId(null)
    if (!error) {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)))
    }
  }

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter === 'pending') return r.status === 'pending'
      if (filter === 'upcoming') return r.status === 'accepted'
      return true
    })
  }, [rows, filter])

  const pendingCount = rows.filter((r) => r.status === 'pending').length

  if (loading) return <Spinner label="Boekingen laden…" />

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Boekingen</h1>
        <p className="text-sm text-ink-700/70">
          {isTeacher
            ? 'Aanvragen van scholen. Accepteer of weiger.'
            : 'Je aanvragen aan leraren en hun status.'}
        </p>
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              filter === f.key
                ? 'bg-ink-900 text-white'
                : 'bg-white text-ink-700 hover:bg-sand-100'
            }`}
          >
            {f.label}
            {f.key === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-clay-500 px-1.5 text-xs text-white">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={isTeacher ? 'Nog geen aanvragen' : 'Nog geen boekingen'}
        >
          {isTeacher ? (
            <>
              Zorg dat je profiel online staat zodat scholen je vinden.{' '}
              <Link to="/profile" className="font-semibold text-clay-500 hover:underline">
                Naar mijn profiel
              </Link>
            </>
          ) : (
            <>
              Zoek een leraar en stuur je eerste aanvraag.{' '}
              <Link to="/teachers" className="font-semibold text-clay-500 hover:underline">
                Zoek leraren
              </Link>
            </>
          )}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {filtered.map((b) => {
            const counterpart = isTeacher
              ? b.school?.name ?? 'Yogaschool'
              : b.teacher?.profile?.full_name ?? 'Yogaleraar'
            const counterCity = isTeacher ? b.school?.city : b.teacher?.city
            return (
              <li key={b.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink-900">{b.style}</span>
                      <StatusBadge status={b.status} />
                    </div>
                    <p className="text-sm text-ink-700/80">
                      {formatDate(b.date)} · {shortTime(b.start_time)}–{shortTime(b.end_time)}
                    </p>
                    <p className="text-sm text-ink-700/70">
                      {isTeacher ? 'Van' : 'Met'} <span className="font-medium">{counterpart}</span>
                      {counterCity && ` · ${counterCity}`}
                    </p>
                    {b.location && (
                      <p className="text-sm text-ink-700/60">📍 {b.location}</p>
                    )}
                    {b.message && (
                      <p className="mt-1 rounded-lg bg-sand-50 px-3 py-2 text-sm text-ink-700/80">
                        “{b.message}”
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-ink-900">
                      {formatRate(b.proposed_rate)}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                {b.status === 'pending' && (
                  <div className="mt-4 flex justify-end gap-2 border-t border-sand-200 pt-4">
                    {isTeacher ? (
                      <>
                        <button
                          onClick={() => setStatus(b.id, 'declined')}
                          disabled={busyId === b.id}
                          className="btn-secondary"
                        >
                          Weigeren
                        </button>
                        <button
                          onClick={() => setStatus(b.id, 'accepted')}
                          disabled={busyId === b.id}
                          className="btn-primary"
                        >
                          Accepteren
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setStatus(b.id, 'cancelled')}
                        disabled={busyId === b.id}
                        className="btn-ghost text-rose-600"
                      >
                        Aanvraag intrekken
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

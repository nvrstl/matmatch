import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { CITIES, YOGA_STYLES } from '../lib/constants'
import type { TeacherCard, TeacherProfile } from '../lib/types'
import { Avatar, EmptyState, Spinner } from '../components/ui'
import { formatRate } from '../lib/format'

type Row = TeacherProfile & { profile: { full_name: string } | null }

export default function BrowseTeachers() {
  const [teachers, setTeachers] = useState<TeacherCard[]>([])
  const [loading, setLoading] = useState(true)
  const [city, setCity] = useState('')
  const [style, setStyle] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('teacher_profiles')
        .select('*, profile:profiles(full_name)')
        .eq('is_published', true)
        .order('updated_at', { ascending: false })

      const rows = (data as Row[] | null) ?? []
      setTeachers(
        rows.map((r) => {
          const { profile, ...tp } = r
          return { ...tp, full_name: profile?.full_name ?? 'Yogaleraar' }
        }),
      )
      setLoading(false)
    })()
  }, [])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return teachers.filter((t) => {
      if (city && t.city !== city) return false
      if (style && !t.styles.includes(style)) return false
      if (needle) {
        const hay = `${t.full_name} ${t.headline} ${t.bio} ${t.styles.join(' ')}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [teachers, city, style, q])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Zoek een yogaleraar</h1>
        <p className="text-sm text-ink-700/70">
          Filter op stad en stijl, en stuur een boekingsaanvraag.
        </p>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="min-w-48 flex-1">
          <span className="label">Zoeken</span>
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Naam, stijl of trefwoord"
          />
        </label>
        <label>
          <span className="label">Stad</span>
          <select className="input" value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">Alle steden</option>
            {CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Stijl</span>
          <select className="input" value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="">Alle stijlen</option>
            {YOGA_STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <Spinner label="Leraren laden…" />
      ) : filtered.length === 0 ? (
        <EmptyState title="Geen leraren gevonden">
          Pas je filters aan. Nieuwe leraren komen er regelmatig bij.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <Link
              key={t.id}
              to={`/teachers/${t.id}`}
              className="card flex flex-col gap-3 p-5 transition-shadow hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <Avatar name={t.full_name} url={t.photo_url} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-900">{t.full_name}</p>
                  <p className="truncate text-sm text-ink-700/70">
                    {t.city || 'België'}
                    {t.experience_years > 0 && ` · ${t.experience_years} jr ervaring`}
                  </p>
                </div>
              </div>

              {t.headline && (
                <p className="line-clamp-2 text-sm text-ink-700/80">{t.headline}</p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {t.styles.slice(0, 3).map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
                {t.styles.length > 3 && (
                  <span className="chip">+{t.styles.length - 3}</span>
                )}
              </div>

              <div className="mt-auto flex items-center justify-between border-t border-sand-200 pt-3">
                <span className="text-sm font-semibold text-ink-900">
                  {formatRate(t.hourly_rate)}
                  <span className="font-normal text-ink-700/60"> / les</span>
                </span>
                <span className="text-sm font-semibold text-clay-500">Bekijk →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

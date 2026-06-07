import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { WEEKDAYS, YOGA_STYLES } from '../lib/constants'
import type { AvailabilitySlot, TeacherCard, TeacherProfile } from '../lib/types'
import { Avatar, Spinner } from '../components/ui'
import { formatRate, shortTime, todayISO } from '../lib/format'
import BookingModal from '../components/BookingModal'

type Row = TeacherProfile & { profile: { full_name: string } | null }

export default function TeacherDetail() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [teacher, setTeacher] = useState<TeacherCard | null>(null)
  const [slots, setSlots] = useState<AvailabilitySlot[]>([])
  const [loading, setLoading] = useState(true)
  const [showBooking, setShowBooking] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const [{ data: t }, { data: av }] = await Promise.all([
      supabase
        .from('teacher_profiles')
        .select('*, profile:profiles(full_name)')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('availability_slots').select('*').eq('teacher_id', id),
    ])
    if (t) {
      const { profile: p, ...tp } = t as Row
      setTeacher({ ...tp, full_name: p?.full_name ?? 'Yogaleraar' })
    }
    if (av) {
      setSlots(
        [...(av as AvailabilitySlot[])].sort(
          (a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
        ),
      )
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <Spinner label="Profiel laden…" />
  if (!teacher)
    return (
      <div className="card p-8 text-center">
        <p className="text-ink-700">Deze leraar bestaat niet (meer).</p>
        <Link to="/teachers" className="btn-secondary mt-4">
          Terug naar overzicht
        </Link>
      </div>
    )

  const canBook = profile?.role === 'school'

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/teachers" className="text-sm font-medium text-clay-500 hover:underline">
        ← Alle leraren
      </Link>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start">
          <Avatar name={teacher.full_name} url={teacher.photo_url} size={96} />
          <div className="flex-1 space-y-2">
            <h1 className="text-2xl font-bold text-ink-900">{teacher.full_name}</h1>
            {teacher.headline && (
              <p className="text-ink-700/80">{teacher.headline}</p>
            )}
            <p className="text-sm text-ink-700/70">
              {teacher.city || 'België'}
              {teacher.experience_years > 0 &&
                ` · ${teacher.experience_years} jaar ervaring`}
              {teacher.travel_radius_km > 0 &&
                ` · reist tot ${teacher.travel_radius_km} km`}
            </p>
            <p className="text-lg font-semibold text-ink-900">
              {formatRate(teacher.hourly_rate)}
              <span className="text-sm font-normal text-ink-700/60"> / les</span>
            </p>
          </div>
        </div>

        <div className="space-y-5 border-t border-sand-200 p-6">
          {teacher.bio && (
            <section>
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-700/60">
                Over
              </h2>
              <p className="whitespace-pre-line text-ink-700/90">{teacher.bio}</p>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-700/60">
              Stijlen
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {teacher.styles.map((s) => (
                <span key={s} className="chip">
                  {s}
                </span>
              ))}
            </div>
          </section>

          {teacher.languages.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-700/60">
                Talen
              </h2>
              <p className="text-ink-700/90">{teacher.languages.join(' · ')}</p>
            </section>
          )}

          {teacher.certifications && (
            <section>
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-700/60">
                Opleiding
              </h2>
              <p className="text-ink-700/90">{teacher.certifications}</p>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-700/60">
              Beschikbaarheid
            </h2>
            {slots.length === 0 ? (
              <p className="text-sm text-ink-700/60">Nog niet ingevuld.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {slots.map((s) => (
                  <span
                    key={s.id}
                    className="rounded-lg border border-sand-200 bg-sand-50 px-3 py-1.5 text-sm text-ink-700"
                  >
                    {WEEKDAYS[s.weekday]} {shortTime(s.start_time)}–{shortTime(s.end_time)}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-sand-200 bg-sand-50 p-6">
          {canBook ? (
            <button onClick={() => setShowBooking(true)} className="btn-primary w-full sm:w-auto">
              Boekingsaanvraag sturen
            </button>
          ) : profile ? (
            <p className="text-sm text-ink-700/70">
              Alleen scholen kunnen boeken. Je bent ingelogd als leraar.
            </p>
          ) : (
            <button
              onClick={() => navigate('/signup?role=school')}
              className="btn-primary"
            >
              Aanmelden als school om te boeken
            </button>
          )}
        </div>
      </div>

      {showBooking && (
        <BookingModal
          teacherId={teacher.id}
          teacherName={teacher.full_name}
          defaultStyle={teacher.styles[0] ?? YOGA_STYLES[0]}
          defaultRate={teacher.hourly_rate}
          minDate={todayISO()}
          onClose={() => setShowBooking(false)}
          onBooked={() => navigate('/bookings')}
        />
      )}
    </div>
  )
}

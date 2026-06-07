import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { WEEKDAYS, YOGA_STYLES } from '../lib/constants'
import type { AvailabilitySlot, TeacherCard, TeacherProfile } from '../lib/types'
import { Avatar, Spinner } from '../components/ui'
import { formatRate, shortTime, todayISO } from '../lib/format'
import BookingModal from '../components/BookingModal'

type Row = TeacherProfile & { profile: { full_name: string } | null }

function Icon({ name, className = '', filled = false }: { name: string; className?: string; filled?: boolean }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
    >
      {name}
    </span>
  )
}

function BentoCard({
  icon,
  title,
  className = '',
  children,
}: {
  icon: string
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`rounded-2xl border border-sand-200 bg-white p-6 ${className}`}>
      <div className="mb-5 flex items-center gap-2">
        <Icon name={icon} className="text-clay-500" />
        <h3 className="text-xl text-ink-900">{title}</h3>
      </div>
      {children}
    </div>
  )
}

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
  const meta = [
    teacher.city || 'België',
    teacher.experience_years > 0 ? `${teacher.experience_years} jaar ervaring` : null,
    teacher.travel_radius_km > 0 ? `reist tot ${teacher.travel_radius_km} km` : null,
  ].filter(Boolean)

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <Link to="/teachers" className="text-sm font-semibold text-clay-500 hover:underline">
        ← Alle leraren
      </Link>

      {/* Header */}
      <section className="flex flex-col items-start gap-8 md:flex-row md:items-center">
        <div className="relative shrink-0">
          <div className="overflow-hidden rounded-full border-4 border-sand-100 shadow-sm">
            <Avatar name={teacher.full_name} url={teacher.photo_url} size={176} />
          </div>
          {teacher.is_published && (
            <div className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-clay-500 text-white shadow-lg">
              <Icon name="verified" filled className="text-[20px]" />
            </div>
          )}
        </div>

        <div className="flex-1">
          <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-end md:gap-4">
            <h1 className="text-3xl text-ink-900 md:text-5xl">{teacher.full_name}</h1>
            {teacher.headline && (
              <span className="mb-1 italic text-ink-700">{teacher.headline}</span>
            )}
          </div>
          <p className="mb-5 text-ink-700">{meta.join(' · ')}</p>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-2xl font-semibold text-ink-900">
              {formatRate(teacher.hourly_rate)}
              <span className="text-base font-normal text-ink-700/60"> / les</span>
            </span>
            {canBook ? (
              <button onClick={() => setShowBooking(true)} className="btn-primary px-7 py-3">
                Boekingsaanvraag sturen
                <Icon name="send" className="text-[18px]" />
              </button>
            ) : !profile ? (
              <button
                onClick={() => navigate('/signup?role=school')}
                className="btn-primary px-7 py-3"
              >
                Aanmelden als school om te boeken
              </button>
            ) : (
              <span className="text-sm text-ink-700/70">
                Alleen scholen kunnen boeken.
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Bento grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        {/* Styles */}
        <BentoCard icon="psychology" title="Stijlen" className="md:col-span-5">
          <div className="flex flex-wrap gap-2">
            {teacher.styles.length === 0 ? (
              <p className="text-sm text-ink-700/60">Nog niet ingevuld.</p>
            ) : (
              teacher.styles.map((s) => (
                <span key={s} className="chip px-4 py-1.5">
                  {s}
                </span>
              ))
            )}
          </div>
          {teacher.languages.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2">
                <Icon name="translate" className="text-[18px] text-clay-500" />
                <span className="text-sm font-semibold text-ink-700">Talen</span>
              </div>
              <p className="text-ink-900">{teacher.languages.join(' · ')}</p>
            </div>
          )}
        </BentoCard>

        {/* About */}
        <BentoCard icon="self_improvement" title="Over mij" className="md:col-span-7">
          {teacher.bio ? (
            <p className="whitespace-pre-line leading-relaxed text-ink-700">{teacher.bio}</p>
          ) : (
            <p className="text-sm text-ink-700/60">Deze leraar heeft nog geen bio toegevoegd.</p>
          )}
        </BentoCard>

        {/* Certifications */}
        <BentoCard icon="workspace_premium" title="Opleiding & certificaten" className="md:col-span-7">
          {teacher.certifications ? (
            <div className="rounded-xl bg-sand-100 p-4 text-ink-900">{teacher.certifications}</div>
          ) : (
            <p className="text-sm text-ink-700/60">Nog niet ingevuld.</p>
          )}
        </BentoCard>

        {/* Availability — sage card */}
        <div className="rounded-2xl bg-clay-500 p-6 text-white md:col-span-5">
          <div className="mb-5 flex items-center gap-2">
            <Icon name="calendar_month" className="text-white" />
            <h3 className="text-xl text-white">Beschikbaarheid</h3>
          </div>
          {slots.length === 0 ? (
            <p className="text-sm text-white/70">Nog niet ingevuld.</p>
          ) : (
            <div className="space-y-2.5">
              {slots.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between border-b border-white/20 pb-2 last:border-0"
                >
                  <span className="font-semibold">{WEEKDAYS[s.weekday]}</span>
                  <span className="text-white/90">
                    {shortTime(s.start_time)} – {shortTime(s.end_time)}
                  </span>
                </div>
              ))}
            </div>
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

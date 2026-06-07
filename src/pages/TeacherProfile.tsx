import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { CITIES, LANGUAGES, WEEKDAYS, YOGA_STYLES } from '../lib/constants'
import type { AvailabilitySlot, TeacherProfile as TP } from '../lib/types'
import { ChipSelect, Field, Spinner } from '../components/ui'
import AvatarUpload from '../components/AvatarUpload'
import { shortTime } from '../lib/format'

const EMPTY: Omit<TP, 'id' | 'created_at' | 'updated_at'> = {
  headline: '',
  bio: '',
  city: '',
  styles: [],
  languages: [],
  certifications: '',
  experience_years: 0,
  hourly_rate: null,
  travel_radius_km: 25,
  photo_url: null,
  is_published: false,
}

export default function TeacherProfile() {
  const { session, profile } = useAuth()
  const userId = session!.user.id

  const [form, setForm] = useState(EMPTY)
  const [slots, setSlots] = useState<AvailabilitySlot[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // New-slot inputs
  const [newWeekday, setNewWeekday] = useState(1)
  const [newStart, setNewStart] = useState('18:00')
  const [newEnd, setNewEnd] = useState('19:30')

  const load = useCallback(async () => {
    const [{ data: tp }, { data: av }] = await Promise.all([
      supabase.from('teacher_profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('availability_slots').select('*').eq('teacher_id', userId),
    ])
    if (tp) {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = tp as TP
      setForm({ ...EMPTY, ...rest })
    }
    if (av) {
      setSlots(
        [...(av as AvailabilitySlot[])].sort(
          (a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
        ),
      )
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function toggle(list: 'styles' | 'languages', value: string) {
    setForm((f) => {
      const cur = f[list]
      return {
        ...f,
        [list]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
      }
    })
  }

  function showToast(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2500)
  }

  async function save(publishOverride?: boolean) {
    setSaving(true)
    const payload = {
      ...form,
      is_published: publishOverride ?? form.is_published,
      hourly_rate: form.hourly_rate === null ? null : Number(form.hourly_rate),
      experience_years: Number(form.experience_years) || 0,
      travel_radius_km: Number(form.travel_radius_km) || 0,
    }
    const { error } = await supabase
      .from('teacher_profiles')
      .update(payload)
      .eq('id', userId)
    setSaving(false)
    if (error) return showToast(`Fout: ${error.message}`)
    if (publishOverride !== undefined) set('is_published', publishOverride)
    showToast(
      publishOverride === true
        ? 'Profiel is nu zichtbaar voor scholen ✓'
        : publishOverride === false
          ? 'Profiel offline gezet'
          : 'Opgeslagen ✓',
    )
  }

  async function addSlot() {
    if (newEnd <= newStart) return showToast('Einduur moet na startuur liggen.')
    const { data, error } = await supabase
      .from('availability_slots')
      .insert({
        teacher_id: userId,
        weekday: newWeekday,
        start_time: newStart,
        end_time: newEnd,
      })
      .select()
      .single()
    if (error) return showToast(`Fout: ${error.message}`)
    setSlots((s) =>
      [...s, data as AvailabilitySlot].sort(
        (a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
      ),
    )
  }

  async function removeSlot(id: string) {
    await supabase.from('availability_slots').delete().eq('id', id)
    setSlots((s) => s.filter((x) => x.id !== id))
  }

  if (loading) return <Spinner label="Profiel laden…" />

  const incomplete = !form.headline || !form.city || form.styles.length === 0

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Mijn profiel</h1>
          <p className="text-sm text-ink-700/70">
            Dit zien scholen wanneer ze een leraar zoeken.
          </p>
        </div>
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            form.is_published
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-sand-200 text-ink-700'
          }`}
        >
          {form.is_published ? 'Online' : 'Offline'}
        </span>
      </div>

      {/* Profile photo */}
      <section className="card p-6">
        <AvatarUpload
          userId={userId}
          name={profile?.full_name ?? ''}
          photoUrl={form.photo_url}
          onChange={(url) => set('photo_url', url)}
        />
      </section>

      {/* Basics */}
      <section className="card space-y-4 p-6">
        <Field label="Titel / pitch" hint="Bv. 'Vinyasa & Yin · 8 jaar ervaring'">
          <input
            className="input"
            value={form.headline}
            onChange={(e) => set('headline', e.target.value)}
            placeholder="Vinyasa & Yin leraar uit Gent"
          />
        </Field>

        <Field label="Over jou">
          <textarea
            className="input min-h-28"
            value={form.bio}
            onChange={(e) => set('bio', e.target.value)}
            placeholder="Vertel scholen over je aanpak, opleiding en wat je lessen bijzonder maakt."
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Stad / regio">
            <select
              className="input"
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
            >
              <option value="">Kies een stad…</option>
              {CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reisbereik (km)">
            <input
              type="number"
              min={0}
              className="input"
              value={form.travel_radius_km}
              onChange={(e) => set('travel_radius_km', Number(e.target.value))}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ervaring (jaren)">
            <input
              type="number"
              min={0}
              className="input"
              value={form.experience_years}
              onChange={(e) => set('experience_years', Number(e.target.value))}
            />
          </Field>
          <Field label="Tarief per les (€)" hint="Indicatief — scholen zien dit.">
            <input
              type="number"
              min={0}
              className="input"
              value={form.hourly_rate ?? ''}
              onChange={(e) =>
                set('hourly_rate', e.target.value === '' ? null : Number(e.target.value))
              }
              placeholder="bv. 50"
            />
          </Field>
        </div>
      </section>

      {/* Styles & languages */}
      <section className="card space-y-5 p-6">
        <div>
          <p className="label">Yogastijlen</p>
          <ChipSelect
            options={YOGA_STYLES}
            selected={form.styles}
            onToggle={(v) => toggle('styles', v)}
          />
        </div>
        <div>
          <p className="label">Talen</p>
          <ChipSelect
            options={LANGUAGES}
            selected={form.languages}
            onToggle={(v) => toggle('languages', v)}
          />
        </div>
        <Field label="Certificaten / opleiding">
          <input
            className="input"
            value={form.certifications ?? ''}
            onChange={(e) => set('certifications', e.target.value)}
            placeholder="Bv. RYT-200, Yin teacher training"
          />
        </Field>
      </section>

      {/* Availability */}
      <section className="card space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Wekelijkse beschikbaarheid</h2>
          <p className="text-sm text-ink-700/70">
            Geef aan wanneer je doorgaans lesgeeft. Scholen zien dit op je profiel.
          </p>
        </div>

        {slots.length > 0 && (
          <ul className="space-y-2">
            {slots.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-xl border border-sand-200 px-4 py-2.5"
              >
                <span className="text-sm font-medium text-ink-900">
                  {WEEKDAYS[s.weekday]} · {shortTime(s.start_time)}–{shortTime(s.end_time)}
                </span>
                <button
                  onClick={() => removeSlot(s.id)}
                  className="text-sm font-medium text-rose-600 hover:underline"
                >
                  Verwijderen
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-3 rounded-xl bg-sand-50 p-3">
          <label className="flex-1">
            <span className="label">Dag</span>
            <select
              className="input"
              value={newWeekday}
              onChange={(e) => setNewWeekday(Number(e.target.value))}
            >
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Van</span>
            <input
              type="time"
              className="input"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
            />
          </label>
          <label>
            <span className="label">Tot</span>
            <input
              type="time"
              className="input"
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
            />
          </label>
          <button onClick={addSlot} className="btn-secondary">
            + Toevoegen
          </button>
        </div>
      </section>

      {/* Save bar */}
      <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-2xl border border-sand-200 bg-white/90 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-ink-700/70">
          {incomplete ? (
            <span className="text-amber-700">
              Vul titel, stad en minstens één stijl in om te publiceren.
            </span>
          ) : (
            'Klaar om te delen met scholen.'
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => save()} className="btn-secondary" disabled={saving}>
            {saving ? 'Bezig…' : 'Opslaan'}
          </button>
          {form.is_published ? (
            <button
              onClick={() => save(false)}
              className="btn-ghost"
              disabled={saving}
            >
              Offline zetten
            </button>
          ) : (
            <button
              onClick={() => save(true)}
              className="btn-primary"
              disabled={saving || incomplete}
            >
              Publiceren
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

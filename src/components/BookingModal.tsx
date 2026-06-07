import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { YOGA_STYLES } from '../lib/constants'

export default function BookingModal({
  teacherId,
  teacherName,
  defaultStyle,
  defaultRate,
  minDate,
  onClose,
  onBooked,
}: {
  teacherId: string
  teacherName: string
  defaultStyle: string
  defaultRate: number | null
  minDate: string
  onClose: () => void
  onBooked: () => void
}) {
  const { session } = useAuth()
  const schoolId = session!.user.id

  const [date, setDate] = useState('')
  const [start, setStart] = useState('18:00')
  const [end, setEnd] = useState('19:30')
  const [style, setStyle] = useState(defaultStyle)
  const [location, setLocation] = useState('')
  const [message, setMessage] = useState('')
  const [rate, setRate] = useState<string>(defaultRate != null ? String(defaultRate) : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!date) return setError('Kies een datum.')
    if (end <= start) return setError('Einduur moet na startuur liggen.')

    setBusy(true)
    const { error } = await supabase.from('bookings').insert({
      school_id: schoolId,
      teacher_id: teacherId,
      date,
      start_time: start,
      end_time: end,
      style,
      location: location.trim() || null,
      message: message.trim() || null,
      proposed_rate: rate === '' ? null : Number(rate),
      status: 'pending',
    })
    setBusy(false)
    if (error) return setError(error.message)
    onBooked()
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-ink-900">Boekingsaanvraag</h2>
            <p className="text-sm text-ink-700/70">naar {teacherName}</p>
          </div>
          <button onClick={onClose} className="btn-ghost px-2 text-lg leading-none">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Datum</label>
            <input
              type="date"
              className="input"
              min={minDate}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Van</label>
              <input
                type="time"
                className="input"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Tot</label>
              <input
                type="time"
                className="input"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Stijl</label>
              <select
                className="input"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
              >
                {YOGA_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Voorgesteld tarief (€)</label>
              <input
                type="number"
                min={0}
                className="input"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="bv. 50"
              />
            </div>
          </div>

          <div>
            <label className="label">Locatie</label>
            <input
              className="input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Adres of naam van de studio"
            />
          </div>

          <div>
            <label className="label">Bericht (optioneel)</label>
            <textarea
              className="input min-h-20"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Extra info over de les of de groep…"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary">
              Annuleren
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Versturen…' : 'Aanvraag versturen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

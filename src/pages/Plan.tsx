import { useState } from 'react'
import type { PlanDay, Settings, WeekPlan } from '../../shared/types'
import { Bars } from '../components/charts'
import { Card, Loading, PageHeader, StatusPill, buttonCls, inputCls } from '../components/ui'
import { apiFetch, useApi } from '../lib/api'
import { fmtDate, fmtPace, fmtTime, parseTime } from '../lib/format'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PHASE: Record<WeekPlan['phase'], string> = {
  base: 'Base building',
  build: 'Build',
  specific: 'Race-specific',
  taper: 'Taper',
  race: 'Race week',
  recovery: 'Recovery',
}
const KIND_MARK: Record<PlanDay['kind'], { label: string; color: string }> = {
  rest: { label: 'Rest', color: 'var(--line)' },
  easy: { label: 'Easy', color: 'var(--series-3)' },
  strides: { label: 'Easy + strides', color: 'var(--series-3)' },
  long: { label: 'Long', color: 'var(--series-1)' },
  threshold: { label: 'Quality', color: 'var(--series-2)' },
  halfPace: { label: 'Quality', color: 'var(--series-2)' },
  intervals: { label: 'Quality', color: 'var(--series-2)' },
  race: { label: 'Race', color: 'var(--series-4)' },
}

export default function Plan() {
  const { data, error, reload } = useApi<WeekPlan>('/plan')
  if (!data) return <Loading error={error} />
  const p = data.paces
  const history = [
    ...data.recentWeeksKm.map((w) => ({ week: fmtDate(w.weekStart, { day: 'numeric', month: 'short' }), km: w.km })),
    { week: 'Plan', km: data.targetKm },
  ]

  return (
    <>
      <PageHeader title={`Week of ${fmtDate(data.weekStart, { day: 'numeric', month: 'long' })}`}>
        A recommendation for your next training week, aimed at running a faster half marathon. It adapts to your recent
        volume, recovery signals and (if set) your goal race.
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill state="neutral" label={PHASE[data.phase]} />
        <StatusPill state="neutral" label={`${data.targetKm} km planned`} />
        <StatusPill state={data.readiness.status} label={`readiness: ${data.readiness.status}`} />
        {data.goalHalfSeconds && <StatusPill state="neutral" label={`goal ${fmtTime(data.goalHalfSeconds)}`} />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {data.days.map((d) => (
          <div key={d.date} className={`flex flex-col rounded-2xl border border-line bg-surface p-3.5 ${d.kind === 'rest' ? 'opacity-70' : ''}`}>
            <div className="flex items-center justify-between text-[12px] text-muted">
              <span className="font-medium text-ink-2">{d.weekday.slice(0, 3)}</span>
              <span>{fmtDate(d.date, { day: 'numeric', month: 'short' })}</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: KIND_MARK[d.kind].color }} />
              {KIND_MARK[d.kind].label}
            </div>
            <div className="mt-1 text-[15px] font-semibold leading-snug">{d.title}</div>
            {d.km > 0 && <div className="tabular text-[13px] text-ink-2">≈ {d.km} km</div>}
            <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{d.details}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Why this week looks like this">
          <ul className="list-disc space-y-2 pl-4 text-[13px] text-ink-2">
            {data.rationale.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Card>
        <Card title="Your training paces" subtitle="From current fitness; HM pace from your goal when set">
          <table className="tabular w-full text-sm">
            <tbody className="divide-y divide-line">
              {[
                ['Easy / long', `${fmtPace(p.easy[0])} – ${fmtPace(p.easy[1])}`],
                ['Marathon', fmtPace(p.marathon)],
                ['Half marathon', fmtPace(p.half)],
                ['Threshold', fmtPace(p.threshold)],
                ['Interval (VO₂max)', fmtPace(p.interval)],
                ['Strides / reps', fmtPace(p.repetition)],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td className="py-2 text-ink-2">{k}</td>
                  <td className="py-2 text-right font-medium">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Volume: recent weeks vs plan" subtitle="Running km per week">
          <Bars data={history} x="week" series={[{ key: 'km', label: 'Running' }]} format={(v) => `${Math.round(v)}`} highlightLast height={200} />
        </Card>
      </div>

      <SettingsForm onSaved={reload} />
    </>
  )
}

function SettingsForm({ onSaved }: { onSaved: () => void }) {
  const { data } = useApi<Settings>('/settings')
  return data ? <SettingsEditor initial={data} onSaved={onSaved} /> : null
}

function SettingsEditor({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const [s, setS] = useState<Settings>(initial)
  const [goalText, setGoalText] = useState(initial.goalHalfSeconds ? fmtTime(initial.goalHalfSeconds) : '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const saved = await apiFetch<Settings>('/settings', {
        method: 'PUT',
        body: JSON.stringify({ ...s, goalHalfSeconds: goalText ? parseTime(goalText) : null }),
      })
      setS(saved)
      setMsg('Saved — plan updated.')
      onSaved()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const toggleRest = (d: number) =>
    setS({ ...s, restDays: s.restDays.includes(d) ? s.restDays.filter((x) => x !== d) : [...s.restDays, d].sort() })

  return (
    <Card className="mt-4" title="Your goal & schedule" subtitle="Seeded from your Garmin training-day preferences until you save">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-[13px] text-ink-2">
          Goal half-marathon date
          <input type="date" className={`${inputCls} mt-1`} value={s.goalRaceDate ?? ''} onChange={(e) => setS({ ...s, goalRaceDate: e.target.value || null })} />
        </label>
        <label className="text-[13px] text-ink-2">
          Goal time (h:mm:ss)
          <input className={`${inputCls} mt-1`} placeholder="1:29:59" value={goalText} onChange={(e) => setGoalText(e.target.value)} />
        </label>
        <label className="text-[13px] text-ink-2">
          Runs per week
          <select className={`${inputCls} mt-1`} value={s.runDaysPerWeek} onChange={(e) => setS({ ...s, runDaysPerWeek: Number(e.target.value) })}>
            {[3, 4, 5, 6, 7].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="text-[13px] text-ink-2">
          Max km per week (optional)
          <input type="number" min={0} className={`${inputCls} mt-1`} value={s.maxWeeklyKm ?? ''} onChange={(e) => setS({ ...s, maxWeeklyKm: e.target.value ? Number(e.target.value) : null })} />
        </label>
        <label className="text-[13px] text-ink-2">
          Long run day
          <select className={`${inputCls} mt-1`} value={s.longRunDay} onChange={(e) => setS({ ...s, longRunDay: Number(e.target.value) })}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
        </label>
        <fieldset className="text-[13px] text-ink-2 sm:col-span-2">
          <legend>Preferred rest days</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleRest(i)}
                aria-pressed={s.restDays.includes(i)}
                className={`rounded-lg border px-2.5 py-1.5 text-[13px] ${s.restDays.includes(i) ? 'border-accent bg-[var(--wash)] text-ink' : 'border-line text-ink-2'}`}
              >
                {d}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex items-end gap-3">
          <button className={buttonCls} disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save & update plan'}
          </button>
        </div>
      </div>
      {msg && <p className="mt-3 text-[13px] text-ink-2">{msg}</p>}
    </Card>
  )
}

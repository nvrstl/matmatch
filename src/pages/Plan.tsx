import { useState } from 'react'
import type { PlanDay, Realism, RaceKey, Settings, TrainingBlock, WeekPlan } from '../../shared/types'
import { RACES } from '../../shared/types'
import { localToday } from '../../shared/dates'
import { Bars } from '../components/charts'
import { Card, Loading, PageHeader, Segmented, StatusPill, buttonCls, inputCls } from '../components/ui'
import { apiFetch, useApi } from '../lib/api'
import { parseTimeInput } from '../../shared/timeinput'
import { fmtDate, fmtPace, fmtTime } from '../lib/format'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const RACE_SHORT: Record<RaceKey, string> = { '5k': '5K', '10k': '10K', half: '21K', marathon: '42K' }
const RACE_NAME: Record<RaceKey, string> = { '5k': '5K', '10k': '10K', half: 'Half marathon', marathon: 'Marathon' }
const PHASE: Record<WeekPlan['phase'], string> = {
  base: 'Base',
  build: 'Build',
  specific: 'Specific',
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
  halfPace: { label: 'Race pace', color: 'var(--series-2)' },
  racePace: { label: 'Race pace', color: 'var(--series-2)' },
  intervals: { label: 'Quality', color: 'var(--series-2)' },
  race: { label: 'Race', color: 'var(--series-4)' },
}
const REALISM: Record<Realism['level'], { state: string; icon: string; color: string }> = {
  likely: { state: 'good', icon: '●', color: 'var(--color-good)' },
  realistic: { state: 'good', icon: '●', color: 'var(--color-good)' },
  ambitious: { state: 'caution', icon: '▲', color: 'var(--color-warning)' },
  unlikely: { state: 'bad', icon: '■', color: 'var(--color-critical)' },
}

export default function Plan() {
  const settings = useApi<Settings>('/settings')
  const blk = useApi<TrainingBlock>('/block')
  if (!settings.data || !blk.data) return <Loading error={settings.error ?? blk.error} />
  const reload = () => {
    settings.reload()
    blk.reload()
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Training plan">
        Pick your race, the date and the time or pace you want to run. You get a plan for every week until race day and an
        honest view of how realistic the target is.
      </PageHeader>
      <GoalEditor key={JSON.stringify(settings.data)} initial={settings.data} onSaved={reload} />
      {blk.data.realism && <RealismCard r={blk.data.realism} goal={blk.data.goalSeconds} race={blk.data.race} />}
      {blk.data.raceDate ? <Timeline block={blk.data} /> : <WeekDetail week={blk.data.weeks[blk.data.weeks.length - 1]} />}
      {blk.data.notes.map((n) => (
        <p key={n} className="text-[13px] text-ink-2">{n}</p>
      ))}
      <ScheduleEditor key={`s${JSON.stringify(settings.data)}`} initial={settings.data} onSaved={reload} />
    </div>
  )
}

// ---------------------------------------------------------------------------

function GoalEditor({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const [race, setRace] = useState<RaceKey>(initial.goalRace)
  const [date, setDate] = useState(initial.goalRaceDate ?? '')
  const [mode, setMode] = useState<'time' | 'pace'>('time')
  const meters = RACES.find((r) => r.key === race)!.meters
  const [text, setText] = useState(initial.goalTimeSeconds ? fmtTime(initial.goalTimeSeconds) : '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const parsed = parseTimeInput(text, { kind: mode, meters })
  const seconds = parsed === null ? null : mode === 'time' ? parsed : Math.round(parsed * (meters / 1000))
  const pace = seconds ? seconds / (meters / 1000) : null
  const sane = pace !== null && pace > 150 && pace < 600

  const switchMode = (m: 'time' | 'pace') => {
    if (seconds && sane) setText(fmtTime(m === 'time' ? seconds : seconds / (meters / 1000)))
    setMode(m)
  }
  const switchRace = (r: RaceKey) => {
    // keep the same pace when switching distance in pace mode; clear a finish time otherwise
    if (mode === 'time') setText('')
    setRace(r)
  }
  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      await apiFetch<Settings>('/settings', {
        method: 'PUT',
        body: JSON.stringify({ goalRace: race, goalRaceDate: date || null, goalTimeSeconds: sane ? seconds : null }),
      })
      setMsg('Saved. Your plan is updated.')
      onSaved()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Your race">
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-[13px] text-ink-2">Distance</div>
          <Segmented value={race} onChange={switchRace} options={RACES.map((r) => ({ value: r.key, label: RACE_SHORT[r.key] }))} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-[13px] text-ink-2">
            Race date
            <input id="goal-date" type="date" min={localToday()} className={`${inputCls} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="text-[13px] text-ink-2">
            <div className="flex items-center justify-between">
              <span>Target</span>
              <span className="inline-flex rounded-md border border-line text-[12px]">
                {(['time', 'pace'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => switchMode(m)}
                    className={`px-2 py-0.5 ${mode === m ? 'bg-[var(--wash)] font-medium text-ink' : 'text-ink-2'}`}
                  >
                    {m === 'time' ? 'Finish time' : 'Pace /km'}
                  </button>
                ))}
              </span>
            </div>
            <input
              id="goal-target"
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              className={`${inputCls} mt-1 tabular`}
              placeholder={mode === 'time' ? { '5k': '1930 = 19:30', '10k': '4000 = 40:00', half: '12900 = 1:29:00', marathon: '31000 = 3:10:00' }[race] : '415 = 4:15/km'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => parsed !== null && setText(fmtTime(parsed))}
            />
            <div className="mt-1 h-4 text-[12px] text-muted">
              {sane && seconds
                ? mode === 'time'
                  ? `${fmtTime(seconds)} = ${fmtPace(pace!)}`
                  : `${fmtPace(parsed!)} = ${fmtTime(seconds)} finish`
                : text
                  ? 'Type digits only, e.g. 12259 for 1:22:59 or 356 for 3:56/km'
                  : 'Optional: leave empty to train on current fitness'}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className={buttonCls} disabled={saving || !date} onClick={save}>
            {saving ? 'Saving…' : 'Make my plan'}
          </button>
          {!date && <span className="text-[12px] text-muted">Pick a race date to plan up to race day.</span>}
          {msg && <span className="text-[13px] text-ink-2">{msg}</span>}
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------

function RealismCard({ r, goal, race }: { r: Realism; goal: number | null; race: RaceKey }) {
  const look = REALISM[r.level]
  // Needed vs typical improvement, on one scale.
  const max = Math.max(r.typicalGain, r.neededVdot - r.currentVdot, 0.5) * 1.15
  const needed = Math.max(0, r.neededVdot - r.currentVdot)
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] text-ink-2">
            {RACE_NAME[race]} in {r.weeks} weeks{goal ? ` · target ${fmtTime(goal)}` : ''}
          </div>
          <div className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {goal && <span aria-hidden style={{ color: look.color, fontSize: 14 }}>{look.icon}</span>}
            {r.headline}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12px] text-muted">Expected on race day</div>
          <div className="tabular text-xl font-semibold">{fmtTime(Math.round(r.projectedSeconds / 5) * 5)}</div>
          <div className="tabular text-[12px] text-muted">
            {fmtTime(r.projectedRange[0])}–{fmtTime(r.projectedRange[1])}
          </div>
        </div>
      </div>
      <p className="mt-3 text-[14px] text-ink-2">{r.summary}</p>
      {goal && (
        <div className="mt-4 space-y-2 text-[12px]">
          <Meter label="Improvement your target needs" value={needed} max={max} color={look.color} text={needed > 0 ? `+${needed.toFixed(1)} VDOT` : 'none'} />
          <Meter label={`Typical in ${r.weeks} weeks at your level`} value={r.typicalGain} max={max} color="var(--series-1)" text={`+${r.typicalGain.toFixed(1)} VDOT`} />
        </div>
      )}
      <ul className="mt-4 list-disc space-y-1 pl-4 text-[12px] text-ink-2">
        {r.factors.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </section>
  )
}

function Meter({ label, value, max, color, text }: { label: string; value: number; max: number; color: string; text: string }) {
  return (
    <div>
      <div className="flex justify-between text-ink-2">
        <span>{label}</span>
        <span className="tabular font-medium text-ink">{text}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-[var(--line)]">
        <div className="h-2 rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Timeline({ block }: { block: TrainingBlock }) {
  const today = localToday()
  const [open, setOpen] = useState<string | null>(block.weeks[0]?.weekStart ?? null)
  const maxKm = Math.max(...block.weeks.map((w) => w.targetKm), 1)
  return (
    <Card title={`Your ${block.weeks.length}-week plan`} subtitle={`To ${block.raceDate ? fmtDate(block.raceDate, { weekday: 'long', day: 'numeric', month: 'long' }) : 'race day'}. Tap a week for its sessions. Later weeks adapt to how training goes.`}>
      <ol className="divide-y divide-line">
        {block.weeks.map((w, i) => {
          const isOpen = open === w.weekStart
          const current = w.weekStart <= today && today < addWeek(w.weekStart)
          const raceDay = w.days.find((d) => d.kind === 'race')
          const key = raceDay ? [raceDay.title] : w.days.filter((d) => ['threshold', 'intervals', 'racePace', 'halfPace'].includes(d.kind)).map((d) => d.title)
          const long = w.days.find((d) => d.kind === 'long')
          return (
            <li key={w.weekStart}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : w.weekStart)}
                aria-expanded={isOpen}
                className={`grid w-full grid-cols-[3.2rem_1fr_auto] items-center gap-3 py-2.5 text-left ${current ? 'font-medium' : ''}`}
              >
                <span className="text-[12px] text-muted">
                  {i === 0 && current ? 'Now' : `Wk ${i + 1}`}
                  <span className="block text-[11px]">{fmtDate(w.weekStart, { day: 'numeric', month: 'short' })}</span>
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[13px]">
                    <span className="shrink-0 whitespace-nowrap rounded-full border border-line px-1.5 py-px text-[11px] text-ink-2">{PHASE[w.phase]}</span>
                    <span className="truncate text-ink-2">{key.length ? key.join(' · ') : long ? long.title : 'Easy running'}</span>
                  </span>
                  <span className="mt-1 block h-1.5 rounded-full bg-[var(--line)]">
                    <span
                      className="block h-1.5 rounded-full"
                      style={{ width: `${(w.targetKm / maxKm) * 100}%`, background: w.phase === 'race' ? 'var(--series-4)' : w.phase === 'taper' || w.phase === 'recovery' ? 'color-mix(in srgb, var(--series-1) 50%, transparent)' : 'var(--series-1)' }}
                    />
                  </span>
                </span>
                <span className="tabular text-[13px]">
                  {w.targetKm} km<span className="ml-1 text-muted" aria-hidden>{isOpen ? '▴' : '▾'}</span>
                </span>
              </button>
              {isOpen && (
                <div className="pb-3">
                  <DayList days={w.days} />
                  {w.rationale.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] text-ink-2">
                      {w.rationale.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <Paces week={block.weeks[0]} />
    </Card>
  )
}

const addWeek = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 7)
  return t.toISOString().slice(0, 10)
}

function DayList({ days }: { days: PlanDay[] }) {
  return (
    <ul className="space-y-1.5">
      {days.map((d) => (
        <li key={d.date} className={`rounded-xl px-3 py-2 ${d.kind === 'rest' ? '' : 'bg-[var(--wash)]'}`}>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="w-8 text-muted">{d.weekday.slice(0, 3)}</span>
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_MARK[d.kind].color }} />
            <span className={`min-w-0 flex-1 ${d.kind === 'rest' ? 'text-muted' : 'font-medium'}`}>{d.title}</span>
            {d.km > 0 && <span className="tabular text-[12px] text-ink-2">{d.km} km</span>}
          </div>
          {d.kind !== 'rest' && <p className="mt-0.5 pl-10 text-[12px] leading-relaxed text-ink-2">{d.details}</p>}
        </li>
      ))}
    </ul>
  )
}

function Paces({ week }: { week: WeekPlan }) {
  const p = week.paces
  const rows: [string, string][] = [
    [`${RACE_NAME[week.race]} (target)`, fmtPace(p.race)],
    ['Easy / long', `${fmtPace(p.easy[0])} – ${fmtPace(p.easy[1])}`],
    ['Threshold', fmtPace(p.threshold)],
    ['Interval (VO₂max)', fmtPace(p.interval)],
    ['Strides / 400 m reps', fmtPace(p.repetition)],
  ]
  if (week.race !== 'marathon') rows.splice(2, 0, ['Marathon', fmtPace(p.marathon)])
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-1 text-[13px] font-semibold">Your training paces</div>
      <table className="tabular w-full text-[13px]">
        <tbody className="divide-y divide-line">
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="py-1.5 text-ink-2">{k}</td>
              <td className="py-1.5 text-right font-medium">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Without a race date: the coming week only. */
function WeekDetail({ week }: { week: WeekPlan }) {
  const history = [
    ...week.recentWeeksKm.map((w) => ({ week: fmtDate(w.weekStart, { day: 'numeric', month: 'short' }), km: w.km })),
    { week: 'Plan', km: week.targetKm },
  ]
  return (
    <>
      <Card title={`Week of ${fmtDate(week.weekStart, { day: 'numeric', month: 'long' })}`} action={<StatusPill state="neutral" label={`${week.targetKm} km`} />}>
        <DayList days={week.days} />
        <ul className="mt-3 list-disc space-y-1 pl-4 text-[12px] text-ink-2">
          {week.rationale.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <Paces week={week} />
      </Card>
      <Card title="Volume: recent weeks vs plan" subtitle="Running km per week">
        <Bars data={history} x="week" series={[{ key: 'km', label: 'Running' }]} format={(v) => `${Math.round(v)}`} highlightLast height={180} />
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------

function ScheduleEditor({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const [s, setS] = useState<Settings>(initial)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const { runDaysPerWeek, longRunDay, restDays, maxWeeklyKm } = s
      await apiFetch<Settings>('/settings', { method: 'PUT', body: JSON.stringify({ runDaysPerWeek, longRunDay, restDays, maxWeeklyKm }) })
      setMsg('Saved. Your plan is updated.')
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
    <Card title="Your week" subtitle="When you run. Seeded from your Garmin training-day preferences until you save.">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-[13px] text-ink-2">
          Runs per week
          <select className={`${inputCls} mt-1`} value={s.runDaysPerWeek} onChange={(e) => setS({ ...s, runDaysPerWeek: Number(e.target.value) })}>
            {[3, 4, 5, 6, 7].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="text-[13px] text-ink-2">
          Long run day
          <select className={`${inputCls} mt-1`} value={s.longRunDay} onChange={(e) => setS({ ...s, longRunDay: Number(e.target.value) })}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
        </label>
        <label className="text-[13px] text-ink-2">
          Max km per week (optional)
          <input type="number" min={0} className={`${inputCls} mt-1`} value={s.maxWeeklyKm ?? ''} onChange={(e) => setS({ ...s, maxWeeklyKm: e.target.value ? Number(e.target.value) : null })} />
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
        <div className="flex items-end">
          <button className={buttonCls} disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {msg && <p className="mt-3 text-[13px] text-ink-2">{msg}</p>}
    </Card>
  )
}

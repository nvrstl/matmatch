import { Link } from 'react-router-dom'
import { daysBetween, localToday } from '../../shared/dates'
import type { Activity, Overview, PlanDay, Settings, WeekPlan } from '../../shared/types'
import { Card, Empty, Loading, StatusPill } from '../components/ui'
import { useApi } from '../lib/api'
import { IS_CLOUD } from '../lib/cloud'
import { fmtDate, fmtKm, fmtPace, fmtTime } from '../lib/format'

const KIND_COLOR: Record<PlanDay['kind'], string> = {
  rest: 'var(--line)',
  easy: 'var(--series-3)',
  strides: 'var(--series-3)',
  long: 'var(--series-1)',
  threshold: 'var(--series-2)',
  halfPace: 'var(--series-2)',
  intervals: 'var(--series-2)',
  race: 'var(--series-4)',
}

export default function Today() {
  const ov = useApi<Overview>('/overview')
  const plan = useApi<WeekPlan>('/plan?week=current')
  const settings = useApi<Settings>('/settings')
  const recent = useApi<{ total: number; items: Activity[] }>('/activities?sport=run&page=0')
  if (!ov.data || !plan.data || !settings.data || !recent.data) return <Loading error={ov.error ?? plan.error ?? recent.error} />
  if (!ov.data.hasData) {
    return (
      <Empty>
        {IS_CLOUD ? (
          <>
            Downloading your Garmin history. The first time takes under a minute; progress is on{' '}
            <Link to="/sync" className="text-accent underline">Sync</Link>.
          </>
        ) : (
          <>
            No data yet. Add your Garmin key and sync on <Link to="/sync" className="text-accent underline">Sync</Link>.
          </>
        )}
      </Empty>
    )
  }

  const today = localToday()
  const w = plan.data
  const todays = w.days.find((d) => d.date === today)
  const runs = recent.data.items
  const ranToday = runs.filter((a) => a.date === today)
  const weekRuns = runs.filter((a) => a.date >= w.weekStart)
  const doneKm = weekRuns.reduce((s, a) => s + a.distanceM / 1000, 0)
  const latest = runs[0]

  return (
    <div className="space-y-4">
      <header>
        <div className="text-[13px] text-muted">{fmtDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
      </header>

      {todays && (
        <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLOR[todays.kind] }} />
              Today’s session
            </div>
            {ranToday.length > 0 && <StatusPill state="good" label="done" />}
          </div>
          <div className="mt-1 text-xl font-semibold leading-snug">{todays.title}</div>
          {todays.km > 0 && <div className="tabular text-sm text-ink-2">≈ {todays.km} km</div>}
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{todays.details}</p>
          {ranToday.map((a) => (
            <Link key={a.id} to={`/activity/${a.id}`} className="mt-3 flex items-center justify-between rounded-xl bg-[var(--wash)] px-3 py-2 text-sm">
              <span>
                You ran <strong>{fmtKm(a.distanceM / 1000, 1)} km</strong> in {fmtTime(a.durationS)} ({fmtPace(a.durationS / (a.distanceM / 1000))})
              </span>
              <span className="text-accent">Details →</span>
            </Link>
          ))}
        </section>
      )}

      <RaceCountdown settings={settings.data} predicted={ov.data.half?.seconds ?? null} />

      <Card title="This week" action={<Link to="/plan" className="text-[13px] font-medium text-accent">Plan →</Link>}>
        <div className="flex items-baseline justify-between text-sm">
          <span>
            <strong className="text-lg tabular">{fmtKm(doneKm, 1)}</strong> <span className="text-ink-2">of {w.targetKm} km planned</span>
          </span>
          <span className="text-[12px] text-muted">{fmtDate(w.weekStart, { day: 'numeric', month: 'short' })} week</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-[var(--line)]" role="progressbar" aria-valuenow={Math.round(doneKm)} aria-valuemax={w.targetKm}>
          <div className="h-2 rounded-full" style={{ width: `${Math.min(100, (doneKm / Math.max(1, w.targetKm)) * 100)}%`, background: 'var(--series-1)' }} />
        </div>
        <ol className="mt-3 grid grid-cols-7 gap-1 text-center">
          {w.days.map((d) => {
            const ran = runs.some((a) => a.date === d.date)
            const past = d.date < today
            return (
              <li key={d.date} className={`rounded-lg py-1.5 text-[11px] ${d.date === today ? 'bg-[var(--wash)] font-semibold text-ink' : 'text-ink-2'}`}>
                <div>{d.weekday.slice(0, 1)}</div>
                <div className="mx-auto mt-1 h-2 w-2 rounded-full" style={{ background: KIND_COLOR[d.kind], opacity: d.kind === 'rest' ? 0.6 : 1 }} />
                <div className="mt-0.5 h-3 leading-3" aria-label={ran ? 'ran' : past && d.kind !== 'rest' ? 'missed' : ''}>
                  {ran ? '✓' : past && d.kind !== 'rest' ? '·' : ''}
                </div>
              </li>
            )
          })}
        </ol>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Readiness" action={<StatusPill state={ov.data.readiness.status} label={ov.data.readiness.status} />}>
          <ul className="divide-y divide-line">
            {ov.data.readiness.signals.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span className="text-ink-2">{s.label}</span>
                <StatusPill state={s.state} label={s.value} />
              </li>
            ))}
          </ul>
        </Card>
        {latest && (
          <Link to={`/activity/${latest.id}`} className="block rounded-2xl border border-line bg-surface p-4 sm:p-5">
            <div className="text-[13px] text-ink-2">Latest run · {fmtDate(latest.date, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
            <div className="mt-1 font-semibold">{latest.name}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <Mini label="Distance" value={`${fmtKm(latest.distanceM / 1000, 1)} km`} />
              <Mini label="Pace" value={fmtTime(latest.durationS / (latest.distanceM / 1000))} />
              <Mini label="Avg HR" value={latest.avgHr ? String(Math.round(latest.avgHr)) : '–'} />
            </div>
            <div className="mt-3 text-[13px] font-medium text-accent">Splits, zones and route →</div>
          </Link>
        )}
      </div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--wash)] py-2">
      <div className="tabular text-[15px] font-semibold">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  )
}

function RaceCountdown({ settings, predicted }: { settings: Settings; predicted: number | null }) {
  const today = localToday()
  if (!settings.goalRaceDate || settings.goalRaceDate < today) {
    return (
      <Link to="/plan" className="block rounded-2xl border border-dashed border-line p-4 text-[13px] text-ink-2">
        <strong className="text-ink">Set your goal half marathon</strong> to get a countdown, goal-pace training and a
        race-day pacing card. <span className="text-accent">Set goal →</span>
      </Link>
    )
  }
  const days = daysBetween(today, settings.goalRaceDate)
  return (
    <Link to="/races/pacing" className="block rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[13px] text-ink-2">Half marathon · {fmtDate(settings.goalRaceDate, { day: 'numeric', month: 'long' })}</div>
        <div className="text-[13px] font-medium text-accent">Pacing card →</div>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="text-3xl font-semibold tracking-tight tabular">
          {days === 0 ? 'Race day' : days < 14 ? `${days} days` : `${Math.round(days / 7)} weeks`}
        </span>
        {settings.goalHalfSeconds && <span className="text-sm text-ink-2">goal <strong className="text-ink">{fmtTime(settings.goalHalfSeconds)}</strong></span>}
        {predicted && <span className="text-sm text-ink-2">now predicted <strong className="text-ink">{fmtTime(predicted)}</strong></span>}
      </div>
    </Link>
  )
}

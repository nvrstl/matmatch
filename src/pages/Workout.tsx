import { Link, useParams } from 'react-router-dom'
import type { Activity, Paces, PlanDay, WeekPlan, WorkoutDetail } from '../../shared/types'
import { DistanceChart, RouteSketch } from '../components/charts'
import { Card, Loading, StatusPill } from '../components/ui'
import { useApi } from '../lib/api'
import { fmtDate, fmtKm, fmtPace, fmtTime } from '../lib/format'

/** Pace bands from your training paces, fastest first (s/km upper bound, exclusive). */
function paceBands(p: Paces) {
  return [
    { key: 'fast', label: 'Faster than interval', max: p.interval * 0.97, color: 'var(--series-4)' },
    { key: 'interval', label: 'Interval (VO₂max)', max: p.threshold * 0.985, color: 'var(--series-2)' },
    { key: 'threshold', label: 'Threshold / half-marathon', max: p.marathon * 0.985, color: 'var(--series-2)' },
    { key: 'steady', label: 'Steady / marathon', max: p.easy[0], color: 'var(--series-1)' },
    { key: 'easy', label: 'Easy', max: p.easy[1] * 1.04, color: 'var(--series-3)' },
    { key: 'recovery', label: 'Recovery / walking', max: Infinity, color: 'var(--line)' },
  ]
}

const ZONE_COLORS = ['var(--series-3)', 'var(--series-3)', 'var(--series-1)', 'var(--series-2)', 'var(--series-4)']

export default function Workout() {
  const { id = '' } = useParams()
  const summary = useApi<Activity | null>(`/activities/${id}`)
  const detail = useApi<WorkoutDetail>(`/activity/${id}`)
  const plan = useApi<WeekPlan>('/plan?week=current')
  const a = summary.data
  const planned = useApi<PlanDay | null>(a ? `/planned/${a.date}` : '/planned/none')

  if (summary.error) return <Loading error={summary.error} />
  if (!summary.loaded) return <Loading />
  if (!a) return <Loading error="This activity isn’t in your synced data." />

  const pace = a.distanceM ? a.durationS / (a.distanceM / 1000) : null
  const d = detail.data
  const bands = plan.data ? paceBands(plan.data.paces) : null

  // Time per pace band, from the trace.
  const bandSeconds = new Map<string, number>()
  if (d && bands) {
    for (let i = 1; i < d.trace.length; i++) {
      const pt = d.trace[i]
      const dt = pt.t - d.trace[i - 1].t
      if (dt <= 0 || dt > 60) continue
      const band = pt.pace === null ? bands[bands.length - 1] : bands.find((b) => pt.pace! < b.max)!
      bandSeconds.set(band.key, (bandSeconds.get(band.key) ?? 0) + dt)
    }
  }
  const moving = [...bandSeconds.values()].reduce((s, v) => s + v, 0)

  return (
    <div className="space-y-4">
      <div>
        <Link to="/activities" className="text-[13px] text-accent">← Activities</Link>
        <div className="mt-2 text-[13px] text-muted">{fmtDate(a.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <h1 className="text-2xl font-semibold tracking-tight">{a.name}</h1>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Big label="Distance" value={`${fmtKm(a.distanceM / 1000, 2)} km`} />
        <Big label="Time" value={fmtTime(a.durationS)} />
        <Big label="Pace" value={pace ? fmtPace(pace) : '–'} />
        <Big label="Avg / max HR" value={a.avgHr ? `${Math.round(a.avgHr)} / ${a.maxHr ? Math.round(a.maxHr) : '–'}` : '–'} />
      </div>

      {planned.data && <PlanVerdict planned={planned.data} activity={a} bandSeconds={bandSeconds} trace={d?.trace ?? null} />}

      {detail.error && <Card><p className="text-sm text-ink-2">Couldn’t load the detailed file from Garmin: {detail.error}</p></Card>}
      {!d && !detail.error && <Card><p className="animate-pulse text-sm text-muted">Loading laps, splits and route from Garmin…</p></Card>}

      {d && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Pace" subtitle="Smoothed over 30 s · faster is higher">
              <DistanceChart data={d.trace.map((p) => ({ km: p.d / 1000, value: p.pace }))} label="Pace" format={(v) => fmtTime(v)} invert />
            </Card>
            <Card title="Heart rate" subtitle="bpm">
              <DistanceChart data={d.trace.map((p) => ({ km: p.d / 1000, value: p.hr }))} label="Heart rate" format={(v) => `${Math.round(v)}`} color="var(--series-2)" />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2" title="Kilometre splits">
              <Splits splits={d.kmSplits} />
            </Card>
            <div className="space-y-4">
              {d.route.length > 1 && (
                <Card title="Route">
                  <RouteSketch route={d.route} />
                </Card>
              )}
              {d.hrZones && <Card title="Heart-rate zones" subtitle="Zones from your watch settings"><Zones zones={d.hrZones} /></Card>}
            </div>
          </div>

          {bands && moving > 0 && (
            <Card title="Time at your training paces" subtitle="How this run maps onto your current paces">
              <ul className="space-y-2">
                {bands.map((b) => {
                  const s = bandSeconds.get(b.key) ?? 0
                  if (s < 30) return null
                  return (
                    <li key={b.key} className="text-[13px]">
                      <div className="flex justify-between">
                        <span className="text-ink-2">{b.label}</span>
                        <span className="tabular font-medium">{fmtTime(s)}</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-[var(--line)]">
                        <div className="h-2 rounded-full" style={{ width: `${(s / moving) * 100}%`, background: b.color }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}

          {d.laps.length > 1 && !d.laps.every((l) => Math.abs(l.distanceM - 1000) < 5 || l === d.laps[d.laps.length - 1]) && (
            <Card title="Laps" subtitle="As recorded on your watch">
              <LapTable laps={d.laps} />
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-3 py-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="tabular text-lg font-semibold">{value}</div>
    </div>
  )
}

function Splits({ splits }: { splits: WorkoutDetail['kmSplits'] }) {
  const paces = splits.map((s) => s.durationS / (s.distanceM / 1000))
  const fastest = Math.min(...paces)
  const slowest = Math.max(...paces)
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="text-left text-[12px] text-muted">
            <th className="py-1.5 font-normal">Km</th>
            <th className="py-1.5 font-normal">Pace</th>
            <th className="w-1/2 py-1.5 font-normal" aria-label="Pace bar" />
            <th className="py-1.5 text-right font-normal">HR</th>
            <th className="py-1.5 text-right font-normal">Climb</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {splits.map((s, i) => {
            const p = paces[i]
            const frac = slowest === fastest ? 1 : 0.35 + 0.65 * ((slowest - p) / (slowest - fastest))
            return (
              <tr key={s.km}>
                <td className="py-1.5">{s.distanceM < 990 ? `${((s.km - 1) + s.distanceM / 1000).toFixed(2)}` : s.km}</td>
                <td className="py-1.5 font-medium">{fmtTime(p)}</td>
                <td className="py-1.5 pr-3">
                  <div className="h-2 rounded-r" style={{ width: `${frac * 100}%`, background: p === fastest ? 'var(--series-1)' : 'color-mix(in srgb, var(--series-1) 55%, transparent)' }} />
                </td>
                <td className="py-1.5 text-right">{s.avgHr ?? '–'}</td>
                <td className="py-1.5 text-right text-ink-2">{s.elevGainM ? `+${s.elevGainM} m` : '–'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Zones({ zones }: { zones: NonNullable<WorkoutDetail['hrZones']> }) {
  const total = zones.reduce((s, z) => s + z.seconds, 0) || 1
  return (
    <ul className="space-y-2">
      {[...zones].reverse().map((z) => (
        <li key={z.zone} className="text-[13px]">
          <div className="flex justify-between">
            <span className="text-ink-2">
              Zone {z.zone} <span className="text-muted">· {z.lowBpm}–{z.highBpm} bpm</span>
            </span>
            <span className="tabular font-medium">{fmtTime(z.seconds)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-[var(--line)]">
            <div className="h-2 rounded-full" style={{ width: `${(z.seconds / total) * 100}%`, background: ZONE_COLORS[z.zone - 1] }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function LapTable({ laps }: { laps: WorkoutDetail['laps'] }) {
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="text-left text-[12px] text-muted">
            <th className="py-1.5 font-normal">Lap</th>
            <th className="py-1.5 text-right font-normal">Distance</th>
            <th className="py-1.5 text-right font-normal">Time</th>
            <th className="py-1.5 text-right font-normal">Pace</th>
            <th className="py-1.5 text-right font-normal">HR</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {laps.map((l) => (
            <tr key={l.index} className={l.intensity === 'rest' || l.intensity === 'recovery' ? 'text-ink-2' : ''}>
              <td className="py-1.5">{l.index}{l.intensity && l.intensity !== 'active' && l.intensity !== 'interval' ? <span className="ml-1 text-[11px] text-muted">{l.intensity}</span> : null}</td>
              <td className="py-1.5 text-right">{fmtKm(l.distanceM / 1000, 2)} km</td>
              <td className="py-1.5 text-right">{fmtTime(l.durationS)}</td>
              <td className="py-1.5 text-right font-medium">{l.distanceM > 50 ? fmtTime(l.durationS / (l.distanceM / 1000)) : '–'}</td>
              <td className="py-1.5 text-right">{l.avgHr ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Compare the run with the session planned for that day. */
function PlanVerdict({ planned, activity, bandSeconds, trace }: { planned: PlanDay; activity: Activity; bandSeconds: Map<string, number>; trace: WorkoutDetail['trace'] | null }) {
  const km = activity.distanceM / 1000
  const kmGap = planned.km ? km - planned.km : 0
  const s = (k: string) => bandSeconds.get(k) ?? 0
  const quality = s('threshold') + s('interval') + s('fast')
  let verdict: { state: string; text: string }
  if (planned.kind === 'rest') {
    verdict = { state: 'caution', text: 'This was planned as a rest day. Fine now and then; recovery is part of the plan.' }
  } else if (planned.kind === 'easy' || planned.kind === 'long' || planned.kind === 'strides') {
    const tooHard = bandSeconds.size ? (s('threshold') + s('interval') + s('fast')) / Math.max(1, [...bandSeconds.values()].reduce((a, b) => a + b, 0)) : 0
    verdict =
      tooHard > 0.2
        ? { state: 'caution', text: `About ${Math.round(tooHard * 100)} % of this run was at threshold pace or faster. Easy days work best when they're truly easy.` }
        : { state: 'good', text: `Kept it controlled${planned.km ? `, ${kmGap >= -1 ? 'and the distance was on target' : `${fmtKm(-kmGap, 1)} km short of plan`}` : ''}.` }
  } else if (planned.targetPace && trace) {
    // Time at (or faster than) the session's own target pace, with 3 % leeway.
    let atPace = 0
    for (let i = 1; i < trace.length; i++) {
      const dt = trace[i].t - trace[i - 1].t
      if (dt > 0 && dt <= 60 && trace[i].pace !== null && trace[i].pace! <= planned.targetPace * 1.03) atPace += dt
    }
    const what = planned.kind === 'racePace' || planned.kind === 'halfPace' || planned.kind === 'race' ? 'race pace' : planned.kind === 'threshold' ? 'threshold pace' : 'interval pace'
    verdict =
      atPace >= 8 * 60 || (planned.kind === 'intervals' && atPace >= 4 * 60)
        ? { state: 'good', text: `${fmtTime(atPace)} at ${what} (${fmtPace(planned.targetPace)}) or faster. That's the work this session was for.` }
        : { state: 'caution', text: `Only ${fmtTime(atPace)} at ${what} (${fmtPace(planned.targetPace)}) or faster. The session called for more, so check the laps.` }
  } else {
    verdict =
      quality >= 8 * 60
        ? { state: 'good', text: `${fmtTime(quality)} at threshold pace or faster. That's the work this session was for.` }
        : { state: 'caution', text: `Only ${fmtTime(quality)} at threshold pace or faster. The session called for more, so check the laps.` }
  }
  return (
    <Card title="Compared with your plan" action={<StatusPill state={verdict.state} label={verdict.state === 'good' ? 'on plan' : 'check'} />}>
      <div className="text-[13px] text-muted">Planned</div>
      <div className="font-medium">{planned.title}{planned.km ? ` · ≈ ${planned.km} km` : ''}</div>
      <div className="mt-3 text-[13px] text-muted">You ran</div>
      <div className="font-medium">{fmtKm(km, 1)} km in {fmtTime(activity.durationS)}</div>
      <p className="mt-3 text-[13px] text-ink-2">{verdict.text}</p>
    </Card>
  )
}

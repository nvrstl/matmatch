import { useState } from 'react'
import type { Prediction, PredictionResult } from '../../shared/types'
import { RACES } from '../../shared/types'
import { timeFor, vdotFor } from '../../shared/vdot'
import { Card, Empty, Loading, PageHeader, StatusPill, inputCls } from '../components/ui'
import { RacesTabs } from '../components/RacesTabs'
import { useApi } from '../lib/api'
import { fmtDate, fmtPace, fmtTime, parseTime } from '../lib/format'

const HALF = 21097.5

export default function Races() {
  const { data, error } = useApi<PredictionResult>('/predictions')
  if (!data) return <Loading error={error} />
  if (!data.predictions.length)
    return (
      <>
        <PageHeader title="Race predictions" />
        <Empty>{data.notes[0]}</Empty>
      </>
    )

  const half = data.predictions.find((p) => p.race === 'half')!
  const others = data.predictions.filter((p) => p.race !== 'half')
  return (
    <>
      <RacesTabs />
      <PageHeader title="Race predictions">
        Built from your own best recent efforts (Daniels’ VDOT model), discounted for time since the effort, and adjusted
        for whether your recent volume and long runs support the distance. Current VDOT{' '}
        <strong className="text-ink">{data.vdot?.toFixed(1)}</strong>.
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Half marathon — your focus race">
          <div className="text-6xl font-semibold tracking-tight">{fmtTime(half.seconds)}</div>
          <div className="mt-1 text-sm text-ink-2">{fmtPace(half.seconds / (HALF / 1000))} average pace</div>
          <RangeBar p={half} />
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusPill state={half.confidence} label={`${half.confidence} confidence`} />
          </div>
          <p className="mt-3 text-[13px] text-ink-2">{half.basis}</p>
        </Card>
        <div className="grid gap-4 lg:col-span-2">
          {others.map((p) => (
            <Card key={p.race}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm text-ink-2">{p.label}</div>
                <StatusPill state={p.confidence} label={p.confidence} />
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-3xl font-semibold tracking-tight">{fmtTime(p.seconds)}</span>
                <span className="text-[13px] text-muted">{fmtPace(p.seconds / (p.meters / 1000))}</span>
              </div>
              <div className="mt-1 text-[12px] text-muted">
                range {fmtTime(p.low)}–{fmtTime(p.high)}
                {p.endurancePenalty > 0 && ` · +${(p.endurancePenalty * 100).toFixed(1)}% endurance`}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {data.notes.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-[13px] text-ink-2">
          {data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <GoalCalculator current={half.seconds} vdot={data.vdot!} />
        <Card title="Personal bests" subtitle="Fastest efforts inside any outdoor run (Garmin fastest splits)">
          <div className="overflow-x-auto">
            <table className="tabular w-full text-sm">
              <thead>
                <tr className="text-left text-[12px] text-muted">
                  <th className="py-2 font-normal">Distance</th>
                  <th className="py-2 text-right font-normal">All-time</th>
                  <th className="py-2 text-right font-normal">Last 12 months</th>
                  <th className="py-2 text-right font-normal">Predicted now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.bests.map((b) => {
                  const label = RACES.find((r) => r.key === b.race)!.label
                  const pred = data.predictions.find((p) => p.race === b.race)
                  return (
                    <tr key={b.race}>
                      <td className="py-2">{label}</td>
                      <td className="py-2 text-right">
                        {b.allTime ? (
                          <>
                            {fmtTime(b.allTime.seconds)}
                            <div className="text-[11px] text-muted">{fmtDate(b.allTime.date)}</div>
                          </>
                        ) : (
                          '–'
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {b.last12m ? (
                          <>
                            {fmtTime(b.last12m.seconds)}
                            <div className="text-[11px] text-muted">{fmtDate(b.last12m.date)}</div>
                          </>
                        ) : (
                          '–'
                        )}
                      </td>
                      <td className="py-2 text-right">{pred ? fmtTime(pred.seconds) : '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {data.garminVo2max && (
            <p className="mt-3 text-[12px] text-ink-2">
              Cross-check: Garmin’s VO₂max of {data.garminVo2max} would imply a{' '}
              {fmtTime(data.vo2maxPredictions.find((p) => p.race === 'half')!.seconds)} half. Watch-based VO₂max usually
              runs optimistic versus real races, so the main prediction trusts your actual efforts.
            </p>
          )}
        </Card>
      </div>
    </>
  )
}

/** Horizontal range: likely window, with the point estimate marked. */
function RangeBar({ p }: { p: Prediction }) {
  const pad = (p.high - p.low) * 0.25
  const lo = p.low - pad
  const span = p.high + pad - lo
  const pct = (s: number) => `${((s - lo) / span) * 100}%`
  return (
    <div className="mt-5">
      <div className="relative h-2 rounded-full bg-[var(--line)]">
        <div className="absolute h-2 rounded-full" style={{ left: pct(p.low), width: `calc(${pct(p.high)} - ${pct(p.low)})`, background: 'var(--series-1)', opacity: 0.35 }} />
        <div className="absolute -top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2" style={{ left: pct(p.seconds), background: 'var(--series-1)', borderColor: 'var(--surface)' }} />
      </div>
      <div className="tabular mt-1.5 flex justify-between text-[12px] text-muted">
        <span>good day {fmtTime(p.low)}</span>
        <span>tough day {fmtTime(p.high)}</span>
      </div>
    </div>
  )
}

function GoalCalculator({ current, vdot }: { current: number; vdot: number }) {
  const [goalText, setGoalText] = useState(fmtTime(Math.round((current - 120) / 60) * 60))
  const goal = parseTime(goalText)
  const valid = goal && goal > 3600 && goal < 4 * 3600
  const goalVdot = valid ? vdotFor(HALF, goal) : null
  return (
    <Card title="What would a goal half take?" subtitle="Equivalent performances at the fitness your goal requires">
      <label className="block text-[13px] text-ink-2" htmlFor="goal">
        Goal time (h:mm:ss)
      </label>
      <input id="goal" className={`${inputCls} mt-1 block max-w-40`} value={goalText} onChange={(e) => setGoalText(e.target.value)} />
      {goalVdot ? (
        <div className="mt-4 space-y-3 text-sm">
          <div>
            Goal pace <strong>{fmtPace(goal! / (HALF / 1000))}</strong> needs VDOT <strong>{goalVdot.toFixed(1)}</strong> — you’re at{' '}
            {vdot.toFixed(1)} ({goalVdot > vdot ? `${(goalVdot - vdot).toFixed(1)} to gain` : 'already there'}).
          </div>
          <div className="grid grid-cols-2 gap-2 text-[13px]">
            {RACES.filter((r) => r.key !== 'half').map((r) => (
              <div key={r.key} className="rounded-lg border border-line px-3 py-2">
                <div className="text-muted">{r.label} equivalent</div>
                <div className="tabular font-medium">{fmtTime(timeFor(goalVdot, r.meters))}</div>
              </div>
            ))}
            <div className="rounded-lg border border-line px-3 py-2">
              <div className="text-muted">Typical gain</div>
              <div className="font-medium">~1 VDOT / 6–8 wks</div>
            </div>
          </div>
          <p className="text-[12px] text-muted">
            Set it as your goal on the Next week page so the plan trains at goal pace.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-muted">Enter a time between 1:00:00 and 4:00:00.</p>
      )}
    </Card>
  )
}

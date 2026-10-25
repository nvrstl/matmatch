import { useMemo, useState } from 'react'
import { pacingPlan, type Strategy } from '../../shared/pacing'
import type { PredictionResult, RaceKey, Settings } from '../../shared/types'
import { RACES } from '../../shared/types'
import { vdotFor } from '../../shared/vdot'
import { Card, Loading, PageHeader, Segmented, inputCls } from '../components/ui'
import { RacesTabs } from '../components/RacesTabs'
import { useApi } from '../lib/api'
import { parseTimeInput } from '../../shared/timeinput'
import { fmtPace, fmtTime } from '../lib/format'

const remember = {
  get: (k: string) => {
    try {
      return localStorage.getItem(`lifelong:pacing:${k}`)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(`lifelong:pacing:${k}`, v)
    } catch {
      /* fine without */
    }
  },
}

export default function Pacing() {
  const pred = useApi<PredictionResult>('/predictions')
  const settings = useApi<Settings>('/settings')
  if (!pred.data || !settings.data) return <Loading error={pred.error ?? settings.error} />
  return <PacingCard pred={pred.data} settings={settings.data} />
}

function PacingCard({ pred, settings }: { pred: PredictionResult; settings: Settings }) {
  const [race, setRace] = useState<RaceKey>(() => (remember.get('race') as RaceKey) || settings.goalRace)
  const meters = RACES.find((r) => r.key === race)!.meters
  const predicted = pred.predictions.find((p) => p.race === race)?.seconds ?? null
  const defaultTarget = (r: RaceKey) => {
    const saved = remember.get(`target:${r}`)
    if (saved) return saved
    if (r === settings.goalRace && settings.goalTimeSeconds) return fmtTime(settings.goalTimeSeconds)
    const p = pred.predictions.find((x) => x.race === r)?.seconds
    return p ? fmtTime(Math.round(p / 30) * 30) : r === 'half' ? '1:45:00' : ''
  }
  const [targetText, setTargetText] = useState(() => defaultTarget(race))
  const [strategy, setStrategy] = useState<Strategy>(() => (remember.get('strategy') as Strategy) || 'negative')

  const target = parseTimeInput(targetText, { kind: 'time', meters })
  const valid = target !== null && target / (meters / 1000) > 150 && target / (meters / 1000) < 600
  const plan = useMemo(() => (valid ? pacingPlan(meters, target!, strategy) : null), [valid, meters, target, strategy])

  const chooseRace = (r: RaceKey) => {
    setRace(r)
    setTargetText(defaultTarget(r))
    remember.set('race', r)
  }
  const label = RACES.find((r) => r.key === race)!.label

  return (
    <>
      <RacesTabs />
      <PageHeader title="Race-day pacing">
        Your target pace, checkpoint times and every kilometre split. Take a screenshot to keep it on your phone at the
        start.
      </PageHeader>

      <div className="flex flex-wrap items-end gap-3">
        <Segmented
          value={race}
          onChange={chooseRace}
          options={RACES.map((r) => ({ value: r.key, label: r.key === 'half' ? 'Half' : r.label }))}
        />
        <label className="text-[13px] text-ink-2">
          <span className="block">Target time</span>
          <input
            id="pacing-target"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            className={`${inputCls} mt-1 w-32 tabular`}
            value={targetText}
            onChange={(e) => {
              setTargetText(e.target.value)
              remember.set(`target:${race}`, e.target.value)
            }}
            onBlur={() => target !== null && setTargetText(fmtTime(target))}
          />
        </label>
        <Segmented
          value={strategy}
          onChange={(s) => {
            setStrategy(s)
            remember.set('strategy', s)
          }}
          options={[
            { value: 'negative', label: 'Negative split' },
            { value: 'even', label: 'Even' },
          ]}
        />
      </div>

      {!plan ? (
        <p className="mt-4 text-sm text-ink-2">Type your target time, digits only is fine: 12500 for 1:25:00, 3930 for 39:30.</p>
      ) : (
        <>
          <section className="mt-4 rounded-2xl border border-line bg-surface p-5">
            <div className="text-[13px] text-ink-2">
              {label} · target {fmtTime(plan.targetSeconds)}
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-5xl font-semibold tracking-tight tabular">{fmtTime(plan.avgPace)}</span>
              <span className="text-lg text-ink-2">/km average</span>
            </div>
            {strategy === 'negative' && (
              <p className="mt-2 text-[13px] text-ink-2">
                First half at <strong className="text-ink">{fmtPace(plan.firstHalfPace)}</strong>, second half at{' '}
                <strong className="text-ink">{fmtPace(plan.secondHalfPace)}</strong>. Starting a touch slower saves your
                legs for a strong finish.
              </p>
            )}
            {predicted && <Feasibility meters={meters} target={plan.targetSeconds} predicted={predicted} vdot={pred.vdot} />}

            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {plan.checkpoints.map((c) => (
                <div key={c.label} className={`rounded-xl border px-3 py-2.5 ${c.label === 'Finish' ? 'border-accent bg-[var(--wash)]' : 'border-line'}`}>
                  <div className="text-[12px] text-muted">{c.label}</div>
                  <div className="tabular text-xl font-semibold">{fmtTime(c.cumulative)}</div>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2" title="Kilometre splits" subtitle="Split for each km and your clock time when you pass the marker">
              <div className="overflow-x-auto">
                <table className="tabular w-full text-sm">
                  <thead>
                    <tr className="text-left text-[12px] text-muted">
                      <th className="py-1.5 font-normal">Km</th>
                      <th className="py-1.5 text-right font-normal">Pace</th>
                      <th className="py-1.5 text-right font-normal">Split</th>
                      <th className="py-1.5 text-right font-normal">Clock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {plan.km.map((k) => {
                      const checkpoint = plan.checkpoints.find((c) => c.meters > (k.km - 1) * 1000 && c.meters <= k.km * 1000 && c.label !== 'Finish')
                      return (
                        <tr key={k.km} className={k.km % 5 === 0 || checkpoint ? 'bg-[var(--wash)]' : ''}>
                          <td className="py-1.5 pl-1">
                            {k.meters < 999 ? `${((k.km - 1) + k.meters / 1000).toFixed(1)}` : k.km}
                            {checkpoint && checkpoint.label === 'Half' && <span className="ml-2 text-[11px] text-muted">half-way</span>}
                          </td>
                          <td className="py-1.5 text-right">{fmtTime(k.pace)}</td>
                          <td className="py-1.5 text-right">{fmtTime(k.split)}</td>
                          <td className="py-1.5 pr-1 text-right font-medium">{fmtTime(k.cumulative)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Fuel & drinks">
              <ul className="list-disc space-y-2 pl-4 text-[13px] text-ink-2">
                {plan.fuel.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <h3 className="mt-4 text-[13px] font-semibold">On the day</h3>
              <ul className="mt-1 list-disc space-y-1.5 pl-4 text-[13px] text-ink-2">
                <li>Warm up 10–15 min easy plus a few strides.</li>
                <li>The first km always feels easy: hold back to your split.</li>
                <li>Watch distance drifts from the markers; trust the clock times above.</li>
              </ul>
            </Card>
          </div>
        </>
      )}
    </>
  )
}

function Feasibility({ meters, target, predicted, vdot }: { meters: number; target: number; predicted: number; vdot: number | null }) {
  const gap = target - predicted
  const need = vdotFor(meters, target)
  const tone =
    gap >= -0.005 * predicted
      ? { state: 'good', text: `In reach: your current prediction is ${fmtTime(predicted)}.` }
      : gap >= -0.03 * predicted
        ? { state: 'caution', text: `Ambitious: ${fmtTime(-gap)} faster than your prediction (${fmtTime(predicted)}). Needs VDOT ${need.toFixed(1)}${vdot ? ` vs your ${vdot.toFixed(1)}` : ''}.` }
        : { state: 'bad', text: `Very ambitious: ${fmtTime(-gap)} faster than your prediction (${fmtTime(predicted)}). Needs VDOT ${need.toFixed(1)}${vdot ? ` vs your ${vdot.toFixed(1)}` : ''}.` }
  const icon = { good: '●', caution: '▲', bad: '■' }[tone.state]
  const color = { good: 'var(--color-good)', caution: 'var(--color-warning)', bad: 'var(--color-critical)' }[tone.state]
  return (
    <p className="mt-3 flex items-start gap-2 text-[13px] text-ink-2">
      <span aria-hidden style={{ color, fontSize: 10, lineHeight: '20px' }}>{icon}</span>
      {tone.text}
    </p>
  )
}

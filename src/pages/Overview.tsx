import { Link } from 'react-router-dom'
import type { Overview as O } from '../../shared/types'
import { Bars } from '../components/charts'
import { Card, Empty, Loading, PageHeader, Stat, StatusPill } from '../components/ui'
import { useApi } from '../lib/api'
import { fmtDate, fmtKm, fmtPace, fmtTime, SPORT_LABEL } from '../lib/format'

export default function Overview() {
  const { data, error } = useApi<O>('/overview')
  if (!data) return <Loading error={error} />
  if (!data.hasData)
    return (
      <>
        <PageHeader title="Welcome" />
        <Empty>
          No data yet. Add your Garmin Personal API key and run your first sync on{' '}
          <Link to="/sync" className="text-accent underline">Sync</Link>.
        </Empty>
      </>
    )

  const h = data.half
  const weekDelta = data.thisWeekKm - data.avg4wKm
  const rhrDelta = data.restingHr && data.restingHrBaseline ? data.restingHr - data.restingHrBaseline : null
  return (
    <>
      <PageHeader title="Overview">
        {fmtDate(data.firstDate!)} – {fmtDate(data.lastDate!)} · everything since your first recorded activity.
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1" title="Half marathon, if you raced today">
          {h ? (
            <>
              <div className="text-5xl font-semibold tracking-tight">{fmtTime(h.seconds)}</div>
              <div className="mt-1 text-sm text-ink-2">
                {fmtPace(h.seconds / 21.0975)} · likely {fmtTime(h.low)}–{fmtTime(h.high)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill state={h.confidence} label={`${h.confidence} confidence`} />
              </div>
              <p className="mt-3 text-[13px] text-ink-2">{h.basis}</p>
              <Link to="/races" className="mt-3 inline-block text-sm font-medium text-accent">All race predictions →</Link>
            </>
          ) : (
            <p className="text-sm text-ink-2">Not enough recent outdoor runs to predict yet.</p>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <Stat
            label="This week so far"
            value={`${fmtKm(data.thisWeekKm, 1)} km`}
            sub={`${fmtKm(Math.max(0, -weekDelta), 1)} km to reach your 4-week average`}
          />
          <Stat label="4-week average" value={`${fmtKm(data.avg4wKm, 1)} km`} sub={`last week ${fmtKm(data.lastWeekKm, 1)} km`} />
          <Stat
            label="Fitness (42-day load)"
            value={data.load ? fmtKm(data.load.ctl) : '–'}
            sub={data.load ? `fatigue ${fmtKm(data.load.atl)} · form ${data.load.tsb >= 0 ? '+' : ''}${fmtKm(data.load.tsb)}` : undefined}
          />
          <Stat
            label="Resting heart rate"
            value={data.restingHr ? `${fmtKm(data.restingHr)} bpm` : '–'}
            delta={rhrDelta !== null ? { text: `${rhrDelta >= 0 ? '+' : ''}${rhrDelta.toFixed(1)}`, good: Math.abs(rhrDelta) < 1 ? null : rhrDelta < 0 } : undefined}
            sub={data.vo2max ? `VO₂max ${data.vo2max}` : 'vs 60-day baseline'}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Running volume, last 52 weeks" subtitle="km per week · current week highlighted">
          <Bars
            data={data.weekly}
            x="weekStart"
            series={[{ key: 'km', label: 'Running' }]}
            format={(v) => `${Math.round(v)}`}
            xFormat={(d) => fmtDate(d, { day: 'numeric', month: 'short' })}
            highlightLast
          />
        </Card>
        <Card
          title="Readiness"
          subtitle="Signals the weekly plan responds to"
          action={<StatusPill state={data.readiness.status} label={data.readiness.status} />}
        >
          {data.readiness.signals.length ? (
            <ul className="divide-y divide-line">
              {data.readiness.signals.map((s) => (
                <li key={s.label} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="text-ink-2">{s.label}</span>
                  <StatusPill state={s.state} label={s.value} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">No recent wellness data.</p>
          )}
          <Link to="/plan" className="mt-3 inline-block text-sm font-medium text-accent">See next week’s plan →</Link>
        </Card>
      </div>

      <Card className="mt-4" title="Lifetime totals">
        <div className="overflow-x-auto">
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="py-2 font-normal">Sport</th>
                <th className="py-2 text-right font-normal">Activities</th>
                <th className="py-2 text-right font-normal">Distance</th>
                <th className="py-2 text-right font-normal">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.lifetime.map((l) => (
                <tr key={l.sport}>
                  <td className="py-2">{SPORT_LABEL[l.sport]}</td>
                  <td className="py-2 text-right">{l.count.toLocaleString()}</td>
                  <td className="py-2 text-right">{l.km ? `${l.km.toLocaleString()} km` : '–'}</td>
                  <td className="py-2 text-right">{l.hours.toLocaleString()} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

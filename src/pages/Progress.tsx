import { useState } from 'react'
import type { Progress as P, SeriesPoint } from '../../shared/types'
import { Bars, Legend, TrendChart } from '../components/charts'
import { SERIES } from '../components/series'
import { Card, Loading, PageHeader, Segmented } from '../components/ui'
import { useApi } from '../lib/api'
import { compact, fmtTime } from '../lib/format'

type Range = 'all' | '5y' | '2y' | '1y'
const YEARS: Record<Range, number> = { all: 100, '5y': 5, '2y': 2, '1y': 1 }

export default function Progress() {
  const { data, error } = useApi<P>('/progress')
  const [range, setRange] = useState<Range>('all')
  if (!data) return <Loading error={error} />

  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - YEARS[range])
  const from = cutoff.toISOString().slice(0, 10)
  const f = (s: SeriesPoint[]) => (range === 'all' ? s : s.filter((p) => p.date >= from))
  const yearly = data.yearly.filter((y) => range === 'all' || y.year >= cutoff.getFullYear())

  return (
    <>
      <PageHeader title="Lifelong progress">
        Every metric across your whole history. Lower-is-better charts (race times, pace) are flipped so up always means
        improvement.
      </PageHeader>
      <div className="mb-4 flex justify-end">
        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { value: 'all', label: 'All time' },
            { value: '5y', label: '5 years' },
            { value: '2y', label: '2 years' },
            { value: '1y', label: '1 year' },
          ]}
        />
      </div>

      <Card title="Predicted half marathon over time" subtitle="Monthly estimate from your efforts and training at that point">
        <Legend
          items={[
            { label: 'Predicted', color: SERIES[0], shape: 'line' },
            { label: 'Actual half-marathon efforts', color: SERIES[1], shape: 'dot' },
          ]}
        />
        <TrendChart
          data={f(data.halfPrediction)}
          dots={f(data.halfRaces)}
          dotsLabel="Actual"
          label="Predicted"
          format={fmtTime}
          invert
          height={260}
        />
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Training hours per year" subtitle="By sport">
          <Legend
            items={[
              { label: 'Running', color: SERIES[0] },
              { label: 'Cycling', color: SERIES[1] },
              { label: 'Swimming', color: SERIES[2] },
              { label: 'Other', color: SERIES[3] },
            ]}
          />
          <Bars
            data={yearly}
            x="year"
            series={[
              { key: 'run', label: 'Running' },
              { key: 'bike', label: 'Cycling' },
              { key: 'swim', label: 'Swimming' },
              { key: 'other', label: 'Other' },
            ]}
            format={(v) => `${Math.round(v)} h`}
          />
        </Card>
        <Card title="Running distance per month" subtitle="km">
          <Bars data={f(data.monthlyRunKm)} x="date" series={[{ key: 'value', label: 'Running' }]} format={(v) => `${Math.round(v)}`} xFormat={(d) => d.slice(0, 7)} />
        </Card>
        <Card title="Aerobic efficiency" subtitle="Monthly median pace of easy runs (HR below 80% of max) — faster at the same effort = fitter">
          <TrendChart data={f(data.easyPace)} label="Easy pace" format={(v) => `${fmtTime(v)}`} invert />
        </Card>
        <Card title="Fitness (chronic training load)" subtitle="42-day weighted training load">
          <TrendChart data={f(data.ctl)} label="Fitness" format={(v) => `${Math.round(v)}`} domain={[0, 'auto']} />
        </Card>
        <Card title="VO₂max (Garmin)" subtitle="Monthly average from running activities">
          <TrendChart data={f(data.vo2max)} label="VO₂max" format={(v) => v.toFixed(0)} />
        </Card>
        <Card title="Resting heart rate" subtitle="Monthly average, bpm — lower is generally fitter">
          <TrendChart data={f(data.restingHr)} label="Resting HR" format={(v) => v.toFixed(0)} invert />
        </Card>
        <Card title="HRV" subtitle="Monthly average overnight HRV, ms">
          <TrendChart data={f(data.hrv)} label="HRV" format={(v) => v.toFixed(0)} />
        </Card>
        <Card title="Sleep" subtitle="Monthly average per night">
          <TrendChart data={f(data.sleepHours)} label="Sleep" format={(v) => `${Math.floor(v)}h${String(Math.round((v % 1) * 60)).padStart(2, '0')}`} />
        </Card>
        <Card title="Weight" subtitle="Monthly average, kg">
          <TrendChart data={f(data.weight)} label="Weight" format={(v) => v.toFixed(1)} />
        </Card>
        <Card title="Daily steps" subtitle="Monthly average">
          <TrendChart data={f(data.steps)} label="Steps" format={(v) => compact(Math.round(v))} />
        </Card>
      </div>
    </>
  )
}

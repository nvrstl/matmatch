// Thin wrappers over Recharts that apply the dataviz mark specs:
// 2px lines, ≤24px bars with 4px rounded data-ends, hairline grid, crosshair + tooltip.
import type { ReactNode } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fmtDate } from '../lib/format'

import { SERIES } from './series'

const axisProps = {
  stroke: 'var(--axis)',
  tickLine: false,
  axisLine: { stroke: 'var(--axis)' },
} as const

const YEAR_MS = 365.25 * 86_400_000

/** Calendar-aligned ticks: Jan 1 of each year for long spans, every few months for short ones. */
function timeTicks(from: number, to: number): number[] {
  const span = to - from
  const ticks: number[] = []
  const d = new Date(from)
  if (span > 2.5 * YEAR_MS) {
    const step = span > 6 * YEAR_MS ? 2 : 1
    for (let y = d.getUTCFullYear() + 1; Date.UTC(y, 0, 1) <= to; y += step) ticks.push(Date.UTC(y, 0, 1))
  } else {
    const step = span > YEAR_MS ? 3 : 2
    for (let m = d.getUTCMonth() + 1, y = d.getUTCFullYear(); Date.UTC(y, m, 1) <= to; m += step) ticks.push(Date.UTC(y, m, 1))
  }
  return ticks
}

const timeTickLabel = (from: number, to: number) => (t: number) =>
  to - from > 2.5 * YEAR_MS
    ? String(new Date(t).getUTCFullYear())
    : new Date(t).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })

function TooltipBox({ title, rows }: { title: string; rows: { color: string; label: string; value: string }[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-lg">
      <div className="mb-1 font-medium text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-ink-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
          <span>{r.label}</span>
          <span className="tabular ml-auto pl-3 font-medium text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export interface LineProps {
  data: { date: string; value: number }[]
  /** optional dots plotted on the same axis (e.g. actual races) */
  dots?: { date: string; value: number }[]
  dotsLabel?: string
  label: string
  format: (v: number) => string
  height?: number
  /** lower values are better (pace, time): flip the axis so "up" means improvement */
  invert?: boolean
  domain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax']
}

export function TrendChart({ data, dots, dotsLabel = 'Actual', label, format, height = 220, invert, domain }: LineProps) {
  if (!data.length && !dots?.length) return <NoData height={height} />
  // Merge into one time-indexed array so the tooltip sees both.
  const byDate = new Map<string, { t: number; date: string; value?: number; dot?: number }>()
  for (const p of data) byDate.set(p.date, { t: Date.parse(p.date), date: p.date, value: p.value })
  for (const p of dots ?? []) byDate.set(p.date, { ...(byDate.get(p.date) ?? { t: Date.parse(p.date), date: p.date }), dot: p.value })
  const rows = [...byDate.values()].sort((a, b) => a.t - b.t)
  const last = data[data.length - 1]
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 56, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={timeTicks(rows[0].t, rows[rows.length - 1].t)} tickFormatter={timeTickLabel(rows[0].t, rows[rows.length - 1].t)} {...axisProps} />
        <YAxis reversed={invert} domain={domain ?? ['auto', 'auto']} tickFormatter={format} width={56} {...axisProps} axisLine={false} />
        <Tooltip
          cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as (typeof rows)[number]
            const r = []
            if (p.value !== undefined) r.push({ color: SERIES[0], label, value: format(p.value) })
            if (p.dot !== undefined) r.push({ color: SERIES[1], label: dotsLabel, value: format(p.dot) })
            return <TooltipBox title={fmtDate(p.date)} rows={r} />
          }}
        />
        <Area dataKey="value" type="monotone" stroke="none" fill={SERIES[0]} fillOpacity={0.08} connectNulls isAnimationActive={false} baseValue={invert ? 'dataMax' : 'dataMin'} />
        <Line
          dataKey="value"
          type="monotone"
          stroke={SERIES[0]}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
          connectNulls
          isAnimationActive={false}
          label={({ x, y, index }: { x?: number | string; y?: number | string; index?: number }) =>
            last && rows[index ?? -1]?.date === last.date ? (
              <text x={Number(x) + 8} y={Number(y) + 4} fontSize={11} fill="var(--ink-2)" className="tabular">
                {format(last.value)}
              </text>
            ) : (
              <g />
            )
          }
        />
        {dots && (
          <Scatter dataKey="dot" fill={SERIES[1]} stroke="var(--surface)" strokeWidth={2} shape="circle" isAnimationActive={false} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export interface BarsProps<T extends object> {
  data: T[]
  x: keyof T & string
  series: { key: keyof T & string; label: string }[]
  format: (v: number) => string
  xFormat?: (v: string) => string
  height?: number
  highlightLast?: boolean
}

export function Bars<T extends object>({ data, x, series, format, xFormat, height = 220, highlightLast }: BarsProps<T>) {
  if (!data.length) return <NoData height={height} />
  const stacked = series.length > 1
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data as Record<string, unknown>[]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey={x as string} tickFormatter={xFormat} {...axisProps} minTickGap={16} />
        <YAxis tickFormatter={format} width={48} {...axisProps} axisLine={false} />
        <Tooltip
          cursor={{ fill: 'var(--wash)' }}
          content={({ active, payload, label: l }) =>
            active && payload?.length ? (
              <TooltipBox
                title={xFormat ? xFormat(String(l)) : String(l)}
                rows={series.map((s, i) => ({
                  color: SERIES[i],
                  label: s.label,
                  value: format(Number((payload[0].payload as Record<string, number>)[s.key] ?? 0)),
                }))}
              />
            ) : null
          }
        />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key as string}
            stackId={stacked ? 'a' : undefined}
            fill={SERIES[i]}
            maxBarSize={24}
            // 2px surface gap between stacked segments; rounded data-end only on the top segment
            stroke="var(--surface)"
            strokeWidth={stacked ? 1 : 0}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
            isAnimationActive={false}
            fillOpacity={1}
            shape={
              highlightLast && !stacked
                ? (props: unknown) => {
                    const p = props as { x: number; y: number; width: number; height: number; index: number }
                    const isLast = p.index === data.length - 1
                    return (
                      <path
                        d={roundedTop(p.x, p.y, p.width, p.height)}
                        fill={SERIES[0]}
                        fillOpacity={isLast ? 1 : 0.55}
                      />
                    )
                  }
                : undefined
            }
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function roundedTop(x: number, y: number, w: number, h: number) {
  if (h <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

export function Legend({ items }: { items: { label: string; color: string; shape?: 'line' | 'dot' | 'square' }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.shape === 'line' ? (
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: i.color }} />
          ) : (
            <span className={`inline-block h-2.5 w-2.5 ${i.shape === 'dot' ? 'rounded-full' : 'rounded-[3px]'}`} style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  )
}

function NoData({ height }: { height: number }): ReactNode {
  return (
    <div className="flex items-center justify-center text-[13px] text-muted" style={{ height }}>
      No data in this range
    </div>
  )
}

/** A single series over distance (km), e.g. pace or heart rate during one run. */
export function DistanceChart({ data, label, format, invert, height = 170, color = SERIES[0] }: {
  data: { km: number; value: number | null }[]
  label: string
  format: (v: number) => string
  invert?: boolean
  height?: number
  color?: string
}) {
  const pts = data.filter((p) => p.value !== null)
  if (pts.length < 2) return <NoData height={height} />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="km" type="number" domain={[0, 'dataMax']} tickFormatter={(v) => `${Math.round(v)}`} {...axisProps} unit=" km" minTickGap={24} />
        <YAxis reversed={invert} domain={['auto', 'auto']} tickFormatter={format} width={48} {...axisProps} axisLine={false} />
        <Tooltip
          cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as { km: number; value: number | null }
            return p.value === null ? null : <TooltipBox title={`${p.km.toFixed(2)} km`} rows={[{ color, label, value: format(p.value) }]} />
          }}
        />
        <Line dataKey="value" type="monotone" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** The route's shape as a line, projected so it isn't squashed away from the equator. */
export function RouteSketch({ route, height = 220 }: { route: [number, number][]; height?: number }) {
  if (route.length < 2) return null
  const lat0 = route.reduce((s, p) => s + p[0], 0) / route.length
  const k = Math.cos((lat0 * Math.PI) / 180)
  const xs = route.map((p) => p[1] * k)
  const ys = route.map((p) => -p[0])
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const w = 400
  const pad = 12
  const scale = Math.min((w - 2 * pad) / (maxX - minX || 1), (height - 2 * pad) / (maxY - minY || 1))
  const pts = xs.map((x, i) => [pad + (x - minX) * scale + ((w - 2 * pad) - (maxX - minX) * scale) / 2, pad + (ys[i] - minY) * scale + ((height - 2 * pad) - (maxY - minY) * scale) / 2])
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const [s, e] = [pts[0], pts[pts.length - 1]]
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label="Route shape">
      <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={s[0]} cy={s[1]} r={6} fill="var(--color-good)" stroke="var(--surface)" strokeWidth={2} />
      <circle cx={e[0]} cy={e[1]} r={6} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />
    </svg>
  )
}

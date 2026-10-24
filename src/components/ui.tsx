import type { ReactNode } from 'react'

export function Card({ title, subtitle, action, children, className = '' }: {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-2">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, sub, delta }: {
  label: string
  value: ReactNode
  sub?: ReactNode
  delta?: { text: string; good: boolean | null }
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {(sub || delta) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
          {delta && (
            <span
              className="font-medium"
              style={{ color: delta.good === null ? 'var(--ink-2)' : delta.good ? 'var(--good-text)' : 'var(--color-critical)' }}
            >
              {delta.text}
            </span>
          )}
          {sub}
        </div>
      )}
    </div>
  )
}

const STATUS: Record<string, { color: string; icon: string }> = {
  good: { color: 'var(--color-good)', icon: '●' },
  caution: { color: 'var(--color-warning)', icon: '▲' },
  bad: { color: 'var(--color-critical)', icon: '■' },
  recover: { color: 'var(--color-critical)', icon: '■' },
  neutral: { color: 'var(--muted)', icon: '○' },
  unknown: { color: 'var(--muted)', icon: '○' },
  high: { color: 'var(--color-good)', icon: '●' },
  medium: { color: 'var(--color-warning)', icon: '▲' },
  low: { color: 'var(--color-serious)', icon: '■' },
}

/** Status is never color alone: icon + label. */
export function StatusPill({ state, label }: { state: string; label: string }) {
  const s = STATUS[state] ?? STATUS.neutral
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[12px] text-ink-2">
      <span aria-hidden style={{ color: s.color, fontSize: 9 }}>{s.icon}</span>
      {label}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-ink-2">{children}</div>
}

export function Loading({ error }: { error?: string | null }) {
  return error ? (
    <Empty>
      <span style={{ color: 'var(--color-critical)' }}>{error}</span>
    </Empty>
  ) : (
    <div className="animate-pulse p-8 text-sm text-muted">Loading…</div>
  )
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children && <p className="mt-1 max-w-2xl text-sm text-ink-2">{children}</p>}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-[13px]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 transition ${o.value === value ? 'bg-[var(--wash)] font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const inputCls =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent'
export const buttonCls =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50'

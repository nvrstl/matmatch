import type { ReactNode } from 'react'
import { initials } from '../lib/format'
import { STATUS_LABELS, STATUS_STYLES } from '../lib/constants'

export function Avatar({
  name,
  url,
  size = 48,
}: {
  name: string
  url?: string | null
  size?: number
}) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        style={{ width: size, height: size }}
        className="rounded-full object-cover"
      />
    )
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.34 }}
      className="flex items-center justify-center rounded-full bg-moss-400/20 font-semibold text-moss-600"
    >
      {initials(name) || '🧘'}
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
        STATUS_STYLES[status] ?? 'bg-sand-200 text-ink-700'
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

/** Toggleable chip group for multi-select fields (styles, languages). */
export function ChipSelect({
  options,
  selected,
  onToggle,
}: {
  options: readonly string[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt)
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? 'border-clay-500 bg-clay-500 text-white'
                : 'border-sand-200 bg-white text-ink-700 hover:bg-sand-100'
            }`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-ink-700/60">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-clay-400 border-t-transparent" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}

export function EmptyState({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="text-3xl">🧘</span>
      <h3 className="text-lg font-semibold text-ink-900">{title}</h3>
      {children && <p className="max-w-sm text-sm text-ink-700/70">{children}</p>}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-700/50">{hint}</span>}
    </label>
  )
}

/** 'HH:MM:SS' or 'HH:MM' -> 'HH:MM' */
export function shortTime(t: string): string {
  return t.slice(0, 5)
}

/** 'YYYY-MM-DD' -> e.g. 'di 9 jun 2026' (nl-BE) */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('nl-BE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatRate(rate: number | null | undefined): string {
  if (rate == null) return 'In overleg'
  return `€${Number(rate).toFixed(0)}`
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/** Today as 'YYYY-MM-DD' in local time, for date input min values. */
export function todayISO(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

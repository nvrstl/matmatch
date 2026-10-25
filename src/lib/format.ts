export function fmtTime(s: number): string {
  const r = Math.round(s)
  const h = Math.floor(r / 3600)
  const m = Math.floor((r % 3600) / 60)
  const sec = r % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export const fmtPace = (secPerKm: number) => `${fmtTime(secPerKm)}/km`

export const fmtKm = (km: number, digits = 0) =>
  km.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })

export const compact = (n: number) =>
  n.toLocaleString(undefined, { notation: n >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 })

export const fmtDate = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, opts)

export const SPORT_LABEL: Record<string, string> = {
  run: 'Running',
  bike: 'Cycling',
  swim: 'Swimming',
  walk: 'Walking & hiking',
  strength: 'Strength & cardio',
  other: 'Other',
}

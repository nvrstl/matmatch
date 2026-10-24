// Calendar-date helpers on plain 'yyyy-mm-dd' strings (UTC arithmetic, no timezone drift).

const DAY = 86_400_000

export const toDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`)
export const iso = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (s: string, n: number) => iso(new Date(toDate(s).getTime() + n * DAY))
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY)

/** Monday of the week containing `s`. */
export const weekStart = (s: string) => addDays(s, -((toDate(s).getUTCDay() + 6) % 7))

/** 0 = Monday … 6 = Sunday */
export const weekdayIndex = (s: string) => (toDate(s).getUTCDay() + 6) % 7

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

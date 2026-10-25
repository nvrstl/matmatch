// Reading a time or pace typed on a phone, where the number keypad has no ":" key.
//   "3:56", "3.56", "3,56", "356"   → 3:56 (pace)
//   "1:22:59", "1.22.59", "12259"   → 1:22:59
//   "125" for a half → 1:25:00, "310" for a marathon → 3:10:00, "40" for a 10K → 40:00
// Digits alone are ambiguous, so each reading is checked for a plausible pace for the distance.

export function parseTimeInput(text: string, opts: { kind: 'time' | 'pace'; meters?: number }): number | null {
  const t = text.trim().replace(/[.,;:'"\s]+/g, ':').replace(/^:+|:+$/g, '')
  if (!t) return null
  const plausible = (s: number) => {
    const pace = opts.kind === 'pace' ? s : opts.meters ? s / (opts.meters / 1000) : null
    return s > 0 && (pace === null || (pace >= 150 && pace <= 900))
  }

  if (t.includes(':')) {
    const parts = t.split(':')
    if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null
    const nums = parts.map(Number)
    if (nums.slice(1).some((n) => n >= 60)) return null
    const s = nums.reduce((acc, n) => acc * 60 + n, 0)
    return plausible(s) ? s : null
  }
  if (!/^\d{1,7}$/.test(t)) return null

  const readings: number[] = []
  // h:mm:ss / m:ss, the last two digits being seconds
  if (t.length >= 3) {
    const ss = Number(t.slice(-2))
    const rest = t.slice(0, -2)
    const mm = Number(rest.slice(-2))
    const hh = Number(rest.slice(0, -2) || 0)
    if (ss < 60 && (rest.length <= 2 || mm < 60)) readings.push(hh * 3600 + mm * 60 + ss)
  }
  // h:mm, for finish times ("125" → 1:25:00)
  if (opts.kind === 'time' && t.length >= 2 && t.length <= 3) {
    const mm = Number(t.slice(-2))
    const hh = Number(t.slice(0, -2) || 0)
    if (hh > 0 && mm < 60) readings.push(hh * 3600 + mm * 60)
  }
  // whole minutes ("4" → 4:00/km, "40" → 40:00)
  readings.push(Number(t) * 60)
  return readings.find(plausible) ?? null
}

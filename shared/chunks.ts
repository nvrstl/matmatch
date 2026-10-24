import { addDays } from './dates.js'

/** Split [from, to] into consecutive inclusive chunks of at most `days` days. */
export function chunks(from: string, to: string, days: number): [string, string][] {
  const out: [string, string][] = []
  for (let start = from; start <= to; start = addDays(start, days)) {
    const end = addDays(start, days - 1)
    out.push([start, end < to ? end : to])
  }
  return out
}

import { addDays, daysBetween } from '../dates'
import type { LoadPoint, Readiness } from '../types'
import type { DailyRow, HrvRow, SleepRow } from '../dataset'

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function readiness(
  asOf: string,
  daily: DailyRow[],
  hrv: HrvRow[],
  sleep: SleepRow[],
  load: LoadPoint | null,
): Readiness {
  const signals: Readiness['signals'] = []
  const inWindow = (d: string, from: number, to: number) => {
    const age = daysBetween(d, asOf)
    return age >= from && age < to
  }

  const rhr7 = mean(daily.filter((r) => r.resting_hr && inWindow(r.date, 0, 7)).map((r) => r.resting_hr!))
  const rhrBase = mean(daily.filter((r) => r.resting_hr && inWindow(r.date, 7, 67)).map((r) => r.resting_hr!))
  if (rhr7 && rhrBase) {
    const diff = rhr7 - rhrBase
    signals.push({
      label: 'Resting HR (7d vs baseline)',
      value: `${rhr7.toFixed(0)} bpm (${diff >= 0 ? '+' : ''}${diff.toFixed(1)})`,
      state: diff >= 5 ? 'bad' : diff >= 3 ? 'caution' : 'good',
    })
  }

  const recentHrv = hrv.filter((h) => h.status && inWindow(h.date, 0, 7))
  if (recentHrv.length) {
    const latest = recentHrv[recentHrv.length - 1]
    const lowDays = recentHrv.filter((h) => /LOW|POOR/i.test(h.status!)).length
    const unbalanced = recentHrv.filter((h) => /UNBALANCED/i.test(h.status!)).length
    signals.push({
      label: 'HRV status',
      value: `${latest.status!.toLowerCase()}${latest.last_night ? ` · ${latest.last_night} ms` : ''}`,
      state: lowDays >= 2 ? 'bad' : unbalanced >= 3 || lowDays === 1 ? 'caution' : 'good',
    })
  }

  const sleepH = mean(sleep.filter((s) => s.total_s && inWindow(s.date, 0, 7)).map((s) => s.total_s! / 3600))
  if (sleepH) {
    signals.push({
      label: 'Sleep (7-day avg)',
      value: `${Math.floor(sleepH)}h ${String(Math.round((sleepH % 1) * 60)).padStart(2, '0')}m`,
      state: sleepH < 6 ? 'bad' : sleepH < 7 ? 'caution' : 'good',
    })
  }

  if (load && load.date >= addDays(asOf, -1)) {
    signals.push({
      label: 'Form (fitness − fatigue)',
      value: load.tsb.toFixed(0),
      state: load.tsb < -30 ? 'bad' : load.tsb < -15 ? 'caution' : 'good',
    })
  }

  if (!signals.length) return { status: 'unknown', signals }
  const bad = signals.filter((s) => s.state === 'bad').length
  const caution = signals.filter((s) => s.state === 'caution').length
  return { status: bad ? 'recover' : caution >= 2 ? 'caution' : 'good', signals }
}

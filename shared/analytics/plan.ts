// Next-week training recommendation, built around improving half-marathon performance.
//
// Volume: progress ~8 %/week from your recent average, with a down week after three rising weeks,
// holds when readiness signals are mixed and cuts back when they're poor.
// Structure: one long run, a threshold session (the key HM workout) and — volume permitting —
// a second quality day whose content depends on the phase relative to your goal race.
import { addDays, daysBetween, toDate, WEEKDAYS, weekStart, weekdayIndex } from '../dates'
import type { Activity, Paces, PlanDay, Readiness, Settings, WeekPlan } from '../types'
import { fmtTime } from './predict'
import { weeklyRunKm } from './load'
import { paceAt, timeFor } from '../vdot'

const HALF = 21097.5

export function pacesFor(vdot: number, goalHalfSeconds: number | null): Paces {
  return {
    easy: [paceAt(vdot, 0.72), paceAt(vdot, 0.62)],
    marathon: timeFor(vdot, 42195) / 42.195,
    half: (goalHalfSeconds ?? timeFor(vdot, HALF)) / (HALF / 1000),
    threshold: paceAt(vdot, 0.88),
    interval: paceAt(vdot, 0.975),
    repetition: paceAt(vdot, 1.06),
  }
}

export const fmtPace = (secPerKm: number) => `${fmtTime(secPerKm)}/km`

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const round1 = (x: number) => Math.round(x * 2) / 2 // to 0.5 km

function phaseFor(planStart: string, s: Settings): WeekPlan['phase'] {
  if (!s.goalRaceDate) return 'build'
  const d = daysBetween(planStart, s.goalRaceDate)
  if (d < -7) return 'build'
  if (d < 0) return 'recovery' // race happened last week
  if (d < 7) return 'race'
  const weeksOut = Math.floor(d / 7)
  if (weeksOut === 1) return 'taper'
  if (weeksOut <= 4) return 'specific'
  if (weeksOut <= 12) return 'build'
  return 'base'
}

/** Pick which weekdays to run, keeping hard days apart from the long run. */
export function chooseDays(s: Settings, runDays: number) {
  const L = s.longRunDay
  const preferredRest = new Set(s.restDays.filter((d) => d !== L))
  const order = [1, 2, 3, 4, 5, 6].map((o) => (L + o) % 7) // days after the long run, in order
  // Quality days: ~2 and ~4 days after the long run (e.g. Tue/Thu for a Sunday long run).
  const pick = (target: number, taken: number[]) => {
    const cands = [target, (target + 1) % 7, (target + 6) % 7, (target + 2) % 7]
    return cands.find((d) => d !== L && !taken.includes(d) && !preferredRest.has(d) && (d + 1) % 7 !== L) ?? null
  }
  const q1 = pick((L + 2) % 7, [])
  const q2 = q1 === null ? null : pick((L + 4) % 7, [q1, (q1 + 1) % 7, (q1 + 6) % 7])
  const run = new Set<number>([L])
  if (q1 !== null) run.add(q1)
  if (q2 !== null && runDays >= 4) run.add(q2)
  for (const d of order) if (run.size < runDays && !preferredRest.has(d)) run.add(d)
  for (const d of order) if (run.size < runDays) run.add(d) // not enough non-rest days: use rest days too
  return { long: L, q1, q2: runDays >= 4 ? q2 : null, run: [...run].sort() }
}

export interface PlanInputs {
  acts: Activity[]
  settings: Settings
  vdot: number | null
  predictedHalfSeconds: number | null
  readiness: Readiness
  today: string
}

export function planNextWeek({ acts, settings, vdot, predictedHalfSeconds, readiness, today }: PlanInputs): WeekPlan {
  const planStart = weekdayIndex(today) === 0 ? today : addDays(weekStart(today), 7)
  const lastComplete = addDays(weekStart(today), -1)
  const completed = weeklyRunKm(acts, lastComplete, 4)
  const current = weeklyRunKm(acts, today, 1)[0]
  const recentWeeksKm = planStart === today ? completed : [...completed.slice(1), current]

  const last3 = completed.slice(-3).map((w) => w.km)
  const avg3 = last3.reduce((a, b) => a + b, 0) / last3.length
  const maxRecent = Math.max(...completed.map((w) => w.km))
  // Planning mid-week: if this week is already far below average, it is the down week.
  const easingAlready = planStart !== today && current.km < avg3 * 0.6
  const rising = !easingAlready && last3.length === 3 && last3[1] > last3[0] * 1.02 && last3[2] > last3[1] * 1.02
  const effectiveVdot = vdot ?? 40
  const goal = settings.goalHalfSeconds
  const paces = pacesFor(effectiveVdot, goal)

  let phase = phaseFor(planStart, settings)
  const rationale: string[] = []
  const base = avg3 >= 5 ? avg3 : 15
  if (avg3 < 5) rationale.push('Little recent running, so the week starts from a conservative 15 km.')

  let target: number
  if (phase === 'race') {
    target = base * 0.55
    rationale.push(`Race week: volume drops to ~55 % so you start ${settings.goalRaceDate} fresh.`)
  } else if (phase === 'taper') {
    target = base * 0.75
    rationale.push('One week to go: volume down ~25 %, intensity kept so the legs stay sharp.')
  } else if (phase === 'recovery' || readiness.status === 'recover') {
    target = base * 0.7
    phase = 'recovery'
    rationale.push(
      readiness.status === 'recover'
        ? 'Recovery signals are poor (see readiness), so this is a lighter week with no hard intervals.'
        : 'Post-race week: easy running only while you recover.',
    )
  } else if (rising) {
    target = base * 0.8
    phase = 'recovery'
    rationale.push('Three rising weeks in a row: take a down week (~80 %) to absorb the work, then build again.')
  } else if (readiness.status === 'caution') {
    target = Math.max(base, completed[completed.length - 1]?.km ?? 0)
    rationale.push('Readiness is mixed, so volume holds steady this week instead of increasing.')
  } else {
    target = Math.min(base * 1.08, Math.max(maxRecent, base) * 1.1)
    rationale.push(`Volume builds ~8 % on your recent ${avg3.toFixed(0)} km/week average (staying within 10 % of your biggest recent week).`)
  }
  if (settings.maxWeeklyKm && target > settings.maxWeeklyKm) {
    target = settings.maxWeeklyKm
    rationale.push(`Capped at your ${settings.maxWeeklyKm} km/week maximum.`)
  }
  target = Math.max(10, Math.round(target))

  // Fewer, longer runs at low volume: aim for easy runs of at least ~6 km.
  const runDays = clamp(Math.min(settings.runDaysPerWeek, Math.floor(target / 6)), 3, 7)
  if (runDays < settings.runDaysPerWeek) {
    rationale.push(`${runDays} runs instead of ${settings.runDaysPerWeek}: at ${target} km, fewer and longer runs build more endurance than many short ones.`)
  }
  const { long, q1, q2, run } = chooseDays(settings, runDays)
  const easyRange = `${fmtPace(paces.easy[0])}–${fmtPace(paces.easy[1])}`
  const wuCd = target >= 35 ? 5 : 4 // warm-up + cool-down km around a session

  // ---- Long run --------------------------------------------------------------------
  const longCap = phase === 'base' ? 18 : phase === 'taper' ? 15 : phase === 'recovery' ? 14 : 22
  // ~30 % of the week, and always clearly the longest run (matters at low volume with few runs).
  const longKm = round1(clamp(Math.max(target * 0.3, (target / runDays) * 1.4), 6, longCap))
  const isoWeek = Math.floor(daysBetween('2024-01-01', planStart) / 7)
  const hmFinish = (phase === 'build' || phase === 'specific') && isoWeek % 2 === 0 && longKm >= 14
  const longDay: Omit<PlanDay, 'date' | 'weekday'> = hmFinish
    ? {
        kind: 'long',
        title: `Long run ${longKm} km with HM-pace finish`,
        km: longKm,
        details: `${longKm - 4} km easy (${easyRange}), then the last 4 km at half-marathon pace ${fmtPace(paces.half)}. Practise your race fuelling.`,
      }
    : {
        kind: 'long',
        title: `Long run ${longKm} km`,
        km: longKm,
        details: `Relaxed and conversational, ${easyRange}. The last 15 min may drift toward ${fmtPace(paces.marathon)} if you feel good.`,
      }

  // ---- Quality sessions ------------------------------------------------------------
  const tKm = clamp(target * 0.1, 4, 10)
  const tMin = Math.round((tKm * paces.threshold) / 60 / 5) * 5 || 15
  const tReps = tMin >= 30 ? 3 : 2
  const tEach = Math.max(6, Math.round(tMin / tReps / 2) * 2) // even minutes reads cleaner
  const threshold = (): Omit<PlanDay, 'date' | 'weekday'> => ({
    kind: 'threshold',
    title: `Threshold: ${tReps} × ${tEach} min`,
    km: round1(wuCd + tKm + 0.4 * (tReps - 1)),
    details: `Warm up 2 km easy. ${tReps} × ${tEach} min at ${fmtPace(paces.threshold)} with 2 min easy jog between. Cool down 2 km. Threshold work is the biggest lever for your half marathon.`,
  })
  const halfPace = (): Omit<PlanDay, 'date' | 'weekday'> => {
    const workKm = clamp(Math.round(target * 0.15), 6, 12)
    const reps = workKm >= 9 ? 3 : 2
    const each = round1(workKm / reps)
    return {
      kind: 'halfPace',
      title: `Half-marathon pace: ${reps} × ${each} km`,
      km: round1(wuCd + reps * each + 0.8 * (reps - 1)),
      details: `Warm up 2 km. ${reps} × ${each} km at ${fmtPace(paces.half)} (${goal ? 'goal' : 'predicted'} HM pace), 3 min easy jog between. Cool down 2 km. Lock in the rhythm you'll race at.`,
    }
  }
  const intervals = (): Omit<PlanDay, 'date' | 'weekday'> => {
    const reps = clamp(Math.round(target * 0.06), 4, 6)
    return {
      kind: 'intervals',
      title: `VO₂max intervals: ${reps} × 1000 m`,
      km: round1(wuCd + reps + reps * 0.4),
      details: `Warm up 2 km + 4 strides. ${reps} × 1000 m at ${fmtPace(paces.interval)}, 2–3 min jog between. Cool down 2 km.`,
    }
  }
  const strides = (km: number): Omit<PlanDay, 'date' | 'weekday'> => ({
    kind: 'strides',
    title: `Easy ${km} km + strides`,
    km,
    details: `Easy ${easyRange}, then 6 × 20 s relaxed strides (~${fmtPace(paces.repetition)}) with full recovery.`,
  })

  const sessions = new Map<number, Omit<PlanDay, 'date' | 'weekday'>>()
  sessions.set(long, longDay)
  switch (phase) {
    case 'base':
      if (q1 !== null) sessions.set(q1, strides(round1(clamp(target * 0.14, 5, 10))))
      if (q2 !== null) sessions.set(q2, { ...threshold(), title: `Tempo: ${tReps} × ${tEach} min` })
      break
    case 'build':
      if (q1 !== null) sessions.set(q1, threshold())
      if (q2 !== null) sessions.set(q2, intervals())
      break
    case 'specific':
      if (q1 !== null) sessions.set(q1, threshold())
      if (q2 !== null) sessions.set(q2, halfPace())
      break
    case 'taper':
      if (q1 !== null) sessions.set(q1, { ...halfPace(), title: 'Sharpener: 3 × 2 km @ HM pace', km: wuCd + 6.6, details: `Warm up 2 km. 3 × 2 km at ${fmtPace(paces.half)}, 2 min jog. Cool down 2 km. Should feel controlled.` })
      if (q2 !== null) sessions.set(q2, strides(6))
      break
    case 'recovery':
      if (q1 !== null) sessions.set(q1, strides(round1(clamp(target * 0.15, 4, 8))))
      break
    case 'race': {
      const raceIdx = weekdayIndex(settings.goalRaceDate!)
      sessions.clear()
      sessions.set(raceIdx, {
        kind: 'race',
        title: 'Race day — half marathon',
        km: 21.1 + 3,
        details: `Target ${fmtPace(paces.half)} → ${fmtTime(paces.half * (HALF / 1000))}. Even pacing: first 5 km no faster than goal pace, push from 15 km. 2 km jog + strides beforehand.`,
      })
      const sharpen = (raceIdx + 3) % 7
      if (sharpen < raceIdx) sessions.set(sharpen, { ...halfPace(), title: 'Tune-up: 2 × 2 km @ HM pace', km: wuCd + 4, details: `Warm up 2 km. 2 × 2 km at ${fmtPace(paces.half)}, 3 min jog. Cool down.` })
      const shake = raceIdx - 1
      if (shake >= 0) sessions.set(shake, strides(4))
      break
    }
  }

  // ---- Fill the remaining run days with easy running --------------------------------
  const runSet = new Set(phase === 'race' ? [...run.filter((d) => d < weekdayIndex(settings.goalRaceDate!) - 1 || sessions.has(d))] : run)
  for (const d of sessions.keys()) runSet.add(d)
  const easyDays = [...runSet].filter((d) => !sessions.has(d))
  const fixedKm = [...sessions.values()].reduce((a, s) => a + s.km, 0)
  const per = easyDays.length ? clamp(round1((target - fixedKm) / easyDays.length), 4, 16) : 0
  for (const d of easyDays) {
    sessions.set(d, {
      kind: 'easy',
      title: `Easy ${per} km`,
      km: per,
      details: `Conversational pace, ${easyRange}. ${d === (long + 1) % 7 ? 'Recovery run after the long run — keep it very easy.' : ''}`.trim(),
    })
  }

  const days: PlanDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(planStart, i)
    const s = sessions.get(i) ?? { kind: 'rest' as const, title: 'Rest', km: 0, details: 'Rest or light mobility. Recovery is when the adaptation happens.' }
    return { date, weekday: WEEKDAYS[i], ...s }
  })
  const plannedKm = Math.round(days.reduce((a, d) => a + d.km, 0))

  // ---- Explain the goal gap ---------------------------------------------------------
  if (goal && predictedHalfSeconds) {
    const gap = predictedHalfSeconds - goal
    rationale.push(
      gap > 0
        ? `Your goal ${fmtTime(goal)} is ${fmtTime(gap)} faster than today's prediction (${fmtTime(predictedHalfSeconds)}). HM-pace work uses the goal pace; threshold and easy paces use current fitness so you don't overcook it.`
        : `Current fitness already predicts ${fmtTime(predictedHalfSeconds)} — ahead of your ${fmtTime(goal)} goal. Consider a faster target.`,
    )
  } else if (predictedHalfSeconds) {
    rationale.push(`Paces come from your current fitness (predicted half marathon ${fmtTime(predictedHalfSeconds)}). Set a goal time to train at goal pace.`)
  }
  if (!vdot) rationale.push('No fitness estimate yet — paces are generic until you sync some outdoor runs.')
  if (settings.goalRaceDate && phase !== 'race' && phase !== 'recovery') {
    const weeks = Math.ceil(daysBetween(planStart, settings.goalRaceDate) / 7)
    rationale.push(`${weeks} weeks to your race on ${toDate(settings.goalRaceDate).toDateString()} — ${phase} phase.`)
  }

  return {
    weekStart: planStart,
    phase,
    targetKm: plannedKm,
    recentWeeksKm,
    paces,
    goalHalfSeconds: goal,
    predictedHalfSeconds,
    days,
    rationale,
    readiness,
  }
}

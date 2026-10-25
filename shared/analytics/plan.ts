// Training plans for a goal race (5K, 10K, half or marathon) on a date: a week-by-week block from
// this week to race day, plus an estimate of how realistic the target time is.
//
// Volume: the first weeks follow your recent running (≈8 % up, a down week after three rising
// weeks, holding or cutting back when readiness is mixed or poor). Later weeks are projected:
// +7 %/week toward a peak that suits the distance, every 4th week easier, then a taper.
// Structure: one long run and up to two quality days whose content depends on the distance and
// on the phase (base → build → race-specific → taper → race week). Race-pace work uses your
// target pace; threshold, interval and easy paces come from current fitness.
import { addDays, daysBetween, toDate, WEEKDAYS, weekStart, weekdayIndex } from '../dates'
import type {
  Activity,
  Paces,
  PlanDay,
  Prediction,
  RaceKey,
  Readiness,
  Realism,
  Settings,
  TrainingBlock,
  WeekPlan,
} from '../types'
import { RACES } from '../types'
import { paceAt, timeFor, vdotFor } from '../vdot'
import { weeklyRunKm } from './load'
import { endurancePenalty, fmtTime } from './predict'

type Phase = WeekPlan['phase']
type Session = Omit<PlanDay, 'date' | 'weekday'>

const METERS: Record<RaceKey, number> = Object.fromEntries(RACES.map((r) => [r.key, r.meters])) as Record<RaceKey, number>
const LABEL: Record<RaceKey, string> = { '5k': '5K', '10k': '10K', half: 'half marathon', marathon: 'marathon' }

/** Per distance: longest long run, peak-volume floor, phase lengths (weeks out) and minimum build. */
const RACE_PROFILE: Record<RaceKey, { longCap: number; peakFloor: number; peakGrowth: number; taperWeeks: number; specificWeeks: number; buildWeeks: number; minWeeks: number }> = {
  '5k': { longCap: 14, peakFloor: 25, peakGrowth: 1.15, taperWeeks: 1, specificWeeks: 3, buildWeeks: 10, minWeeks: 4 },
  '10k': { longCap: 16, peakFloor: 30, peakGrowth: 1.2, taperWeeks: 1, specificWeeks: 4, buildWeeks: 10, minWeeks: 6 },
  half: { longCap: 22, peakFloor: 40, peakGrowth: 1.25, taperWeeks: 1, specificWeeks: 5, buildWeeks: 12, minWeeks: 8 },
  marathon: { longCap: 32, peakFloor: 55, peakGrowth: 1.3, taperWeeks: 2, specificWeeks: 6, buildWeeks: 14, minWeeks: 12 },
}

/** How hard a plan pushes. Balanced is the default; aggressive suits experienced runners returning to known volume. */
export const STYLE = {
  conservative: { firstStep: 1.05, grow: 1.05, rebuild: 1.08, downEvery: 3, downTo: 0.75, peakMul: 0.95, skipRisingDown: false, qualityRoom: 0.75, longBonus: 0, raceWork: 0.85, gainMul: 0.85 },
  balanced: { firstStep: 1.08, grow: 1.07, rebuild: 1.12, downEvery: 4, downTo: 0.8, peakMul: 1, skipRisingDown: false, qualityRoom: 0.8, longBonus: 0, raceWork: 1, gainMul: 1 },
  aggressive: { firstStep: 1.12, grow: 1.1, rebuild: 1.18, downEvery: 4, downTo: 0.85, peakMul: 1.15, skipRisingDown: true, qualityRoom: 0.92, longBonus: 0.03, raceWork: 1.25, gainMul: 1.12 },
} as const

export function pacesFor(vdot: number, race: RaceKey = 'half', goalSeconds: number | null = null): Paces {
  const racePace = (goalSeconds ?? timeFor(vdot, METERS[race])) / (METERS[race] / 1000)
  return {
    easy: [paceAt(vdot, 0.72), paceAt(vdot, 0.62)],
    marathon: race === 'marathon' ? racePace : timeFor(vdot, 42195) / 42.195,
    half: race === 'half' ? racePace : timeFor(vdot, 21097.5) / 21.0975,
    race: racePace,
    threshold: paceAt(vdot, 0.88),
    interval: paceAt(vdot, 0.975),
    repetition: paceAt(vdot, 1.06),
  }
}

export const fmtPace = (secPerKm: number) => `${fmtTime(secPerKm)}/km`

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const round1 = (x: number) => Math.round(x * 2) / 2 // to 0.5 km

export function phaseFor(planStart: string, s: Settings): Phase {
  if (!s.goalRaceDate) return 'build'
  const d = daysBetween(planStart, s.goalRaceDate)
  if (d < -7) return 'build'
  if (d < 0) return 'recovery' // race happened last week
  if (d < 7) return 'race'
  const weeksOut = Math.floor(d / 7)
  const p = RACE_PROFILE[s.goalRace]
  if (weeksOut <= p.taperWeeks) return 'taper'
  if (weeksOut <= p.taperWeeks + p.specificWeeks) return 'specific'
  if (weeksOut <= p.buildWeeks) return 'build'
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

// ---------------------------------------------------------------------------
// One week's sessions

interface WeekSpec {
  planStart: string
  phase: Phase
  target: number // km
  settings: Settings
  paces: Paces
  /** alternate long-run flavours from week to week */
  weekNo: number
}

function buildDays({ planStart, phase, target, settings, paces, weekNo }: WeekSpec): { days: PlanDay[]; notes: string[] } {
  const race = settings.goalRace
  const prof = RACE_PROFILE[race]
  const notes: string[] = []
  // Fewer, longer runs at low volume: aim for easy runs of at least ~6 km.
  const runDays = clamp(Math.min(settings.runDaysPerWeek, Math.floor(target / 6)), 3, 7)
  if (runDays < settings.runDaysPerWeek) {
    notes.push(`${runDays} runs instead of ${settings.runDaysPerWeek}: at ${target} km, fewer and longer runs build more endurance than many short ones.`)
  }
  const { long, q1, q2, run } = chooseDays(settings, runDays)
  const easyRange = `${fmtPace(paces.easy[0])}–${fmtPace(paces.easy[1])}`
  const wuCd = target >= 35 ? 5 : 4 // warm-up + cool-down km around a session
  const raceName = LABEL[race]
  const goalPace = fmtPace(paces.race)

  // ---- Long run --------------------------------------------------------------------
  const longCap =
    phase === 'base' ? prof.longCap * 0.8 : phase === 'taper' ? Math.min(prof.longCap * 0.65, 18) : phase === 'recovery' ? Math.min(14, prof.longCap) : prof.longCap
  const style = STYLE[settings.planStyle ?? 'balanced']
  const share = (race === 'marathon' ? 0.42 : race === 'half' ? 0.33 : 0.3) + style.longBonus
  // Race-specific weeks need long runs that match the distance, whatever the weekly total:
  // marathoners top out around 28–32 km, half marathoners around 18–22 km.
  const specificFloor = phase === 'specific' ? { '5k': 0, '10k': 12, half: 16, marathon: 24 }[race] : phase === 'build' ? { '5k': 0, '10k': 10, half: 14, marathon: 18 }[race] : 0
  // ~30 % of the week, and always clearly the longest run (matters at low volume with few runs).
  const longKm = round1(clamp(Math.max(target * share, (target / runDays) * 1.4, Math.min(specificFloor, target * 0.5)), 6, longCap))
  const finishKm = race === 'marathon' ? clamp(round1(longKm * 0.35), 4, 12) : 4
  const paceFinish = (phase === 'build' || phase === 'specific') && weekNo % 2 === 0 && longKm >= 12 && race !== '5k'
  const finishPace = race === 'marathon' || race === 'half' ? paces.race : paces.marathon
  const longDay: Session = paceFinish
    ? {
        kind: 'long',
        title: `Long run ${longKm} km, last ${finishKm} km at ${race === 'marathon' || race === 'half' ? 'race' : 'marathon'} pace`,
        km: longKm,
        targetPace: finishPace,
        details: `${longKm - finishKm} km easy (${easyRange}), then ${finishKm} km at ${fmtPace(finishPace)}. Practise your race-day fuelling.`,
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
  const threshold = (title = `Threshold: ${tReps} × ${tEach} min`): Session => ({
    kind: 'threshold',
    title,
    km: round1(wuCd + tKm + 0.4 * (tReps - 1)),
    targetPace: paces.threshold,
    details: `Warm up 2 km easy. ${tReps} × ${tEach} min at ${fmtPace(paces.threshold)} with 2 min easy jog between. Cool down 2 km. Comfortably hard: you could say a few words, not chat.`,
  })
  const intervals = (): Session => {
    const reps = clamp(Math.round(target * 0.06), 4, 6)
    return {
      kind: 'intervals',
      title: `VO₂max intervals: ${reps} × 1000 m`,
      km: round1(wuCd + reps + reps * 0.4),
      targetPace: paces.interval,
      details: `Warm up 2 km + 4 strides. ${reps} × 1000 m at ${fmtPace(paces.interval)}, 2–3 min jog between. Cool down 2 km.`,
    }
  }
  const reps400 = (): Session => {
    const n = clamp(Math.round(target / 4), 6, 12)
    return {
      kind: 'intervals',
      title: `Speed: ${n} × 400 m`,
      km: round1(wuCd + n * 0.4 + n * 0.2),
      targetPace: paces.repetition,
      details: `Warm up 2 km + strides. ${n} × 400 m at ${fmtPace(paces.repetition)} with 400 m easy jog. Smooth and fast, not a sprint.`,
    }
  }
  /** The goal-pace session: rep length and volume depend on the race. */
  const racePace = (scale = 1): Session => {
    const spec: Record<RaceKey, { reps: number; each: number; rest: string }> = {
      '5k': { reps: 5, each: 1, rest: '2–3 min jog' },
      '10k': { reps: target >= 40 ? 5 : 4, each: 2, rest: '90 s jog' },
      half: { reps: target >= 45 ? 3 : 2, each: round1(clamp(target * 0.15, 6, 12) / (target >= 45 ? 3 : 2)), rest: '3 min easy' },
      marathon: { reps: 2, each: round1(clamp(target * 0.2, 8, 16) / 2), rest: '3 min easy' },
    }
    const s = spec[race]
    const reps = Math.max(1, Math.round(s.reps * scale * style.raceWork))
    return {
      kind: 'racePace',
      title: `${race === '5k' || race === '10k' ? raceName.toUpperCase() : raceName[0].toUpperCase() + raceName.slice(1)} pace: ${reps} × ${s.each} km`,
      km: round1(wuCd + reps * s.each + 0.6 * (reps - 1)),
      targetPace: paces.race,
      details: `Warm up 2 km. ${reps} × ${s.each} km at ${goalPace} (your target pace), ${s.rest} between. Cool down 2 km. Lock in the rhythm you'll race at.`,
    }
  }
  const strides = (km: number): Session => ({
    kind: 'strides',
    title: `Easy ${km} km + strides`,
    km,
    details: `Easy ${easyRange}, then 6 × 20 s relaxed strides (~${fmtPace(paces.repetition)}) with full recovery.`,
  })

  const sessions = new Map<number, Session>()
  sessions.set(long, longDay)
  const set = (d: number | null, s: Session) => d !== null && sessions.set(d, s)
  switch (phase) {
    case 'base':
      set(q1, strides(round1(clamp(target * 0.14, 5, 10))))
      set(q2, threshold(`Tempo: ${tReps} × ${tEach} min`))
      break
    case 'build':
      if (race === '5k') {
        set(q1, intervals())
        set(q2, threshold())
      } else if (race === 'marathon') {
        set(q1, threshold())
        set(q2, racePace(0.5))
      } else {
        set(q1, threshold())
        set(q2, intervals())
      }
      break
    case 'specific':
      if (race === '5k') {
        set(q1, racePace())
        set(q2, weekNo % 2 ? reps400() : threshold())
      } else if (race === '10k') {
        set(q1, racePace())
        set(q2, weekNo % 2 ? intervals() : threshold())
      } else {
        set(q1, threshold())
        set(q2, racePace())
      }
      break
    case 'taper':
      set(q1, { ...racePace(0.6), title: `Sharpener: ${racePace(0.6).title.split(': ')[1]} at race pace`, details: `Warm up 2 km. ${racePace(0.6).details.split('. ')[1]}. Cool down 2 km. Should feel controlled.` })
      set(q2, strides(6))
      break
    case 'recovery':
      set(q1, strides(round1(clamp(target * 0.15, 4, 8))))
      break
    case 'race': {
      const raceIdx = weekdayIndex(settings.goalRaceDate!)
      const goalTime = paces.race * (METERS[race] / 1000)
      sessions.clear()
      sessions.set(raceIdx, {
        kind: 'race',
        title: `Race day: ${raceName}`,
        km: Math.round((METERS[race] / 1000 + 3) * 10) / 10,
        targetPace: paces.race,
        details: `Target ${goalPace} → ${fmtTime(goalTime)}. Start no faster than goal pace; ${race === '5k' ? 'push from 3 km' : race === '10k' ? 'push from 7 km' : race === 'half' ? 'push from 15 km' : 'hold steady to 32 km, then race'}. 2 km jog + strides beforehand. See the pacing card for every split.`,
      })
      const sharpen = raceIdx - 3
      if (sharpen >= 0) {
        sessions.set(sharpen, { ...racePace(0.4), title: 'Tune-up at race pace', km: wuCd + 3, details: `Warm up 2 km. 3 × 1 km at ${goalPace}, 2 min jog. Cool down. Just a reminder of the rhythm.` })
      }
      const shake = raceIdx - 1
      if (shake >= 0) sessions.set(shake, strides(4))
      break
    }
  }

  // A small week can't hold two quality sessions plus their warm-ups: keep the key one.
  if (phase !== 'race' && q2 !== null && sessions.has(q2)) {
    const fixed = [...sessions.values()].reduce((a, x) => a + x.km, 0)
    if (fixed > target * Math.max(style.qualityRoom, race === 'marathon' ? 0.9 : 0)) {
      sessions.set(q2, strides(round1(clamp(target * 0.12, 4, 8))))
      notes.push('One quality session this week: at this volume a second would crowd out the easy running.')
    }
  }

  // ---- Fill the remaining run days with easy running --------------------------------
  const raceIdx = phase === 'race' ? weekdayIndex(settings.goalRaceDate!) : 7
  const runSet = new Set(run.filter((d) => phase !== 'race' || d < raceIdx - 1 || sessions.has(d)))
  for (const d of sessions.keys()) runSet.add(d)
  const easyDays = [...runSet].filter((d) => !sessions.has(d))
  const fixedKm = [...sessions.values()].reduce((a, s) => a + s.km, 0)
  const per = easyDays.length ? clamp(round1((target - fixedKm) / easyDays.length), 4, 16) : 0
  for (const d of easyDays) {
    sessions.set(d, {
      kind: 'easy',
      title: `Easy ${per} km`,
      km: per,
      details: `Conversational pace, ${easyRange}. ${d === (long + 1) % 7 ? 'Recovery run after the long run: keep it very easy.' : ''}`.trim(),
    })
  }

  const days: PlanDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(planStart, i)
    const s = sessions.get(i) ?? { kind: 'rest' as const, title: 'Rest', km: 0, details: 'Rest or light mobility. Recovery is when the adaptation happens.' }
    return { date, weekday: WEEKDAYS[i], ...s }
  })
  return { days, notes }
}

// ---------------------------------------------------------------------------
// The week you're about to run (from recent training and readiness)

export interface PlanInputs {
  acts: Activity[]
  settings: Settings
  vdot: number | null
  /** current predictions for every distance */
  predictions: Prediction[]
  readiness: Readiness
  today: string
  /** 'next' (default): the coming week. 'current': the week containing today, planned from the
   *  weeks before it, which is what "today's session" is read from. */
  which?: 'current' | 'next'
}

export function planNextWeek({ acts, settings, vdot, predictions, readiness, today, which = 'next' }: PlanInputs): WeekPlan {
  const thisWeek = weekStart(today)
  const planStart = which === 'current' || weekdayIndex(today) === 0 ? thisWeek : addDays(thisWeek, 7)
  const lastComplete = addDays(planStart === thisWeek ? thisWeek : weekStart(today), -1)
  const completed = weeklyRunKm(acts, lastComplete, 4)
  const current = weeklyRunKm(acts, today, 1)[0]
  const midWeek = planStart !== thisWeek // planning next week while this one is still running
  const recentWeeksKm = midWeek ? [...completed.slice(1), current] : completed

  const last3 = completed.slice(-3).map((w) => w.km)
  const avg3 = last3.reduce((a, b) => a + b, 0) / last3.length
  const maxRecent = Math.max(...completed.map((w) => w.km))
  // Planning mid-week: if this week is already far below average, it is the down week.
  const easingAlready = midWeek && current.km < avg3 * 0.6
  const rising = !easingAlready && last3.length === 3 && last3[1] > last3[0] * 1.02 && last3[2] > last3[1] * 1.02
  const race = settings.goalRace
  const goal = settings.goalTimeSeconds
  const predicted = predictions.find((p) => p.race === race)?.seconds ?? null
  const paces = pacesFor(vdot ?? 40, race, goal)
  const style = STYLE[settings.planStyle ?? 'balanced']
  const usual = habitualKm(acts, today)

  let phase = phaseFor(planStart, settings)
  const rationale: string[] = []
  const base = avg3 >= 5 ? avg3 : 15
  if (avg3 < 5) rationale.push('Little recent running, so the week starts from a conservative 15 km.')

  let target: number
  if (phase === 'race') {
    target = base * 0.55
    rationale.push(`Race week: volume drops to ~55 % so you start fresh on ${toDate(settings.goalRaceDate!).toDateString()}.`)
  } else if (phase === 'taper') {
    target = base * 0.75
    rationale.push('Taper: volume down ~25 %, intensity kept so the legs stay sharp.')
  } else if (phase === 'recovery' || readiness.status === 'recover') {
    target = base * 0.7
    phase = 'recovery'
    rationale.push(
      readiness.status === 'recover'
        ? 'Recovery signals are poor (see readiness), so this is a lighter week with no hard intervals.'
        : 'Post-race week: easy running only while you recover.',
    )
  } else if (rising && !style.skipRisingDown) {
    target = base * 0.8
    phase = 'recovery'
    rationale.push('Three rising weeks in a row: take a down week (~80 %) to absorb the work, then build again.')
  } else if (readiness.status === 'caution' && settings.planStyle !== 'aggressive') {
    target = Math.max(base, completed[completed.length - 1]?.km ?? 0)
    rationale.push('Readiness is mixed, so volume holds steady this week instead of increasing.')
  } else if (settings.planStyle === 'aggressive' && usual > base * 1.1) {
    // Returning to volume your body already knows: go most of the way back at once.
    target = Math.min(usual, base * 1.3, settings.weeklyKmTarget ?? Infinity)
    rationale.push(`Aggressive plan: straight back toward your usual ${Math.round(usual)} km/week (from ${avg3.toFixed(0)} recently). Ease off if your legs or readiness complain.`)
  } else {
    const step = style.firstStep
    target = Math.min(base * step, Math.max(maxRecent, base) * (settings.planStyle === 'aggressive' ? 1.2 : 1.1))
    rationale.push(`Volume builds ~${Math.round((step - 1) * 100)} % on your recent ${avg3.toFixed(0)} km/week average.`)
  }
  if (settings.weeklyKmTarget && target > settings.weeklyKmTarget) {
    target = settings.weeklyKmTarget
    rationale.push(`Held at your ${settings.weeklyKmTarget} km/week target.`)
  }
  target = Math.max(10, Math.round(target))

  const weekNo = Math.floor(daysBetween('2024-01-01', planStart) / 7)
  const { days, notes } = buildDays({ planStart, phase, target, settings, paces, weekNo })
  rationale.push(...notes)
  rationale.push(...goalNotes(race, goal, predicted, vdot))
  if (settings.goalRaceDate && phase !== 'race' && phase !== 'recovery') {
    const weeks = Math.ceil(daysBetween(planStart, settings.goalRaceDate) / 7)
    rationale.push(`${weeks} weeks to your ${LABEL[race]} on ${toDate(settings.goalRaceDate).toDateString()}: ${phase} phase.`)
  }

  return {
    weekStart: planStart,
    phase,
    targetKm: Math.round(days.reduce((a, d) => a + d.km, 0)),
    recentWeeksKm,
    paces,
    race,
    goalSeconds: goal,
    predictedSeconds: predicted,
    days,
    rationale,
    readiness,
  }
}

function goalNotes(race: RaceKey, goal: number | null, predicted: number | null, vdot: number | null): string[] {
  const out: string[] = []
  if (goal && predicted) {
    const gap = predicted - goal
    out.push(
      gap > 0
        ? `Your ${LABEL[race]} target ${fmtTime(goal)} is ${fmtTime(gap)} faster than today's prediction (${fmtTime(predicted)}). Race-pace work uses the target; threshold and easy paces use current fitness so you don't overcook it.`
        : `Current fitness already predicts ${fmtTime(predicted)}, ahead of your ${fmtTime(goal)} target. Consider a faster target.`,
    )
  } else if (predicted) {
    out.push(`Paces come from your current fitness (predicted ${LABEL[race]} ${fmtTime(predicted)}). Set a target time to train at goal pace.`)
  }
  if (!vdot) out.push('No fitness estimate yet: paces are generic until you sync some outdoor runs.')
  return out
}

// ---------------------------------------------------------------------------
// The whole block to race day

/** Your usual running volume: median km of the weeks you ran in the last year (robust to ultras). */
export function habitualKm(acts: Activity[], today: string): number {
  const weeks = weeklyRunKm(acts, addDays(weekStart(today), -1), 52).map((w) => w.km).filter((km) => km >= 5)
  if (weeks.length < 8) return 0
  weeks.sort((a, b) => a - b)
  return weeks[Math.floor(weeks.length / 2)]
}

/**
 * Typical VDOT gain per week of structured training. Fitter runners improve more slowly. These are
 * conservative, middle-of-the-road figures; consistent, well-recovered training can beat them.
 */
export function weeklyGain(vdot: number): number {
  return vdot < 40 ? 0.35 : vdot < 50 ? 0.25 : vdot < 58 ? 0.17 : 0.11
}

export function planBlock(inputs: PlanInputs & { current: WeekPlan; next: WeekPlan }): TrainingBlock {
  const { settings, vdot, predictions, today } = inputs
  const race = settings.goalRace
  const raceDate = settings.goalRaceDate && settings.goalRaceDate >= today ? settings.goalRaceDate : null
  const notes: string[] = []
  const weeks: WeekPlan[] = inputs.current.weekStart === inputs.next.weekStart ? [inputs.current] : [inputs.current, inputs.next]
  if (!raceDate) {
    return { race, raceDate: null, goalSeconds: settings.goalTimeSeconds, weeks, realism: null, notes: ['Pick a race and a date to get a plan all the way to race day.'] }
  }

  // Project the remaining weeks from where the plan for next week leaves off.
  const prof = RACE_PROFILE[race]
  const lastWeek = weekStart(raceDate)
  const paces = pacesFor(vdot ?? 40, race, settings.goalTimeSeconds)
  const startKm = Math.max(...weeks.map((w) => w.targetKm))
  // Aim for a peak that suits the distance, and at least your usual volume: rebuilding to what
  // your body already knows can go faster than building beyond it.
  const usual = habitualKm(inputs.acts, today)
  const distanceShare: Record<RaceKey, number> = { '5k': 0.85, '10k': 0.95, half: 1.05, marathon: 1.15 }
  const style = STYLE[settings.planStyle ?? 'balanced']
  const peak = settings.weeklyKmTarget ?? Math.round(Math.max(prof.peakFloor, startKm * prof.peakGrowth, usual * distanceShare[race]) * style.peakMul)
  if (usual > startKm * 1.25) notes.push(`You usually run about ${Math.round(usual)} km a week, so the plan rebuilds toward that faster than it would build new volume.`)
  let build = weeks[weeks.length - 1].targetKm
  let peakReached = startKm
  const MAX_WEEKS = 40
  for (let w = addDays(weeks[weeks.length - 1].weekStart, 7), i = weeks.length; w <= lastWeek && i < MAX_WEEKS; w = addDays(w, 7), i++) {
    const phase = phaseFor(w, settings)
    const weeksOut = Math.floor(daysBetween(w, raceDate) / 7)
    let km: number
    if (phase === 'race') km = peakReached * (race === 'marathon' ? 0.45 : 0.55)
    else if (phase === 'taper') km = peakReached * (race === 'marathon' ? (weeksOut === 2 ? 0.8 : 0.65) : 0.75)
    else if (i % style.downEvery === style.downEvery - 1) km = build * style.downTo // regular easier week
    else {
      build = Math.min(build * (build < usual * 0.85 ? style.rebuild : style.grow), peak)
      km = build
      peakReached = Math.max(peakReached, km)
    }
    km = Math.max(10, Math.round(km))
    const weekNo = Math.floor(daysBetween('2024-01-01', w) / 7)
    const { days } = buildDays({ planStart: w, phase, target: km, settings, paces, weekNo })
    weeks.push({
      weekStart: w,
      phase,
      targetKm: Math.round(days.reduce((a, d) => a + d.km, 0)),
      recentWeeksKm: [],
      paces,
      race,
      goalSeconds: settings.goalTimeSeconds,
      predictedSeconds: inputs.next.predictedSeconds,
      days,
      rationale: [],
      readiness: inputs.next.readiness,
    })
  }
  if (daysBetween(today, raceDate) > MAX_WEEKS * 7) notes.push(`Showing the first ${MAX_WEEKS} weeks; the rest is planned as you get closer.`)
  const top = weeks.filter((w) => w.phase !== 'race').reduce((a, w) => (w.targetKm > a.targetKm ? w : a), weeks[0])
  if (settings.weeklyKmTarget && top.targetKm < settings.weeklyKmTarget * 0.95) {
    notes.push(`Building safely from ${startKm} km, the plan reaches ${top.targetKm} of your ${settings.weeklyKmTarget} km/week target before the taper. Choose Aggressive or a later race to get closer.`)
  }

  const prediction = predictions.find((p) => p.race === race) ?? null
  const realism = vdot && prediction ? assessGoal({ race, raceDate, today, vdot, prediction, goalSeconds: settings.goalTimeSeconds, weeks, style: settings.planStyle }) : null
  if (!realism) notes.push('Sync some outdoor runs to see how realistic your target is.')
  return { race, raceDate, goalSeconds: settings.goalTimeSeconds, weeks, realism, notes }
}

/** How realistic is the target, given current fitness, the time left and the planned training? */
export function assessGoal({ race, raceDate, today, vdot, prediction, goalSeconds, weeks, style = 'balanced' }: {
  race: RaceKey
  raceDate: string
  today: string
  vdot: number
  prediction: Prediction
  goalSeconds: number | null
  weeks: WeekPlan[]
  style?: Settings['planStyle']
}): Realism {
  const meters = METERS[race]
  const nWeeks = Math.max(0, Math.round(daysBetween(today, raceDate) / 7))
  // Training weeks that build fitness: everything except taper and race week, with diminishing
  // returns beyond ~20 weeks.
  const buildWeeks = weeks.filter((w) => w.phase !== 'taper' && w.phase !== 'race' && w.weekStart > today).length
  const effective = Math.min(buildWeeks, 20) + Math.max(0, buildWeeks - 20) * 0.3
  const typicalGain = Math.round(weeklyGain(vdot) * effective * STYLE[style].gainMul * 10) / 10

  // Endurance on race day, from the plan's peak weeks and longest planned run.
  const pre = weeks.filter((w) => w.phase !== 'taper' && w.phase !== 'race')
  const peakWeeks = [...pre].sort((a, b) => b.targetKm - a.targetKm).slice(0, 6)
  const ctx = {
    weeklyKm: peakWeeks.length ? peakWeeks.reduce((s, w) => s + w.targetKm, 0) / peakWeeks.length : 0,
    longestRunKm: Math.max(0, ...weeks.flatMap((w) => w.days.filter((d) => d.kind === 'long').map((d) => d.km))),
  }
  const penalty = Math.min(endurancePenalty(race, ctx, 0), prediction.endurancePenalty || endurancePenalty(race, ctx, 0))

  const projectedVdot = vdot + typicalGain
  const projectedSeconds = timeFor(projectedVdot, meters) * (1 + penalty)
  const projectedRange: [number, number] = [projectedSeconds * 0.985, projectedSeconds * 1.025]
  const target = goalSeconds ?? projectedSeconds
  const neededVdot = vdotFor(meters, target / (1 + penalty))
  const gain = neededVdot - vdot
  const ratio = typicalGain > 0 ? gain / typicalGain : gain > 0 ? Infinity : 0

  let level: Realism['level'] = gain <= 0 ? 'likely' : ratio <= 0.6 ? 'likely' : ratio <= 1 ? 'realistic' : ratio <= 1.6 ? 'ambitious' : 'unlikely'
  const factors: string[] = []
  const prof = RACE_PROFILE[race]
  if (nWeeks < prof.minWeeks && gain > 0) {
    factors.push(`${nWeeks} weeks is short for a ${LABEL[race]} build; ${prof.minWeeks}+ weeks is typical.`)
    if (level === 'likely') level = 'realistic'
    else if (level === 'realistic') level = 'ambitious'
  }
  factors.push(`Today's prediction: ${fmtTime(prediction.seconds)} (VDOT ${vdot.toFixed(1)}).`)
  if (style === 'aggressive') factors.push('Aggressive plan: more volume and race-pace work count toward the expected gain, but the injury risk is higher. Back off when legs or readiness say so.')
  if (style === 'conservative') factors.push('Conservative plan: gentler build, so expect a little less improvement.')
  if (goalSeconds) {
    factors.push(
      gain > 0
        ? `Your target needs VDOT ${neededVdot.toFixed(1)}: +${gain.toFixed(1)}. In ${buildWeeks} training weeks runners at your level typically gain about +${typicalGain.toFixed(1)}.`
        : `Your target needs VDOT ${neededVdot.toFixed(1)}, which you already have.`,
    )
  }
  if (penalty > 0.005) {
    factors.push(`The plan's peak (about ${Math.round(ctx.weeklyKm)} km/week, longest run ${ctx.longestRunKm} km) still costs about ${(penalty * 100).toFixed(1)} % on race day; more volume would help.`)
  } else if (race === 'half' || race === 'marathon') {
    factors.push(`The plan builds to about ${Math.round(ctx.weeklyKm)} km/week with long runs up to ${ctx.longestRunKm} km: enough endurance for the distance.`)
  }

  const t = goalSeconds ? fmtTime(goalSeconds) : null
  const proj = fmtTime(Math.round(projectedSeconds / 5) * 5)
  const headline = !goalSeconds
    ? `If training goes to plan: about ${proj}`
    : { likely: 'Very realistic', realistic: 'Realistic', ambitious: 'Ambitious', unlikely: 'Unlikely by this date' }[level]
  const summary = !goalSeconds
    ? `Set a target time to see how realistic it is. Following this plan, a ${LABEL[race]} of about ${proj} is a fair expectation.`
    : level === 'likely'
      ? `${t} is well within reach. Following the plan, about ${proj} is a fair expectation; you could aim a little faster.`
      : level === 'realistic'
        ? `${t} is realistic if you train consistently. Following the plan, about ${proj} is a fair expectation.`
        : level === 'ambitious'
          ? `${t} needs more improvement than is typical in this time. It's possible with a very consistent, injury-free block. About ${proj} is the likelier outcome.`
          : `${t} needs much more improvement than ${nWeeks} weeks usually brings. A target around ${proj}, or a later race, is more realistic.`
  return {
    level,
    headline,
    summary,
    weeks: nWeeks,
    currentVdot: vdot,
    neededVdot,
    typicalGain,
    projectedSeconds,
    projectedRange,
    predictedNowSeconds: prediction.seconds,
    factors,
  }
}

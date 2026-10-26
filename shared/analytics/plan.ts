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
  conservative: { firstStep: 1.05, grow: 1.05, rebuild: 1.08, downEvery: 3, downTo: 0.75, peakMul: 0.85, skipRisingDown: false, qualityRoom: 0.75, longBonus: 0, raceWork: 0.85, gainMul: 0.85 },
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
// Session progressions: each time a session type comes round in a normal week it moves up one
// rung; easier weeks repeat a lighter rung and the taper steps back.

/** Threshold / tempo: [reps, minutes] — 20 min of threshold work growing to 40–45 min. */
const T_LADDER: [number, number][] = [[2, 10], [3, 8], [2, 12], [3, 9], [3, 10], [2, 15], [4, 8], [3, 12], [2, 18], [4, 10], [3, 15], [2, 20]]
const T_CAP: Record<RaceKey, number> = { '5k': 30, '10k': 36, half: 45, marathon: 45 } // max threshold minutes

/** Track sessions, rotating for variety while total volume grows: [reps, metres] or a pyramid. */
const I_MENU: { reps: number; m: number; pyramid?: number[] }[] = [
  { reps: 12, m: 400 },
  { reps: 6, m: 800 },
  { reps: 5, m: 1000 },
  { reps: 8, m: 800 },
  { reps: 4, m: 1200 },
  { reps: 1, m: 5600, pyramid: [400, 800, 1200, 1600, 1200, 800, 400] },
  { reps: 6, m: 1000 },
  { reps: 3, m: 1600 },
  { reps: 5, m: 1200 },
]

/** Race-pace work per distance: [reps, km]. */
const RP_LADDER: Record<RaceKey, [number, number][]> = {
  '5k': [[5, 0.8], [6, 0.8], [5, 1], [6, 1], [4, 1.2], [5, 1.2], [3, 1.6]],
  '10k': [[5, 1], [4, 1.5], [5, 1.5], [4, 2], [5, 2], [3, 3], [4, 2.5]],
  half: [[2, 3], [3, 3], [2, 5], [3, 4], [2, 6], [3, 5], [2, 7], [3, 6]],
  marathon: [[2, 4], [2, 5], [2, 6], [3, 5], [2, 8], [2, 10], [1, 16], [2, 12]],
}

export interface Rungs {
  threshold: number
  intervals: number
  racePace: number
}

/** Where the ladders start: more experienced runners (higher usual volume) skip the first rungs. */
export function startRungs(settings: Settings, usualKm: number): Rungs {
  let base = usualKm < 30 ? 0 : usualKm < 45 ? 1 : usualKm < 60 ? 2 : 3
  if (settings.planStyle === 'aggressive') base += 1
  if (settings.planStyle === 'conservative') base = Math.max(0, base - 1)
  return { threshold: base, intervals: Math.max(0, base - 1), racePace: Math.max(0, base - 1) }
}

const at = <T>(list: T[], i: number) => list[clamp(Math.round(i), 0, list.length - 1)]

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
  /** shortest easy run worth doing, from your own history (km) */
  minEasy: number
  /** progression rung for each session type this week */
  rungs: Rungs
  /** an easier week inside the block: sessions repeat a lighter rung */
  easyWeek?: boolean
}

function buildDays({ planStart, phase, target, settings, paces, weekNo, minEasy, rungs, easyWeek }: WeekSpec): { days: PlanDay[]; notes: string[]; used: Set<keyof Rungs> } {
  const used = new Set<keyof Rungs>()
  // easier weeks and the taper step back down the ladders
  const step = phase === 'taper' ? -2 : easyWeek || phase === 'recovery' ? -1 : 0
  const race = settings.goalRace
  const prof = RACE_PROFILE[race]
  const notes: string[] = []
  // Fewer, longer runs at low volume rather than many short ones.
  const runDays = clamp(Math.min(settings.runDaysPerWeek, Math.floor(target / Math.max(6, minEasy * 1.1))), 3, 7)
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

  // ---- Quality sessions (progressive, see the ladders above) -------------------------
  const threshold = (label = 'Threshold'): Session => {
    used.add('threshold')
    // highest rung within the distance's cap
    const fits = T_LADDER.filter(([r, m]) => r * m <= T_CAP[race])
    const [reps, min] = at(fits, rungs.threshold + step)
    const workKm = (reps * min * 60) / paces.threshold
    return {
      kind: 'threshold',
      title: `${label}: ${reps} × ${min} min`,
      km: round1(wuCd + workKm + 0.4 * (reps - 1)),
      targetPace: paces.threshold,
      details: `Warm up 2 km easy. ${reps} × ${min} min at ${fmtPace(paces.threshold)} with 2 min easy jog between. Cool down 2 km. Comfortably hard: you could say a few words, not chat.`,
    }
  }
  const intervals = (): Session => {
    used.add('intervals')
    const s = at(I_MENU, rungs.intervals + step)
    const short = s.m <= 600
    const pace = short ? paces.interval * 0.97 : paces.interval
    const workKm = (s.reps * s.m) / 1000
    const what = s.pyramid ? `Pyramid ${s.pyramid.join('-')} m` : `${s.reps} × ${s.m} m`
    const rest = s.pyramid ? 'jog half the distance of each rep' : short ? '200 m jog' : s.m >= 1200 ? '3 min jog' : '2 min jog'
    return {
      kind: 'intervals',
      title: `Intervals: ${what}`,
      km: round1(wuCd + workKm * 1.5),
      targetPace: pace,
      details: `Warm up 2 km + 4 strides. ${what} at ${fmtPace(pace)}${short ? ' (a touch faster than 5K pace)' : ' (about 3–5K race pace)'}, ${rest} between. Cool down 2 km.`,
    }
  }
  /** The goal-pace session: rep length and volume grow through the block. */
  const racePace = (extraStep = 0): Session => {
    used.add('racePace')
    const [reps0, each] = at(RP_LADDER[race], rungs.racePace + step + extraStep)
    const reps = Math.max(1, Math.round(reps0 * (style.raceWork > 1 && reps0 > 1 ? 1.25 : style.raceWork < 1 && reps0 > 2 ? 0.8 : 1)))
    const rest = race === '5k' ? '2–3 min jog' : race === '10k' ? '90 s jog' : '3 min easy'
    const name = race === '5k' || race === '10k' ? raceName.toUpperCase() : raceName[0].toUpperCase() + raceName.slice(1)
    return {
      kind: 'racePace',
      title: reps === 1 ? `${name} pace: ${each} km continuous` : `${name} pace: ${reps} × ${each} km`,
      km: round1(wuCd + reps * each + 0.6 * (reps - 1)),
      targetPace: paces.race,
      details: `Warm up 2 km. ${reps === 1 ? `${each} km` : `${reps} × ${each} km`} at ${goalPace} (your target pace)${reps > 1 ? `, ${rest} between` : ''}. Cool down 2 km. Lock in the rhythm you'll race at.`,
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
      set(q1, strides(round1(clamp(target * 0.14, minEasy, Math.max(10, minEasy)))))
      set(q2, threshold('Tempo'))
      break
    case 'build':
      if (race === '5k') {
        set(q1, intervals())
        set(q2, threshold())
      } else if (race === 'marathon') {
        set(q1, threshold())
        set(q2, racePace(-2))
      } else {
        set(q1, threshold())
        set(q2, intervals())
      }
      break
    case 'specific':
      if (race === '5k') {
        set(q1, racePace())
        set(q2, weekNo % 2 ? intervals() : threshold())
      } else if (race === '10k') {
        set(q1, racePace())
        set(q2, weekNo % 2 ? intervals() : threshold())
      } else {
        set(q1, threshold())
        set(q2, racePace())
      }
      break
    case 'taper':
      {
        const rp = racePace()
        set(q1, { ...rp, title: `Sharpener: ${rp.title.split(': ')[1]} at race pace`, details: `${rp.details.replace(' Lock in the rhythm you\'ll race at.', '')} Should feel controlled.` })
      }
      set(q2, strides(minEasy))
      break
    case 'recovery':
      set(q1, strides(round1(clamp(target * 0.15, minEasy, Math.max(8, minEasy)))))
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
        sessions.set(sharpen, { ...racePace(-3), title: 'Tune-up at race pace', km: wuCd + 3, details: `Warm up 2 km. 3 × 1 km at ${goalPace}, 2 min jog. Cool down. Just a reminder of the rhythm.` })
      }
      const shake = raceIdx - 1
      if (shake >= 0) sessions.set(shake, { ...strides(round1(clamp(minEasy * 0.7, 5, 8))), title: `Shake-out ${round1(clamp(minEasy * 0.7, 5, 8))} km + strides`, details: `Very easy, then 4 short strides. Just loosening the legs for tomorrow.` })
      break
    }
  }

  // A small week can't hold two quality sessions plus their warm-ups: keep the key one.
  if (phase !== 'race' && q2 !== null && sessions.has(q2)) {
    const fixed = [...sessions.values()].reduce((a, x) => a + x.km, 0)
    if (fixed > target * Math.max(style.qualityRoom, race === 'marathon' ? 0.9 : 0)) {
      // Room for one hard session: alternate the two types week to week so both keep progressing.
      const first = q1 !== null ? sessions.get(q1) : undefined
      const second = sessions.get(q2)!
      const isQuality = (x: Session | undefined) => !!x && x.kind !== 'strides' && x.kind !== 'easy'
      if (isQuality(second) && q1 !== null && (weekNo % 2 === 1 || !isQuality(first))) sessions.set(q1, second)
      sessions.set(q2, strides(round1(clamp(target * 0.12, minEasy, Math.max(8, minEasy)))))
      notes.push('One quality session this week, alternating type week to week: at this volume a second would crowd out the easy running.')
    }
  }

  // ---- Fill the remaining run days with easy running --------------------------------
  const raceIdx = phase === 'race' ? weekdayIndex(settings.goalRaceDate!) : 7
  const runSet = new Set(run.filter((d) => phase !== 'race' || d < raceIdx - 1 || sessions.has(d)))
  for (const d of sessions.keys()) runSet.add(d)
  const easyDays = [...runSet].filter((d) => !sessions.has(d))
  const fixedKm = [...sessions.values()].reduce((a, s) => a + s.km, 0)
  // Never shorter than your usual easy run (shorter only in the taper and race week): if there's
  // too little left, run fewer easy days. The day after the long run goes last.
  const floor = phase === 'race' ? round1(clamp(minEasy * 0.6, 5, 8)) : phase === 'taper' ? round1(minEasy * 0.8) : minEasy
  const order = [...easyDays].sort((a, b) => Number(a === (long + 1) % 7) - Number(b === (long + 1) % 7))
  while (order.length > 1 && (target - fixedKm) / order.length < floor) order.shift()
  easyDays.splice(0, easyDays.length, ...order)
  const per = easyDays.length ? clamp(round1((target - fixedKm) / easyDays.length), floor, 18) : 0
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
  return { days, notes, used }
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
  // Ladders start where your experience puts you; next week is one step on.
  const start = startRungs(settings, usual)
  const offset = daysBetween(thisWeek, planStart) / 7
  const rungs = { threshold: start.threshold + offset, intervals: start.intervals + offset, racePace: start.racePace + offset }
  const { days, notes } = buildDays({ planStart, phase, target, settings, paces, weekNo, minEasy: easyFloor(acts, today), rungs })
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

/**
 * Shortest easy run worth planning for you: about 80 % of your typical run (median of your runs of
 * 3–25 km over the last year), between 5 and 12 km. Short 4 km jogs are rarely useful if you
 * normally run 10 km.
 */
export function easyFloor(acts: Activity[], today: string): number {
  const from = addDays(today, -365)
  const ks = acts
    .filter((a) => a.sport === 'run' && a.date >= from && a.date <= today && a.distanceM >= 3000 && a.distanceM <= 25000)
    .map((a) => a.distanceM / 1000)
    .sort((a, b) => a - b)
  if (ks.length < 10) return 5
  return round1(clamp(ks[Math.floor(ks.length / 2)] * 0.8, 5, 12))
}

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
  const minEasy = easyFloor(inputs.acts, today)
  const distanceShare: Record<RaceKey, number> = { '5k': 0.85, '10k': 0.95, half: 1.05, marathon: 1.15 }
  const style = STYLE[settings.planStyle ?? 'balanced']
  const peak = settings.weeklyKmTarget ?? Math.round(Math.max(prof.peakFloor, startKm * prof.peakGrowth, usual * distanceShare[race]) * style.peakMul)
  if (usual > startKm * 1.25) notes.push(`You usually run about ${Math.round(usual)} km a week, so the plan rebuilds toward that faster than it would build new volume.`)
  let build = weeks[weeks.length - 1].targetKm
  let peakReached = startKm
  // Continue the session progressions after the weeks already planned.
  const rungs = startRungs(settings, usual)
  const bump = (w: WeekPlan) => {
    if (w.days.some((d) => d.kind === 'threshold')) rungs.threshold++
    if (w.days.some((d) => d.kind === 'intervals')) rungs.intervals++
    if (w.days.some((d) => d.kind === 'racePace' || d.kind === 'halfPace')) rungs.racePace++
  }
  for (const w of weeks) if (w.phase !== 'recovery') bump(w)
  const MAX_WEEKS = 40
  for (let w = addDays(weeks[weeks.length - 1].weekStart, 7), i = weeks.length; w <= lastWeek && i < MAX_WEEKS; w = addDays(w, 7), i++) {
    const phase = phaseFor(w, settings)
    const weeksOut = Math.floor(daysBetween(w, raceDate) / 7)
    let km: number
    const easyWeek = phase !== 'race' && phase !== 'taper' && i % style.downEvery === style.downEvery - 1
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
    const { days } = buildDays({ planStart: w, phase, target: km, settings, paces, weekNo, minEasy, rungs: { ...rungs }, easyWeek })
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
    if (!easyWeek && (phase === 'base' || phase === 'build' || phase === 'specific')) bump(weeks[weeks.length - 1])
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

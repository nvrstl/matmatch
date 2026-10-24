// Race predictions from your own efforts, tuned toward the half marathon.
//
// 1. Every outdoor run yields "efforts": Garmin's fastest 5K/10K/HM/M splits and the run as a whole.
// 2. Each effort is converted to a VDOT (Daniels). Older efforts are discounted for detraining.
// 3. Runs with heart-rate data give a second, HR-based estimate, which keeps the number honest in
//    stretches without hard efforts.
// 4. VDOT → equivalent race times, then an endurance penalty for HM/M when recent volume and
//    long runs don't support the distance (VDOT assumes you trained for it).
import { addDays, daysBetween } from '../dates'
import type { Activity, Effort, Prediction, PredictionResult, RaceKey } from '../types'
import { RACES } from '../types'
import { timeFor, vdotFor, vo2Cost } from '../vdot'

const SPLIT_KEYS: RaceKey[] = ['5k', '10k', 'half', 'marathon']
const RACE_METERS: Record<RaceKey, number> = { '5k': 5000, '10k': 10000, half: 21097.5, marathon: 42195 }

/** Runs whose pace we trust: no treadmill/virtual (calibration) or trail (terrain). */
export function isPaceRun(a: Activity): boolean {
  if (a.sport !== 'run') return false
  const t = a.typeKey.toLowerCase()
  return !/treadmill|virtual|indoor|trail|ultra/.test(t)
}

export function effortsOf(a: Activity): Effort[] {
  if (!isPaceRun(a)) return []
  const out: Effort[] = []
  const push = (meters: number, seconds: number, kind: Effort['kind']) => {
    const pace = seconds / (meters / 1000)
    if (pace < 150 || pace > 720) return // 2:30–12:00 /km
    const vdot = vdotFor(meters, seconds)
    if (vdot < 20 || vdot > 85) return
    out.push({ activityId: a.id, date: a.date, name: a.name, meters, seconds, vdot, kind })
  }
  if (a.distanceM >= 3000 && a.durationS > 0) push(a.distanceM, a.durationS, 'whole')
  const whole = out[0]
  for (const k of SPLIT_KEYS) {
    const s = a.fastest[k]
    if (!s) continue
    // GPS-glitch signature: a split covering most of the run that is far faster than the run itself.
    if (whole && RACE_METERS[k] >= a.distanceM * 0.5 && vdotFor(RACE_METERS[k], s) > whole.vdot * 1.1) continue
    push(RACE_METERS[k], s, 'split')
  }
  return out
}

/** Detraining discount: none for 4 weeks, then 0.3 %/week. */
export const recencyFactor = (ageDays: number) => 1 - 0.003 * Math.max(0, ageDays / 7 - 4)

export interface TrainingContext {
  weeklyKm: number // average over the last 8 weeks
  longestRunKm: number // longest single run in the last 10 weeks
}

export function trainingContext(acts: Activity[], asOf: string): TrainingContext {
  let km8 = 0
  let longest = 0
  for (const a of acts) {
    if (a.sport !== 'run' || a.date > asOf) continue
    const age = daysBetween(a.date, asOf)
    if (age < 56) km8 += a.distanceM / 1000
    if (age < 70) longest = Math.max(longest, a.distanceM / 1000)
  }
  return { weeklyKm: km8 / 8, longestRunKm: longest }
}

/** Extra time (fraction) when training doesn't yet support the distance. */
export function endurancePenalty(race: RaceKey, ctx: TrainingContext, sourceMeters: number): number {
  if (sourceMeters >= RACE_METERS[race] * 0.9) return 0 // measured at (or beyond) the distance
  const ramp = (have: number, need: number, max: number) => Math.max(0, Math.min(1, (need - have) / need)) * max
  switch (race) {
    case '5k':
      return 0
    case '10k':
      return ramp(ctx.longestRunKm, 10, 0.015)
    case 'half':
      return ramp(ctx.weeklyKm, 40, 0.04) + ramp(ctx.longestRunKm, 18, 0.05)
    case 'marathon':
      return ramp(ctx.weeklyKm, 70, 0.1) + ramp(ctx.longestRunKm, 32, 0.08)
  }
}

export interface HrContext {
  restingHr: number | null
  maxHr: number | null
}

/**
 * HR-based VDOT for one run: VO2 cost of the pace divided by the fraction of heart-rate reserve
 * used (Swain: %HRR ≈ %VO2R). Only steady runs between 60 % and 90 % HRR qualify.
 */
export function hrVdot(a: Activity, hr: HrContext): number | null {
  if (!isPaceRun(a) || !a.avgHr || !hr.restingHr || !hr.maxHr || a.distanceM < 4000) return null
  const hrr = (a.avgHr - hr.restingHr) / (hr.maxHr - hr.restingHr)
  if (hrr < 0.6 || hrr > 0.9) return null
  const v = a.distanceM / (a.durationS / 60)
  const est = (vo2Cost(v) - 3.5) / hrr + 3.5
  return est > 20 && est < 85 ? est : null
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN
}

export interface VdotEstimate {
  vdot: number
  source: Effort | null
  hrVdot: number | null
  confidence: Prediction['confidence']
  notes: string[]
}

export function estimateVdot(acts: Activity[], asOf: string, hr: HrContext): VdotEstimate | null {
  const notes: string[] = []
  const windowStart = addDays(asOf, -365)
  const scored: { e: Effort; score: number }[] = []
  const hrEsts: number[] = []
  for (const a of acts) {
    if (a.date > asOf || a.date <= windowStart) continue
    const age = daysBetween(a.date, asOf)
    for (const e of effortsOf(a)) scored.push({ e, score: e.vdot * recencyFactor(age) })
    if (age < 42) {
      const h = hrVdot(a, hr)
      if (h) hrEsts.push(h)
    }
  }
  scored.sort((x, y) => y.score - x.score)
  const hrV = hrEsts.length >= 3 ? median(hrEsts) : null

  // Races legitimately beat training runs by a lot, so the yardstick for "implausible" is what
  // heart rate says about current fitness: > 25 % above it looks like a GPS glitch, not a race.
  let best = scored[0]
  if (hrV) {
    const ok = scored.find((s) => s.score <= hrV * 1.25)
    if (best && ok !== best) {
      notes.push(`Ignored an effort on ${best.e.date} that is far beyond what your heart rate suggests (likely a GPS glitch).`)
      best = ok!
    }
  }

  if (!best && !hrV) return null
  if (!best) {
    return { vdot: hrV!, source: null, hrVdot: hrV, confidence: 'low', notes: [...notes, 'No recent hard efforts; estimate based on heart rate vs. pace only.'] }
  }
  const age = daysBetween(best.e.date, asOf)
  if (age <= 56 || !hrV) {
    return { vdot: best.score, source: best.e, hrVdot: hrV, confidence: age <= 56 ? 'high' : 'medium', notes }
  }
  // Best effort is old: blend with what your heart rate says about current fitness.
  notes.push(`Your best effort is ${Math.round(age / 7)} weeks old, so it's blended with a heart-rate-based estimate of current fitness.`)
  return { vdot: (best.score + hrV) / 2, source: best.e, hrVdot: hrV, confidence: 'medium', notes }
}

/** Observed resting HR (median of the last 30 days) and max HR (highest plausible value in 2 years). */
export function hrContext(acts: Activity[], restingSeries: { date: string; value: number }[], asOf: string): HrContext {
  const recentRest = restingSeries.filter((p) => p.date <= asOf && daysBetween(p.date, asOf) < 30).map((p) => p.value)
  const maxes = acts
    .filter((a) => a.maxHr && a.date <= asOf && daysBetween(a.date, asOf) < 730 && a.maxHr < 225)
    .map((a) => a.maxHr!)
    .sort((a, b) => b - a)
  return {
    restingHr: recentRest.length ? median(recentRest) : null,
    // second-highest guards against one spiky optical reading
    maxHr: maxes.length >= 2 ? maxes[1] : (maxes[0] ?? null),
  }
}

export function predictFromVdot(est: VdotEstimate, ctx: TrainingContext): Prediction[] {
  return RACES.map(({ key, label, meters }) => {
    const base = timeFor(est.vdot, meters)
    const sourceMeters = est.source?.meters ?? 0
    const penalty = endurancePenalty(key, ctx, sourceMeters)
    const seconds = base * (1 + penalty)
    // Uncertainty grows with how far we extrapolate from the source distance.
    const stretch = est.source ? Math.abs(Math.log2(meters / est.source.meters)) : 2
    let spread = 0.015 + 0.012 * stretch + (est.confidence === 'low' ? 0.03 : est.confidence === 'medium' ? 0.01 : 0)
    if (key === 'marathon') spread += 0.01
    let confidence = est.confidence
    if (stretch > 2 && confidence === 'high') confidence = 'medium'
    if (penalty > 0.06) confidence = 'low'
    else if (penalty > 0.03 && confidence === 'high') confidence = 'medium'
    spread = Math.min(spread, 0.12)
    const parts: string[] = []
    if (est.source) {
      parts.push(`From your ${fmtDist(est.source.meters)} in ${fmtTime(est.source.seconds)} on ${est.source.date}`)
    } else {
      parts.push('From heart rate vs. pace on recent runs')
    }
    if (penalty > 0) {
      parts.push(
        `+${(penalty * 100).toFixed(1)}% for endurance (avg ${ctx.weeklyKm.toFixed(0)} km/week, longest run ${ctx.longestRunKm.toFixed(1)} km)`,
      )
    }
    return {
      race: key,
      label,
      meters,
      seconds,
      low: seconds * (1 - spread * 0.6), // faster side is less likely than slower
      high: seconds * (1 + spread),
      confidence,
      basis: parts.join('; '),
      endurancePenalty: penalty,
    }
  })
}

export function personalBests(acts: Activity[], asOf: string): PredictionResult['bests'] {
  const yearAgo = addDays(asOf, -365)
  return SPLIT_KEYS.map((race) => {
    let allTime: Effort | null = null
    let last12m: Effort | null = null
    for (const a of acts) {
      if (a.date > asOf) continue
      const e = effortsOf(a).find((x) => x.kind === 'split' && x.meters === RACE_METERS[race])
      if (!e) continue
      if (!allTime || e.seconds < allTime.seconds) allTime = e
      if (a.date > yearAgo && (!last12m || e.seconds < last12m.seconds)) last12m = e
    }
    return { race, allTime, last12m }
  })
}

export function latestVo2max(acts: Activity[], asOf: string): number | null {
  for (let i = acts.length - 1; i >= 0; i--) {
    const a = acts[i]
    if (a.date <= asOf && a.vo2max && a.sport === 'run') return daysBetween(a.date, asOf) < 90 ? a.vo2max : null
  }
  return null
}

export function predictRaces(
  acts: Activity[],
  restingSeries: { date: string; value: number }[],
  asOf: string,
): PredictionResult {
  const hr = hrContext(acts, restingSeries, asOf)
  const est = estimateVdot(acts, asOf, hr)
  const ctx = trainingContext(acts, asOf)
  const vo2 = latestVo2max(acts, asOf)
  return {
    asOf,
    vdot: est?.vdot ?? null,
    source: est?.source ?? null,
    garminVo2max: vo2,
    predictions: est ? predictFromVdot(est, ctx) : [],
    vo2maxPredictions: vo2 ? RACES.map((r) => ({ race: r.key, seconds: timeFor(vo2, r.meters) })) : [],
    bests: personalBests(acts, asOf),
    notes: est?.notes ?? ['Not enough outdoor runs in the last year to predict race times yet.'],
  }
}

/** Month-by-month half-marathon prediction across your whole history. */
export function halfPredictionHistory(acts: Activity[], restingSeries: { date: string; value: number }[]) {
  const runs = acts.filter((a) => a.sport === 'run')
  if (!runs.length) return []
  const out: { date: string; value: number }[] = []
  const last = runs[runs.length - 1].date
  let month = runs[0].date.slice(0, 7)
  while (`${month}-01` <= last) {
    const [y, m] = month.split('-').map(Number)
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    const end = addDays(`${next}-01`, -1)
    const asOf = end < last ? end : last
    const est = estimateVdot(runs, asOf, hrContext(runs, restingSeries, asOf))
    if (est) {
      const half = predictFromVdot(est, trainingContext(runs, asOf)).find((p) => p.race === 'half')!
      out.push({ date: asOf, value: Math.round(half.seconds) })
    }
    month = next
  }
  return out
}

export function fmtTime(s: number): string {
  const r = Math.round(s)
  const h = Math.floor(r / 3600)
  const m = Math.floor((r % 3600) / 60)
  const sec = r % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

const fmtDist = (m: number) => {
  const named = RACES.find((r) => Math.abs(r.meters - m) < 50)
  return named ? named.label : `${(m / 1000).toFixed(1)} km run`
}

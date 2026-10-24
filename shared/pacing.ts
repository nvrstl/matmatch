// Race-day pacing: per-km splits and checkpoint times for a target finish time.

export type Strategy = 'even' | 'negative'

export interface PacingPlan {
  meters: number
  targetSeconds: number
  avgPace: number // s/km
  firstHalfPace: number
  secondHalfPace: number
  km: { km: number; meters: number; pace: number; split: number; cumulative: number }[]
  checkpoints: { label: string; meters: number; cumulative: number }[]
  fuel: string[]
}

const CHECKPOINTS: [string, number][] = [
  ['5K', 5000],
  ['10K', 10000],
  ['15K', 15000],
  ['20K', 20000],
  ['Half', 21097.5],
  ['25K', 25000],
  ['30K', 30000],
  ['35K', 35000],
  ['40K', 40000],
]

/**
 * Even: the same pace all the way. Negative: first half ~1 % slower and second half ~1 % faster
 * than average, the usual way to run a strong half or full marathon.
 */
export function pacingPlan(meters: number, targetSeconds: number, strategy: Strategy): PacingPlan {
  const avgPace = targetSeconds / (meters / 1000)
  const swing = strategy === 'negative' ? 0.01 : 0
  const firstHalfPace = avgPace * (1 + swing)
  const secondHalfPace = avgPace * (1 - swing)
  const half = meters / 2
  // Time to cover the first x metres: piecewise linear, exact at the finish.
  const at = (x: number) => {
    const d = Math.min(x, meters)
    return d <= half ? (d / 1000) * firstHalfPace : (half / 1000) * firstHalfPace + ((d - half) / 1000) * secondHalfPace
  }

  const km: PacingPlan['km'] = []
  for (let start = 0, k = 1; start < meters - 1; start += 1000, k++) {
    const end = Math.min(start + 1000, meters)
    const split = at(end) - at(start)
    km.push({ km: k, meters: end - start, pace: split / ((end - start) / 1000), split, cumulative: at(end) })
  }
  const checkpoints = CHECKPOINTS.filter(([, m]) => m < meters - 50).map(([label, m]) => ({ label, meters: m, cumulative: at(m) }))
  checkpoints.push({ label: 'Finish', meters, cumulative: targetSeconds })

  return { meters, targetSeconds, avgPace, firstHalfPace, secondHalfPace, km, checkpoints, fuel: fuelPlan(meters, targetSeconds) }
}

/** Simple, conventional fuelling guidance by race duration. */
export function fuelPlan(meters: number, seconds: number): string[] {
  const min = seconds / 60
  if (min < 60) return ['No fuel needed. Water at a station if it’s warm.']
  if (meters <= 21100 || min < 120) {
    const tips = ['Breakfast 2–3 h before; a gel or banana 15 min before the start is optional.']
    if (min >= 75) tips.push('One gel around 40–45 min (about km 9–10), with water.')
    else tips.push('A gel isn’t essential; if you like one, take it around km 10.')
    tips.push('Sip water at the stations, especially in warm weather.')
    return tips
  }
  const gels = Math.max(3, Math.round((min - 30) / 35))
  return [
    'Aim for 40–60 g of carbs per hour; practise this in your long runs.',
    `About ${gels} gels: the first around 30–35 min in, then every 30–35 min.`,
    'Drink at most stations early on; it is much harder to catch up after 30 km.',
  ]
}

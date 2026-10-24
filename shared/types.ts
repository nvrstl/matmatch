// Shapes shared by the API server and the React client.

export type RaceKey = '5k' | '10k' | 'half' | 'marathon'

export const RACES: { key: RaceKey; label: string; meters: number }[] = [
  { key: '5k', label: '5K', meters: 5000 },
  { key: '10k', label: '10K', meters: 10000 },
  { key: 'half', label: 'Half marathon', meters: 21097.5 },
  { key: 'marathon', label: 'Marathon', meters: 42195 },
]

export interface Activity {
  id: number
  date: string // local yyyy-mm-dd
  startLocal: string
  name: string
  typeKey: string
  sport: Sport
  distanceM: number
  durationS: number
  elevGainM: number | null
  avgHr: number | null
  maxHr: number | null
  calories: number | null
  trainingLoad: number | null
  vo2max: number | null
  fastest: Partial<Record<RaceKey | '1k' | 'mile', number>>
}

export type Sport = 'run' | 'bike' | 'swim' | 'walk' | 'strength' | 'other'

export interface Effort {
  activityId: number
  date: string
  name: string
  meters: number
  seconds: number
  vdot: number
  kind: 'split' | 'whole'
}

export interface Prediction {
  race: RaceKey
  label: string
  meters: number
  seconds: number
  /** plausible range, seconds */
  low: number
  high: number
  confidence: 'high' | 'medium' | 'low'
  /** human readable explanation of the inputs */
  basis: string
  /** endurance penalty applied, as a fraction (0.03 = +3%) */
  endurancePenalty: number
}

export interface PredictionResult {
  asOf: string
  vdot: number | null
  source: Effort | null
  garminVo2max: number | null
  predictions: Prediction[]
  /** same race predicted straight from Garmin's VO2max, as a cross-check */
  vo2maxPredictions: { race: RaceKey; seconds: number }[]
  bests: { race: RaceKey; allTime: Effort | null; last12m: Effort | null }[]
  notes: string[]
}

export interface Paces {
  /** seconds per km */
  easy: [number, number]
  marathon: number
  half: number
  threshold: number
  interval: number
  repetition: number
}

export interface PlanDay {
  date: string
  weekday: string
  kind: 'rest' | 'easy' | 'long' | 'threshold' | 'halfPace' | 'intervals' | 'strides' | 'race'
  title: string
  km: number
  details: string
}

export interface WeekPlan {
  weekStart: string
  phase: 'base' | 'build' | 'specific' | 'taper' | 'race' | 'recovery'
  targetKm: number
  recentWeeksKm: { weekStart: string; km: number }[]
  paces: Paces
  goalHalfSeconds: number | null
  predictedHalfSeconds: number | null
  days: PlanDay[]
  rationale: string[]
  readiness: Readiness
}

export interface Readiness {
  status: 'good' | 'caution' | 'recover' | 'unknown'
  signals: { label: string; value: string; state: 'good' | 'caution' | 'bad' | 'neutral' }[]
}

export interface LoadPoint {
  date: string
  load: number
  ctl: number
  atl: number
  tsb: number
}

export interface Settings {
  goalRaceDate: string | null
  goalHalfSeconds: number | null
  runDaysPerWeek: number
  longRunDay: number // 0 = Monday … 6 = Sunday
  restDays: number[]
  maxWeeklyKm: number | null
}

export interface SyncStatus {
  running: boolean
  phase: string
  message: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  hasKey: boolean
  counts: Record<string, number>
}

export interface Overview {
  hasData: boolean
  firstDate: string | null
  lastDate: string | null
  lifetime: { sport: Sport; count: number; km: number; hours: number }[]
  thisWeekKm: number
  lastWeekKm: number
  avg4wKm: number
  weekly: { weekStart: string; km: number }[]
  load: LoadPoint | null
  restingHr: number | null
  restingHrBaseline: number | null
  vo2max: number | null
  half: Prediction | null
  readiness: Readiness
}

export interface SeriesPoint {
  date: string
  value: number
}

export interface Progress {
  yearly: { year: number; run: number; bike: number; swim: number; other: number }[]
  monthlyRunKm: SeriesPoint[]
  halfPrediction: SeriesPoint[]
  halfRaces: SeriesPoint[]
  vo2max: SeriesPoint[]
  restingHr: SeriesPoint[]
  ctl: SeriesPoint[]
  sleepHours: SeriesPoint[]
  hrv: SeriesPoint[]
  weight: SeriesPoint[]
  steps: SeriesPoint[]
  easyPace: SeriesPoint[]
}

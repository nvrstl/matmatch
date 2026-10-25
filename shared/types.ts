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
  /** pace for the goal race: your target pace, or the predicted one without a target */
  race: number
  threshold: number
  interval: number
  repetition: number
}

export interface PlanDay {
  date: string
  weekday: string
  kind: 'rest' | 'easy' | 'long' | 'threshold' | 'halfPace' | 'racePace' | 'intervals' | 'strides' | 'race'
  title: string
  km: number
  details: string
  /** for quality sessions: the pace the work part should be run at (s/km) */
  targetPace?: number
}

export interface WeekPlan {
  weekStart: string
  phase: 'base' | 'build' | 'specific' | 'taper' | 'race' | 'recovery'
  targetKm: number
  recentWeeksKm: { weekStart: string; km: number }[]
  paces: Paces
  race: RaceKey
  goalSeconds: number | null
  predictedSeconds: number | null
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
  /** the race you're training for */
  goalRace: RaceKey
  goalRaceDate: string | null
  /** target finish time for goalRace, seconds */
  goalTimeSeconds: number | null
  /** @deprecated older settings: a half-marathon goal; read as goalRace 'half' + goalTimeSeconds */
  goalHalfSeconds?: number | null
  runDaysPerWeek: number
  longRunDay: number // 0 = Monday … 6 = Sunday
  restDays: number[]
  /** @deprecated read as weeklyKmTarget */
  maxWeeklyKm?: number | null
  /** weekly km you want to build to (the plan's peak); null: chosen from your history and the race */
  weeklyKmTarget: number | null
  /** how hard the plan pushes volume and intensity */
  planStyle: 'conservative' | 'balanced' | 'aggressive'
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

/** One run in detail, decoded from its FIT file. */
export interface WorkoutDetail {
  id: number
  /** laps as recorded on the watch (auto-laps or button presses) */
  laps: {
    index: number
    distanceM: number
    durationS: number
    avgHr: number | null
    maxHr: number | null
    elevGainM: number | null
    intensity: string | null
  }[]
  /** whole kilometres, computed from the GPS track; the last one may be partial */
  kmSplits: { km: number; distanceM: number; durationS: number; avgHr: number | null; elevGainM: number }[]
  /** downsampled trace by distance: elapsed moving time, heart rate, pace (s/km), altitude */
  trace: { d: number; t: number; hr: number | null; pace: number | null; alt: number | null }[]
  /** [lat, lon] in degrees, downsampled */
  route: [number, number][]
  /** time in each heart-rate zone using the zones set on the watch */
  hrZones: { zone: number; lowBpm: number; highBpm: number; seconds: number }[] | null
}

export interface Realism {
  level: 'likely' | 'realistic' | 'ambitious' | 'unlikely'
  /** one-line verdict */
  headline: string
  summary: string
  weeks: number
  currentVdot: number
  neededVdot: number
  /** typical fitness gain (VDOT) for this many weeks of structured training at your level */
  typicalGain: number
  /** finish time if the block goes to plan */
  projectedSeconds: number
  projectedRange: [number, number]
  predictedNowSeconds: number
  factors: string[]
}

/** Week-by-week plan from this week to race day. */
export interface TrainingBlock {
  race: RaceKey
  raceDate: string | null
  goalSeconds: number | null
  weeks: WeekPlan[]
  realism: Realism | null
  notes: string[]
}

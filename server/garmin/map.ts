// Map Garmin Personal API DTOs onto our flat tables.
import type { Activity, Sport } from '../../shared/types'

type Obj = Record<string, unknown>

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function sportOf(typeKey: string): Sport {
  const t = typeKey.toLowerCase()
  if (t.includes('run') || t === 'track_running') return 'run'
  if (t.includes('cycl') || t.includes('bik') || t.includes('ride')) return 'bike'
  if (t.includes('swim')) return 'swim'
  if (t.includes('walk') || t.includes('hik')) return 'walk'
  if (t.includes('strength') || t.includes('cardio') || t.includes('hiit') || t.includes('yoga')) return 'strength'
  return 'other'
}

/** SummarizedActivityDTO → Activity */
export function mapActivity(a: Obj): Activity | null {
  const id = num(a.activityId)
  const startLocal = typeof a.startTimeLocal === 'string' ? a.startTimeLocal : null
  if (id === null || !startLocal) return null
  const typeKey = String((a.activityType as Obj | undefined)?.typeKey ?? 'other')
  return {
    id,
    date: startLocal.slice(0, 10),
    startLocal: startLocal.replace(' ', 'T'),
    name: String(a.activityName ?? ''),
    typeKey,
    sport: sportOf(typeKey),
    distanceM: num(a.distance) ?? 0,
    durationS: num(a.movingDuration) ?? num(a.duration) ?? 0,
    elevGainM: num(a.elevationGain),
    avgHr: num(a.averageHR),
    maxHr: num(a.maxHR),
    calories: num(a.calories),
    trainingLoad: num(a.activityTrainingLoad),
    vo2max: num(a.vO2MaxValue),
    fastest: {
      '1k': num(a.fastestSplit_1000) ?? undefined,
      mile: num(a.fastestSplit_1609) ?? undefined,
      '5k': num(a.fastestSplit_5000) ?? undefined,
      '10k': num(a.fastestSplit_10000) ?? undefined,
      half: num(a.fastestSplit_21098) ?? undefined,
      marathon: num(a.fastestSplit_42195) ?? undefined,
    },
  }
}

/** UserDailySummaryV2DTO → daily row values */
export function mapDaily(d: Obj) {
  const g = (o: unknown, k: string) => num((o as Obj | undefined)?.[k])
  const movement = d.movement as Obj | undefined
  return {
    date: String(d.calendarDate).slice(0, 10),
    steps: g(movement?.steps, 'value'),
    resting_hr: g(d.heartRate, 'restingValue'),
    min_hr: g(d.heartRate, 'minValue'),
    max_hr: g(d.heartRate, 'maxValue'),
    stress_avg: g(d.stress, 'avgLevel'),
    bb_max: g(d.bodyBattery, 'maxValue'),
    bb_min: g(d.bodyBattery, 'minValue'),
    kcal_total: g(d.calories, 'burnedTotal'),
    kcal_active: g(d.calories, 'burnedActive'),
    im_moderate: g(d.intensityMinutes, 'moderate'),
    im_vigorous: g(d.intensityMinutes, 'vigorous'),
  }
}

/** DailySleepDTO → sleep row values */
export function mapSleep(s: Obj) {
  const scores = s.sleepScores as Obj | undefined
  const overall = scores?.overall as Obj | undefined
  const score = num(overall?.value) ?? num(scores?.overallScore) ?? num(scores?.overall)
  const total =
    num(s.sleepTimeSeconds) ??
    ((num(s.deepSleepSeconds) ?? 0) + (num(s.lightSleepSeconds) ?? 0) + (num(s.remSleepSeconds) ?? 0) || null)
  return {
    date: String(s.calendarDate).slice(0, 10),
    total_s: total,
    deep_s: num(s.deepSleepSeconds),
    light_s: num(s.lightSleepSeconds),
    rem_s: num(s.remSleepSeconds),
    awake_s: num(s.awakeSleepSeconds),
    score,
  }
}

/** HrvSummaryDTO → hrv row values */
export function mapHrv(h: Obj) {
  return {
    date: String(h.calendarDate).slice(0, 10),
    last_night: num(h.lastNightAvg),
    weekly_avg: num(h.weeklyAvg),
    status: typeof h.status === 'string' ? h.status : null,
  }
}

/** DateWeightDTO → weight row values */
export function mapWeight(w: Obj) {
  let kg = num(w.weight)
  // Documented as kg; older Garmin services return grams.
  if (kg !== null && kg > 1000) kg = kg / 1000
  const date =
    typeof w.calendarDate === 'string'
      ? w.calendarDate
      : typeof w.date === 'string'
        ? w.date.slice(0, 10)
        : typeof w.date === 'number'
          ? new Date(w.date).toISOString().slice(0, 10)
          : null
  return date ? { date, kg, bmi: num(w.bmi), body_fat: num(w.bodyFat) } : null
}

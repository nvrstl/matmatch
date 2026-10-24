import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addDays } from '../shared/dates'
import type { Activity, Readiness, Settings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/dataset'
import { chunks } from '../shared/chunks'
import { parseToken } from './garmin/client'
import { mapActivity } from './garmin/map'
import { chooseDays, planNextWeek } from '../shared/analytics/plan'
import { effortsOf, endurancePenalty, predictRaces } from '../shared/analytics/predict'
import { paceAt, timeFor, vdotFor } from '../shared/vdot'

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`)

test('VDOT matches Daniels tables', () => {
  near(vdotFor(5000, 19 * 60 + 57), 50, 0.3) // VDOT 50 ≈ 19:57 5K
  near(timeFor(50, 21097.5), 91 * 60 + 21, 30) // ≈ 1:31:21 HM
  near(timeFor(50, 42195), 3 * 3600 + 10 * 60 + 49, 90) // ≈ 3:10:49 M
  near(paceAt(50, 0.88), 255, 6) // T ≈ 4:15/km
})

const run = (date: string, km: number, sec: number, extra: Partial<Activity> = {}): Activity => ({
  id: Math.floor(Math.random() * 1e9), date, startLocal: `${date}T08:00:00`, name: 'Run', typeKey: 'running', sport: 'run',
  distanceM: km * 1000, durationS: sec, elevGainM: 0, avgHr: null, maxHr: null, calories: null, trainingLoad: null,
  vo2max: null, fastest: {}, ...extra,
})

test('efforts ignore treadmill and implausible paces', () => {
  assert.equal(effortsOf(run('2026-01-01', 10, 2400, { typeKey: 'treadmill_running' })).length, 0)
  assert.equal(effortsOf(run('2026-01-01', 10, 900)).length, 0) // 1:30/km
  assert.equal(effortsOf(run('2026-01-01', 10, 3000, { fastest: { '5k': 1450 } })).length, 2)
})

test('predictions come from the best recent effort and reject a GPS outlier', () => {
  const easy = Array.from({ length: 10 }, (_, i) =>
    run(`2026-09-${String(i + 10).padStart(2, '0')}`, 14, 14 * 330, { avgHr: 150, maxHr: 185 - (i % 2) }),
  )
  const acts = [
    run('2026-09-01', 10, 2460, { fastest: { '5k': 1220, '10k': 2460 } }),
    ...easy,
    run('2026-10-01', 5, 900), // 3:00/km — far beyond what heart rate says is possible
  ]
  const resting = Array.from({ length: 30 }, (_, i) => ({ date: addDays('2026-09-10', i), value: 50 }))
  const r = predictRaces(acts, resting, '2026-10-10')
  const half = r.predictions.find((p) => p.race === 'half')!
  assert.ok(r.notes.some((n) => n.includes('GPS glitch')))
  near(half.seconds / (1 + half.endurancePenalty), 5450, 120) // from the 41:00 10K
  assert.ok(half.low < half.seconds && half.high > half.seconds)
})

test('a genuine race well above training efforts is kept, not treated as an outlier', () => {
  const acts = [
    run('2026-09-27', 21.1, 5400, { fastest: { '5k': 1270, '10k': 2550, half: 5400 } }), // 1:30:00 race
    ...Array.from({ length: 20 }, (_, i) => run(`2026-09-${String(i + 1).padStart(2, '0')}`, 12, 12 * 345)),
  ]
  const r = predictRaces(acts, [], '2026-10-01')
  assert.equal(r.source?.activityId, acts[0].id)
  near(r.predictions.find((p) => p.race === 'half')!.seconds, 5400, 15)
})

test('endurance penalty only when training does not support the distance', () => {
  assert.equal(endurancePenalty('half', { weeklyKm: 50, longestRunKm: 20 }, 5000), 0)
  assert.ok(endurancePenalty('half', { weeklyKm: 15, longestRunKm: 8 }, 5000) > 0.04)
  assert.equal(endurancePenalty('marathon', { weeklyKm: 10, longestRunKm: 5 }, 42195), 0)
})

test('chooseDays keeps quality days off the day before the long run', () => {
  const d = chooseDays({ ...DEFAULT_SETTINGS, longRunDay: 6, restDays: [0, 4] }, 5)
  assert.deepEqual([d.q1, d.q2], [1, 3])
  assert.equal(d.run.length, 5)
  assert.ok(!d.run.includes(0))
})

const good: Readiness = { status: 'good', signals: [] }
const weeks = (km: number[]) =>
  km.flatMap((k, w) => [0, 2, 4].map((d) => run(addDays('2026-09-28', w * 7 + d), k / 3, (k / 3) * 330)))
test('plan builds ~8% and lands on 7 days', () => {
  const p = planNextWeek({ acts: weeks([40, 41, 40, 39]), settings: DEFAULT_SETTINGS, vdot: 48, predictedHalfSeconds: 5700, readiness: good, today: '2026-10-24' })
  assert.equal(p.days.length, 7)
  assert.equal(p.weekStart, '2026-10-26')
  near(p.targetKm, 43, 4)
  assert.equal(p.days[6].kind, 'long')
})

test('plan takes a down week after three rising weeks and in race week', () => {
  const p = planNextWeek({ acts: weeks([30, 34, 38, 42]), settings: DEFAULT_SETTINGS, vdot: 48, predictedHalfSeconds: 5700, readiness: good, today: '2026-10-24' })
  assert.equal(p.phase, 'recovery')
  const s: Settings = { ...DEFAULT_SETTINGS, goalRaceDate: '2026-11-01', goalHalfSeconds: 5600 }
  const r = planNextWeek({ acts: weeks([40, 40, 40, 40]), settings: s, vdot: 48, predictedHalfSeconds: 5700, readiness: good, today: '2026-10-24' })
  assert.equal(r.phase, 'race')
  assert.equal(r.days[6].kind, 'race')
  assert.ok(r.days.filter((d) => d.kind !== 'race').reduce((a, d) => a + d.km, 0) < 25)
})

test('sync helpers', () => {
  assert.deepEqual(chunks('2026-01-01', '2026-02-15', 31), [['2026-01-01', '2026-01-31'], ['2026-02-01', '2026-02-15']])
  assert.deepEqual(parseToken('{"access_token":"abc","expires_in":86400}'), { value: 'abc', expiresInS: 86400 })
  assert.equal(parseToken('{"accessToken":"x"}')?.value, 'x')
  const a = mapActivity({ activityId: 1, startTimeLocal: '2026-10-01 07:00:00', activityType: { typeKey: 'running' }, distance: 10000, duration: 2700, fastestSplit_5000: 1300 })
  assert.equal(a?.sport, 'run')
  assert.equal(a?.fastest['5k'], 1300)
})

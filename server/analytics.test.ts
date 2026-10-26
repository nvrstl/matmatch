import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addDays } from '../shared/dates'
import type { Activity, Readiness, Settings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/dataset'
import { chunks } from '../shared/chunks'
import { parseToken } from './garmin/client'
import { mapActivity } from './garmin/map'
import { assessGoal, chooseDays, planBlock, planNextWeek } from '../shared/analytics/plan'
import { effortsOf, endurancePenalty, predictRaces } from '../shared/analytics/predict'
import { pacingPlan } from '../shared/pacing'
import { parseTimeInput } from '../shared/timeinput'
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

test('old races hold their value while training keeps up, and fade when it drops', () => {
  const race = run('2026-05-17', 10, 2322, { fastest: { '10k': 2322, '5k': 1150 } }) // 38:42
  const weeks = (from: string, n: number, kmPerRun: number) =>
    Array.from({ length: n * 4 }, (_, i) => run(addDays(from, Math.floor(i * 1.75)), kmPerRun, kmPerRun * 300))
  const kept = [race, ...weeks('2026-04-05', 6, 15), ...weeks('2026-05-20', 22, 17)]
  const dropped = [race, ...weeks('2026-04-05', 6, 15), ...weeks('2026-05-20', 22, 4)]
  const tenK = (acts: Activity[]) => predictRaces(acts, [], '2026-10-24').predictions.find((p) => p.race === '10k')!.seconds
  near(tenK(kept), 2322, 25) // 23 weeks later, still ≈ 38:42
  assert.ok(tenK(dropped) > tenK(kept) + 45) // volume fell by ~75 %: clearly slower
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
  const p = planNextWeek({ acts: weeks([40, 41, 40, 39]), settings: DEFAULT_SETTINGS, vdot: 48, predictions: [{ race: 'half', label: 'Half marathon', meters: 21097.5, seconds: 5700, low: 5600, high: 5800, confidence: 'high', basis: '', endurancePenalty: 0 }], readiness: good, today: '2026-10-24' })
  assert.equal(p.days.length, 7)
  assert.equal(p.weekStart, '2026-10-26')
  near(p.targetKm, 45, 5) // ~8 % up; easy runs never shorter than this runner's usual, so it can run a little over
  assert.equal(p.days[6].kind, 'long')
})

test('plan takes a down week after three rising weeks and in race week', () => {
  const p = planNextWeek({ acts: weeks([30, 34, 38, 42]), settings: DEFAULT_SETTINGS, vdot: 48, predictions: [{ race: 'half', label: 'Half marathon', meters: 21097.5, seconds: 5700, low: 5600, high: 5800, confidence: 'high', basis: '', endurancePenalty: 0 }], readiness: good, today: '2026-10-24' })
  assert.equal(p.phase, 'recovery')
  const s: Settings = { ...DEFAULT_SETTINGS, goalRace: 'half', goalRaceDate: '2026-11-01', goalTimeSeconds: 5600 }
  const r = planNextWeek({ acts: weeks([40, 40, 40, 40]), settings: s, vdot: 48, predictions: [{ race: 'half', label: 'Half marathon', meters: 21097.5, seconds: 5700, low: 5600, high: 5800, confidence: 'high', basis: '', endurancePenalty: 0 }], readiness: good, today: '2026-10-24' })
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

test('pacing: splits add up to the target and checkpoints line up', () => {
  const even = pacingPlan(21097.5, 85 * 60, 'even') // 1:25:00
  assert.equal(even.km.length, 22) // 21 whole km + 97.5 m
  near(even.km.reduce((a, k) => a + k.split, 0), 5100, 0.01)
  near(even.km[0].split, 241.7, 0.1) // 4:02/km
  near(even.checkpoints.find((c) => c.label === '10K')!.cumulative, 2417, 1)
  assert.deepEqual(even.checkpoints.map((c) => c.label), ['5K', '10K', '15K', '20K', 'Finish'])
  const neg = pacingPlan(21097.5, 85 * 60, 'negative')
  near(neg.checkpoints.at(-1)!.cumulative, 5100, 0.01)
  assert.ok(neg.km[0].pace > even.km[0].pace && neg.km[20].pace < even.km[20].pace)
  near(neg.checkpoints.find((c) => c.label === '10K')!.cumulative, 2441, 1) // ~24 s behind even at 10K
  assert.equal(pacingPlan(42195, 3 * 3600, 'even').checkpoints.length, 10)
})

test('block: ends with taper and race week on the race date, realism grades the target', () => {
  const acts = weeks([40, 41, 40, 39])
  const pred = [{ race: 'half' as const, label: 'Half marathon', meters: 21097.5, seconds: 5700, low: 5600, high: 5800, confidence: 'high' as const, basis: '', endurancePenalty: 0 }]
  const mk = (goal: number | null, date = '2027-02-14') => {
    const settings: Settings = { ...DEFAULT_SETTINGS, goalRace: 'half', goalRaceDate: date, goalTimeSeconds: goal }
    const base = { acts, settings, vdot: 48, predictions: pred, readiness: good, today: '2026-10-24' }
    return planBlock({ ...base, current: planNextWeek({ ...base, which: 'current' }), next: planNextWeek(base) })
  }
  const b = mk(5640)
  assert.equal(b.weeks.at(-1)!.phase, 'race')
  assert.equal(b.weeks.at(-1)!.days.find((d) => d.kind === 'race')!.date, '2027-02-14')
  assert.equal(b.weeks.at(-2)!.phase, 'taper')
  assert.ok(b.weeks.some((w) => w.phase === 'specific') && b.weeks.some((w) => w.phase === 'build'))
  // race-pace sessions use the target pace
  const rp = b.weeks.flatMap((w) => w.days).find((d) => d.kind === 'racePace')!
  near(rp.targetPace!, 5640 / 21.0975, 0.5)
  assert.ok(['likely', 'realistic'].includes(b.realism!.level)) // 1 min faster in 16 weeks
  assert.equal(mk(4800).realism!.level, 'unlikely') // 1:20 from a 1:35 runner
  assert.equal(mk(null).realism!.headline.startsWith('If training goes to plan'), true)
})

test('realism: needing more than is typical is ambitious, far more is unlikely', () => {
  const prediction = { race: '10k' as const, label: '10K', meters: 10000, seconds: 2400, low: 0, high: 0, confidence: 'high' as const, basis: '', endurancePenalty: 0 }
  const vdot = vdotFor(10000, 2400)
  const wk = (n: number) => Array.from({ length: n }, (_, i) => ({ weekStart: addDays('2026-11-02', 7 * i), phase: 'build' as const, targetKm: 45, days: [{ kind: 'long', km: 14 }] }) as never)
  const grade = (goal: number, n: number) => assessGoal({ race: '10k', raceDate: addDays('2026-10-25', 7 * n), today: '2026-10-25', vdot, prediction, goalSeconds: goal, weeks: wk(n) }).level
  assert.equal(grade(2400, 10), 'likely')
  assert.equal(grade(2360, 12), 'likely') // -0:40 in 12 weeks
  assert.equal(grade(2330, 12), 'realistic') // -1:10
  assert.equal(grade(2300, 12), 'ambitious') // -1:40
  assert.equal(grade(2250, 12), 'unlikely') // -2:30 in 12 weeks
})

test('time and pace typed without ":" (phone keypads)', () => {
  const pace = (t: string) => parseTimeInput(t, { kind: 'pace' })
  const time = (t: string, km: number) => parseTimeInput(t, { kind: 'time', meters: km * 1000 })
  assert.equal(pace('356'), 236)
  assert.equal(pace('3.56'), 236)
  assert.equal(pace('3,56'), 236)
  assert.equal(pace('3:56'), 236)
  assert.equal(pace('4'), 240)
  assert.equal(time('12259', 21.0975), 4979)
  assert.equal(time('1.22.59', 21.0975), 4979)
  assert.equal(time('125', 21.0975), 5100) // 1:25:00
  assert.equal(time('130', 21.0975), 5400)
  assert.equal(time('310', 42.195), 11400) // 3:10:00
  assert.equal(time('31000', 42.195), 11400)
  assert.equal(time('40', 10), 2400)
  assert.equal(time('3830', 10), 2310)
  assert.equal(time('1930', 5), 1170)
  assert.equal(time('1:75:00', 21.0975), null)
  assert.equal(time('abc', 10), null)
})

test('plan style: aggressive builds higher and faster; weekly km target sets the peak', () => {
  const acts = weeks([30, 31, 30, 29])
  const pred = [{ race: 'half' as const, label: 'Half marathon', meters: 21097.5, seconds: 5700, low: 5600, high: 5800, confidence: 'high' as const, basis: '', endurancePenalty: 0 }]
  const mk = (extra: Partial<Settings>) => {
    const settings: Settings = { ...DEFAULT_SETTINGS, goalRace: 'half', goalRaceDate: '2027-03-14', goalTimeSeconds: 5600, ...extra }
    const base = { acts, settings, vdot: 48, predictions: pred, readiness: good, today: '2026-10-24' }
    const b = planBlock({ ...base, current: planNextWeek({ ...base, which: 'current' }), next: planNextWeek(base) })
    const pre = b.weeks.filter((w) => w.phase !== 'race' && w.phase !== 'taper')
    return { b, peak: Math.max(...pre.map((w) => w.targetKm)), wk5: b.weeks[5].targetKm }
  }
  const cons = mk({ planStyle: 'conservative' })
  const bal = mk({ planStyle: 'balanced' })
  const agg = mk({ planStyle: 'aggressive' })
  assert.ok(cons.peak < bal.peak && bal.peak < agg.peak, `${cons.peak} < ${bal.peak} < ${agg.peak}`)
  assert.ok(agg.wk5 > bal.wk5)
  assert.ok(agg.b.realism!.typicalGain > bal.b.realism!.typicalGain)
  const target = mk({ planStyle: 'aggressive', weeklyKmTarget: 65 })
  near(target.peak, 66, 4)
})

test('quality sessions progress through the block and intervals rotate', () => {
  const acts = weeks([45, 46, 45, 44])
  const pred = [{ race: 'half' as const, label: 'Half marathon', meters: 21097.5, seconds: 5700, low: 5600, high: 5800, confidence: 'high' as const, basis: '', endurancePenalty: 0 }]
  const settings: Settings = { ...DEFAULT_SETTINGS, goalRace: 'half', goalRaceDate: '2027-03-14', goalTimeSeconds: 5600 }
  const base = { acts, settings, vdot: 48, predictions: pred, readiness: good, today: '2026-10-24' }
  const b = planBlock({ ...base, current: planNextWeek({ ...base, which: 'current' }), next: planNextWeek(base) })
  const minutes = (t: string) => { const m = t.match(/(\d+) × (\d+) min/); return m ? +m[1] * +m[2] : 0 }
  const tempo = b.weeks.filter((w) => w.phase === 'build' || w.phase === 'specific').flatMap((w) => w.days.filter((d) => d.kind === 'threshold').map((d) => minutes(d.title)))
  assert.ok(tempo.length >= 5)
  assert.ok(tempo.at(-1)! > tempo[0], `threshold work grows: ${tempo.join(', ')}`)
  assert.ok(Math.max(...tempo) >= 30)
  const iv = new Set(b.weeks.flatMap((w) => w.days.filter((d) => d.kind === 'intervals').map((d) => d.title)))
  assert.ok(iv.size >= 3, `interval sessions vary: ${[...iv].join(' | ')}`)
})

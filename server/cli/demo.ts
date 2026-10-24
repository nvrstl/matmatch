// Generates ~12 years of believable synthetic data into data/demo.db so the dashboard can be
// explored without a Garmin key. Never touches your real database.
import { rmSync } from 'node:fs'
import { addDays, daysBetween, localToday, weekdayIndex } from '../../shared/dates'
import type { Activity } from '../../shared/types'
import { getDb, kvSet, saveSettings, tableCounts, upsertActivity } from '../db'
import { paceAt, timeFor, vo2Cost } from '../../shared/vdot'

if (!process.env.LIFELONG_DB?.includes('demo')) {
  console.error('Refusing to seed: LIFELONG_DB must point at a demo database (use `npm run demo`).')
  process.exit(1)
}
rmSync(process.env.LIFELONG_DB, { force: true })
rmSync(`${process.env.LIFELONG_DB}-wal`, { force: true })
rmSync(`${process.env.LIFELONG_DB}-shm`, { force: true })

let seed = 42
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const noise = (sd: number) => (rnd() + rnd() + rnd() - 1.5) * sd * 1.15

const today = localToday()
const start = '2013-03-04'
const end = addDays(today, -1)
const raceDate = addDays(today, 7 * 9 - weekdayIndex(today) + 6) // a Sunday ~9 weeks out

/** Fitness storyline: beginner → steady gains → 2019/20 injury → best shape → current build. */
function fitness(d: string): { vdot: number; weeklyKm: number } {
  const y = daysBetween(start, d) / 365.25
  let vdot = 35 + 12 * (1 - Math.exp(-y / 2.2))
  let km = 15 + 25 * (1 - Math.exp(-y / 2))
  if (d >= '2019-09-01' && d < '2020-06-01') {
    const k = Math.min(1, daysBetween('2019-09-01', d) / 60)
    vdot -= 5 * k
    km *= 1 - 0.75 * k
  }
  if (d >= '2020-06-01' && d < '2021-06-01') vdot -= 5 * (1 - daysBetween('2020-06-01', d) / 365)
  if (d >= '2021-06-01') {
    vdot += 3.5 * Math.min(1, daysBetween('2021-06-01', d) / 900)
    km += 10
  }
  if (d >= addDays(today, -70)) km += 6 // current half-marathon build
  const season = Math.cos(((Number(d.slice(5, 7)) - 4) / 12) * 2 * Math.PI) // spring/autumn peaks
  return { vdot: vdot + season * 0.6, weeklyKm: Math.max(6, km + season * 4) }
}

const restHrOf = (vdot: number) => Math.round(80 - vdot * 0.6)
const MAX_HR = 189
let nextId = 1_000_000_000

function makeRun(date: string, km: number, kind: 'easy' | 'long' | 'tempo' | 'intervals' | 'race', vdot: number, raceName?: string): Activity {
  const meters = km * 1000
  let secPerKm: number
  let fastest5k: number | undefined
  let fastest10k: number | undefined
  let fastestHalf: number | undefined
  switch (kind) {
    case 'race':
      secPerKm = (timeFor(vdot + noise(0.6), meters) / meters) * 1000
      break
    case 'tempo':
      secPerKm = paceAt(vdot, 0.8 + noise(0.02))
      break
    case 'intervals':
      secPerKm = paceAt(vdot, 0.76 + noise(0.02))
      break
    default:
      secPerKm = paceAt(vdot, (kind === 'long' ? 0.67 : 0.66) + noise(0.025))
  }
  const durationS = (meters / 1000) * secPerKm
  // Fastest splits inside the run: a little quicker than the average for steady runs.
  const splitFactor = kind === 'race' ? 0.998 : kind === 'tempo' ? 0.97 : 0.985
  if (meters >= 5000) fastest5k = 5 * secPerKm * splitFactor
  if (meters >= 10000) fastest10k = 10 * secPerKm * (splitFactor + 0.005)
  if (meters >= 21097) fastestHalf = 21.0975 * secPerKm * (kind === 'race' ? 1 : 0.995)
  const rest = restHrOf(vdot)
  const v = meters / (durationS / 60)
  const hrr = Math.min(0.97, (vo2Cost(v) - 3.5) / (vdot - 3.5)) + noise(0.03) + (kind === 'long' ? 0.03 : 0)
  const avgHr = Math.round(rest + hrr * (MAX_HR - rest))
  const hasHr = date >= '2015-04-01'
  return {
    id: nextId++,
    date,
    startLocal: `${date}T${kind === 'race' ? '09:30' : kind === 'long' ? '08:15' : '18:40'}:00`,
    name: raceName ?? { easy: 'Easy run', long: 'Long run', tempo: 'Tempo run', intervals: 'Track intervals', race: 'Race' }[kind],
    typeKey: kind === 'intervals' && rnd() < 0.3 ? 'track_running' : 'running',
    sport: 'run',
    distanceM: Math.round(meters),
    durationS: Math.round(durationS),
    elevGainM: Math.round(meters / 1000 * (4 + rnd() * 8)),
    avgHr: hasHr ? avgHr : null,
    maxHr: hasHr ? Math.min(MAX_HR, avgHr + 8 + Math.round(rnd() * (kind === 'race' ? 12 : 8))) : null,
    calories: Math.round(km * 68),
    trainingLoad: date >= '2017-06-01' ? Math.round((durationS / 60) * hrr * 0.64 * Math.exp(1.92 * hrr)) : null,
    vo2max: date >= '2016-03-01' ? Math.round(vdot + 1.5 + noise(0.7)) : null,
    fastest: {
      '5k': fastest5k && Math.round(fastest5k),
      '10k': fastest10k && Math.round(fastest10k),
      half: fastestHalf && Math.round(fastestHalf),
    },
  }
}

const db = getDb()
db.exec('BEGIN')
const insDaily = db.prepare('INSERT INTO daily (date, steps, resting_hr, min_hr, max_hr, stress_avg, bb_max, bb_min) VALUES (?,?,?,?,?,?,?,?)')
const insSleep = db.prepare('INSERT INTO sleep (date, total_s, deep_s, light_s, rem_s, awake_s, score) VALUES (?,?,?,?,?,?,?)')
const insHrv = db.prepare('INSERT INTO hrv (date, last_night, weekly_avg, status) VALUES (?,?,?,?)')
const insWeight = db.prepare('INSERT INTO weight (date, kg) VALUES (?,?)')

let weightKg = 79
let hrvWeek: number[] = []
for (let week = start; week <= end; week = addDays(week, 7)) {
  const { vdot, weeklyKm } = fitness(week)
  const wk = weeklyKm * (1 + noise(0.12)) * (rnd() < 0.08 ? 0.4 : 1) // occasional missed week
  const longKm = Math.max(6, Math.min(26, wk * 0.32))
  const plan: [number, 'easy' | 'long' | 'tempo' | 'intervals', number][] = [[6, 'long', longKm]]
  const rest = wk - longKm
  if (wk > 22) plan.push([1, rnd() < 0.5 ? 'tempo' : 'intervals', Math.max(6, rest * 0.33)])
  const easyCount = wk > 40 ? 3 : wk > 22 ? 2 : 1
  const easyDays = [3, 4, 2].slice(0, easyCount)
  const used = plan.reduce((a, p) => a + (p[0] === 6 ? 0 : p[2]), 0)
  for (const d of easyDays) plan.push([d, 'easy', Math.max(4, (rest - used) / easyCount)])

  for (const [dow, kind, km] of plan) {
    const date = addDays(week, dow)
    if (date > end || rnd() < 0.06) continue
    let a: Activity
    const month = Number(date.slice(5, 7))
    const isHalfRace = dow === 6 && (month === 4 || month === 10) && Number(date.slice(8, 10)) <= 7 && date >= '2014-09-01' && !(date >= '2019-09-01' && date < '2021-03-01')
    const isTenK = dow === 6 && (month === 6 || month === 12) && Number(date.slice(8, 10)) <= 7
    const isParkrun = dow === 5 && rnd() < 0.12
    if (isHalfRace) a = makeRun(date, 21.1, 'race', vdot, `${date.slice(0, 4)} ${month === 4 ? 'Spring' : 'Autumn'} Half Marathon`)
    else if (isTenK) a = makeRun(date, 10.0, 'race', vdot, `${month === 6 ? 'Midsummer' : 'Winter'} 10K`)
    else a = makeRun(date, Math.round(km * 10) / 10, kind, vdot)
    upsertActivity(a, undefined)
    if (isParkrun) upsertActivity(makeRun(addDays(week, 5), 5.0, 'race', vdot, 'parkrun'), undefined)
  }
  // Summer cycling + the odd swim
  const month = Number(week.slice(5, 7))
  if (month >= 5 && month <= 9 && rnd() < 0.5) {
    const hours = 1 + rnd() * 2
    upsertActivity({ id: nextId++, date: addDays(week, 5), startLocal: `${addDays(week, 5)}T10:00:00`, name: 'Road ride', typeKey: 'road_biking', sport: 'bike', distanceM: Math.round(hours * 27000), durationS: Math.round(hours * 3600), elevGainM: Math.round(hours * 300), avgHr: null, maxHr: null, calories: Math.round(hours * 550), trainingLoad: week >= '2017-06-01' ? Math.round(hours * 70) : null, vo2max: null, fastest: {} }, undefined)
  }
  if (rnd() < 0.15) {
    upsertActivity({ id: nextId++, date: addDays(week, 0), startLocal: `${week}T07:00:00`, name: 'Pool swim', typeKey: 'lap_swimming', sport: 'swim', distanceM: 1500 + Math.round(rnd() * 1000), durationS: 2400 + Math.round(rnd() * 900), elevGainM: null, avgHr: null, maxHr: null, calories: 350, trainingLoad: null, vo2max: null, fastest: {} }, undefined)
  }
  if (rnd() < 0.4) upsertActivity({ id: nextId++, date: addDays(week, 1), startLocal: `${addDays(week, 1)}T19:00:00`, name: 'Strength', typeKey: 'strength_training', sport: 'strength', distanceM: 0, durationS: 2400, elevGainM: null, avgHr: null, maxHr: null, calories: 220, trainingLoad: null, vo2max: null, fastest: {} }, undefined)

  // Wellness, day by day
  for (let i = 0; i < 7; i++) {
    const date = addDays(week, i)
    if (date > end) break
    const rhr = restHrOf(vdot) + Math.round(noise(1.5))
    if (date >= '2015-04-01') {
      insDaily.run(date, Math.round(8500 + noise(2500)), rhr, rhr - 4, 150 + Math.round(rnd() * 30), date >= '2016-01-01' ? Math.round(30 + noise(8)) : null, date >= '2018-01-01' ? Math.round(75 + noise(15)) : null, date >= '2018-01-01' ? Math.round(15 + noise(8)) : null)
    }
    if (date >= '2016-01-01') {
      const total = Math.round((7.1 + noise(0.6) - (i === 4 || i === 5 ? 0.3 : 0)) * 3600)
      insSleep.run(date, total, Math.round(total * 0.18), Math.round(total * 0.55), Math.round(total * 0.22), Math.round(900 + rnd() * 900), date >= '2020-01-01' ? Math.round(78 + noise(9)) : null)
    }
    if (date >= '2021-06-01') {
      const v = Math.round(40 + (vdot - 45) * 1.5 + noise(6))
      hrvWeek = [...hrvWeek.slice(-6), v]
      const avg = Math.round(hrvWeek.reduce((a, b) => a + b, 0) / hrvWeek.length)
      insHrv.run(date, v, avg, avg < 36 ? 'UNBALANCED' : 'BALANCED')
    }
    if (date >= '2015-01-01' && rnd() < 0.12) {
      weightKg += noise(0.25) - (weightKg - (78 - (vdot - 40) * 0.25)) * 0.05
      insWeight.run(date, Math.round(weightKg * 10) / 10)
    }
  }
}
db.exec('COMMIT')

const predictedGoal = Math.round((timeFor(fitness(today).vdot + 1.2, 21097.5)) / 30) * 30
saveSettings({ goalRaceDate: raceDate, goalHalfSeconds: predictedGoal, runDaysPerWeek: 5, longRunDay: 6, restDays: [0, 4] })
kvSet('last_sync', { finishedAt: new Date().toISOString(), error: null })
console.log('Demo data written to', process.env.LIFELONG_DB, tableCounts())

// Decode an activity's original file (a zip holding a .fit) into the workout detail view.
import { Decoder, Stream } from '@garmin/fitsdk'
import { unzipSync } from 'fflate'
import type { WorkoutDetail } from '../../shared/types.js'

type Rec = {
  timestamp?: Date | string
  distance?: number
  heartRate?: number
  enhancedSpeed?: number
  speed?: number
  enhancedAltitude?: number
  altitude?: number
  positionLat?: number
  positionLong?: number
}
type Msgs = Record<string, Record<string, unknown>[]>

const SEMI = 180 / 2 ** 31 // FIT stores positions in semicircles
const time = (t: Date | string | undefined) => (t ? new Date(t).getTime() / 1000 : NaN)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function decodeActivityFile(bytes: Uint8Array, id: number): WorkoutDetail {
  // Garmin serves the original upload: usually a zip with one .fit inside, sometimes a bare .fit.
  let fit = bytes
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entry = Object.entries(unzipSync(bytes)).find(([name]) => name.toLowerCase().endsWith('.fit'))
    if (!entry) throw new Error('No FIT file in the download.')
    fit = entry[1]
  }
  const decoder = new Decoder(Stream.fromByteArray(fit))
  if (!decoder.isFIT()) throw new Error('Not a FIT file.')
  const messages = decoder.read().messages as unknown as Msgs
  const recs = ((messages.recordMesgs ?? []) as Rec[]).filter((r) => r.timestamp && typeof r.distance === 'number')

  // Moving time per record: pauses (gaps > 10 s with almost no distance) don't count.
  const moving: number[] = []
  let t = 0
  for (let i = 0; i < recs.length; i++) {
    if (i > 0) {
      const dt = time(recs[i].timestamp) - time(recs[i - 1].timestamp)
      const dd = recs[i].distance! - recs[i - 1].distance!
      if (dt > 0 && !(dt > 10 && dd < dt * 0.5)) t += dt
    }
    moving.push(t)
  }

  // Whole-km splits, interpolating the moment each kilometre is crossed.
  const kmSplits: WorkoutDetail['kmSplits'] = []
  let segStart = 0
  let segStartT = 0
  let hrSum = 0
  let hrN = 0
  let gain = 0
  const alt = (r: Rec) => num(r.enhancedAltitude) ?? num(r.altitude)
  let ref: number | null = null // altitude anchor: climbs count once they exceed 2 m (GPS noise)
  for (let i = 1; i < recs.length; i++) {
    const r = recs[i]
    if (r.heartRate) {
      hrSum += r.heartRate
      hrN++
    }
    const a1 = alt(r)
    if (a1 !== null) {
      if (ref === null || a1 < ref) ref = a1
      else if (a1 - ref >= 2) {
        gain += a1 - ref
        ref = a1
      }
    }
    const nextKm = (kmSplits.length + 1) * 1000
    if (r.distance! >= nextKm) {
      const d0 = recs[i - 1].distance!
      const f = (nextKm - d0) / (r.distance! - d0 || 1)
      const tCross = moving[i - 1] + f * (moving[i] - moving[i - 1])
      kmSplits.push({ km: kmSplits.length + 1, distanceM: nextKm - segStart, durationS: tCross - segStartT, avgHr: hrN ? Math.round(hrSum / hrN) : null, elevGainM: Math.round(gain) })
      segStart = nextKm
      segStartT = tCross
      hrSum = hrN = gain = 0
    }
  }
  const last = recs[recs.length - 1]
  if (last && last.distance! - segStart > 50) {
    kmSplits.push({ km: kmSplits.length + 1, distanceM: last.distance! - segStart, durationS: moving[moving.length - 1] - segStartT, avgHr: hrN ? Math.round(hrSum / hrN) : null, elevGainM: Math.round(gain) })
  }

  // Trace: ~400 points, pace from distance covered over a ±15 s moving window.
  const step = Math.max(1, Math.floor(recs.length / 400))
  const trace: WorkoutDetail['trace'] = []
  for (let i = 0, j0 = 0, j1 = 0; i < recs.length; i += step) {
    while (moving[i] - moving[j0] > 15) j0++
    while (j1 < recs.length - 1 && moving[j1 + 1] - moving[i] <= 15) j1++
    const dd = recs[j1].distance! - recs[j0].distance!
    const dt = moving[j1] - moving[j0]
    const pace = dd > 5 && dt > 0 ? (dt / dd) * 1000 : null
    trace.push({
      d: Math.round(recs[i].distance!),
      t: Math.round(moving[i]),
      hr: recs[i].heartRate ?? null,
      pace: pace && pace > 120 && pace < 900 ? Math.round(pace) : null,
      alt: alt(recs[i]) === null ? null : Math.round(alt(recs[i])! * 10) / 10,
    })
  }

  const withPos = recs.filter((r) => typeof r.positionLat === 'number' && typeof r.positionLong === 'number')
  const rStep = Math.max(1, Math.floor(withPos.length / 300))
  const route = withPos
    .filter((_, i) => i % rStep === 0 || i === withPos.length - 1)
    .map((r) => [r.positionLat! * SEMI, r.positionLong! * SEMI] as [number, number])

  const laps = (messages.lapMesgs ?? []).map((l, index) => ({
    index: index + 1,
    distanceM: num(l.totalDistance) ?? 0,
    durationS: num(l.totalTimerTime) ?? num(l.totalElapsedTime) ?? 0,
    avgHr: num(l.avgHeartRate),
    maxHr: num(l.maxHeartRate),
    elevGainM: num(l.totalAscent),
    intensity: typeof l.intensity === 'string' ? l.intensity : null,
  }))

  // Garmin's own time-in-zone for the whole session, with the zones set on the watch.
  const tz = (messages.timeInZoneMesgs ?? []).find((z) => z.referenceMesg === 'session')
  const bounds = tz?.hrZoneHighBoundary as number[] | undefined
  const secs = tz?.timeInHrZone as number[] | undefined
  const hrZones =
    bounds && secs && bounds.length >= 6
      ? [1, 2, 3, 4, 5].map((z) => ({
          zone: z,
          lowBpm: bounds[z - 1],
          highBpm: bounds[z],
          // time below zone 1 is counted as zone 1
          seconds: Math.round((secs[z] ?? 0) + (z === 1 ? (secs[0] ?? 0) : 0) + (z === 5 ? (secs[6] ?? 0) : 0)),
        }))
      : null

  return { id, laps, kmSplits, trace, route, hrZones }
}

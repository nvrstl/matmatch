// Jack Daniels' VDOT model (Daniels & Gilbert, "Oxygen Power", 1979).
// VDOT = VO2 cost of the race pace / fraction of VO2max sustainable for that duration.

/** Oxygen cost (ml/kg/min) of running at v metres per minute. */
export const vo2Cost = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v

/** Fraction of VO2max sustainable for t minutes. */
export const sustainable = (t: number) =>
  0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t)

export function vdotFor(meters: number, seconds: number): number {
  const t = seconds / 60
  return vo2Cost(meters / t) / sustainable(t)
}

/** Race time (s) at which `meters` is run at the given VDOT. */
export function timeFor(vdot: number, meters: number): number {
  // vdotFor is monotonically decreasing in time → bisection.
  let lo = meters / 10 // 10 m/s, faster than any human
  let hi = meters / 0.8
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (vdotFor(meters, mid) > vdot) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Speed (m/min) whose oxygen cost equals `vo2`. */
export function speedForVo2(vo2: number): number {
  const a = 0.000104
  const b = 0.182258
  const c = -4.6 - vo2
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a)
}

/** Pace in seconds per km at a given fraction of VDOT. */
export const paceAt = (vdot: number, fraction: number) => 60_000 / speedForVo2(vdot * fraction)

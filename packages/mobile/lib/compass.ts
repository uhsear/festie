// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Exponential low-pass smoothing of a heading in degrees, done on the unit
 * circle so it wraps correctly across the 0/360 seam (naive averaging would
 * jump halfway around when crossing north). alpha in (0,1]; smaller = smoother.
 */
export function smoothHeading(prev: number | null, next: number, alpha: number): number {
  if (prev == null || !Number.isFinite(prev)) return next;
  const pr = (prev * Math.PI) / 180;
  const nx = (next * Math.PI) / 180;
  const sinv = (1 - alpha) * Math.sin(pr) + alpha * Math.sin(nx);
  const cosv = (1 - alpha) * Math.cos(pr) + alpha * Math.cos(nx);
  const deg = (Math.atan2(sinv, cosv) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** True heading when known (expo-location reports -1 when unknown), else magnetic, in [0, 360). */
export function headingFromReading(r: { trueHeading: number; magHeading: number }): number {
  if (Number.isFinite(r.trueHeading) && r.trueHeading >= 0) return r.trueHeading;
  return ((r.magHeading % 360) + 360) % 360;
}

/** expo-location compass accuracy is a level 0 (none) to 3 (high); 0 and 1 need calibration. */
export function needsCalibration(accuracy: number): boolean {
  return accuracy <= 1;
}

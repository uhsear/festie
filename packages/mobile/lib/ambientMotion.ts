/**
 * Whether an ambient (looping, decorative) animation may run. Both OS Reduce
 * Motion and festival low-power mode park every loop; `live` lets a caller
 * also park when the thing it signals is not happening.
 */
export function shouldPulse({
  live = true,
  reduceMotion,
  lowPowerMode,
}: {
  live?: boolean;
  reduceMotion: boolean;
  lowPowerMode: boolean;
}): boolean {
  return live && !reduceMotion && !lowPowerMode;
}

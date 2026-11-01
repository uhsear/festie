export const scrubToken = (s?: string) => s?.replace(/([?&]token=)[^&#]*/g, '$1[redacted]');

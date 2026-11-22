/** Megabytes the way the offline card shows them: decimal, so it matches the "map N MB" size note. */
const mb = (bytes: number, round: (n: number) => number) => Math.max(1, round(bytes / 1_000_000));

export const OFFLINE_MAP_COPY = {
  // Needed rounds up and free rounds down, so the message never claims "needs 100 MB, 100 MB free".
  notEnoughSpace: (neededBytes: number, freeBytes: number) =>
    `Not enough free space to save the map (needs ${mb(neededBytes, Math.ceil)} MB, ${Math.max(0, Math.floor(freeBytes / 1_000_000))} MB free). Free up some space and try again.`,
  // Used when the archive size is unknown (the size lookup failed before the write did).
  notEnoughSpaceUnknownSize: 'Not enough free space to save the map. Free up some space and try again.',
  siteplanNeedsConnection: 'The site plan needs a connection. The base map still works offline.',
} as const;

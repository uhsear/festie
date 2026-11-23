import net from 'net';

/**
 * Rate-limit and lockout key for a client IP. IPv6 clients usually control a whole /64, so every
 * address in one /64 maps to one key; IPv4 (and 'unknown') pass through unchanged.
 */
export function clientIpKey(ip: string): string {
  if (!net.isIPv6(ip)) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  // A dotted IPv4 tail only occupies the last two groups, so rewriting it as hex keeps the first four intact.
  const hexTail = ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_m, a, b, c, d) =>
    `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`,
  );
  const [head = '', tail] = hexTail.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const groups = tail === undefined ? headGroups : [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill('0'), ...tailGroups];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

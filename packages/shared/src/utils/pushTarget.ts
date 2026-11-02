export type PushScreen =
  | 'picks'
  | 'compare'
  | 'wrap'
  | 'crew-plan'
  | 'festival-mode'
  | 'find'
  | 'grid'
  | 'map'
  | 'plan-share'
  | 'privacy'
  | 'timeline';

export type PushTarget =
  | { kind: 'set'; setId: string }
  | { kind: 'festival'; festivalId: string }
  | { kind: 'crew'; sosUserId?: string }
  | { kind: 'join'; code: string }
  | { kind: 'screen'; screen: PushScreen };

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PREFIXES = ['festie://', 'rave://', 'https://festie.us'];
const SCREENS: readonly string[] = [
  'picks',
  'compare',
  'wrap',
  'crew-plan',
  'festival-mode',
  'find',
  'grid',
  'map',
  'plan-share',
  'privacy',
  'timeline',
];

function validId(v: string | null | undefined): string | null {
  return v && ID_RE.test(v) ? v : null;
}

function fromLink(link: string): PushTarget | null {
  const prefix = PREFIXES.find((p) => link.startsWith(p));
  if (!prefix) return null;
  const [rawPath = '', rawQuery = ''] = (link.slice(prefix.length).split('#')[0] ?? '').split('?');
  const [head, a, b, c] = rawPath.split('/').filter(Boolean);
  const query = new URLSearchParams(rawQuery);

  if (head === undefined) {
    const id = validId(query.get('festival'));
    return id ? { kind: 'festival', festivalId: id } : null;
  }
  if (head === 'set') {
    const id = validId(a);
    return id ? { kind: 'set', setId: id } : null;
  }
  if (head === 'festival') {
    const festivalId = validId(a);
    if (!festivalId) return null;
    const setId = validId(query.get('set'));
    if (setId) return { kind: 'set', setId };
    if (b === 'profile' && validId(c)) return { kind: 'screen', screen: 'compare' };
    return { kind: 'festival', festivalId };
  }
  if (head === 'crew') {
    const sosUserId = validId(query.get('sos'));
    return sosUserId ? { kind: 'crew', sosUserId } : { kind: 'crew' };
  }
  if (head === 'join') {
    const code = validId(a);
    return code ? { kind: 'join', code } : null;
  }
  if (head === 'compare' || head === 'crew-compare') return { kind: 'screen', screen: 'compare' };
  if (SCREENS.includes(head)) return { kind: 'screen', screen: head as PushScreen };
  return null;
}

/** Turn a push `data` payload into the screen it should open. */
export function resolvePushTarget(data: Record<string, unknown> | undefined): PushTarget | null {
  if (!data) return null;
  if (typeof data.deepLink === 'string') {
    const t = fromLink(data.deepLink);
    if (t) return t;
  }
  const setId = typeof data.setId === 'string' ? validId(data.setId) : null;
  if (setId) return { kind: 'set', setId };
  const festivalId = typeof data.festivalId === 'string' ? validId(data.festivalId) : null;
  return festivalId ? { kind: 'festival', festivalId } : null;
}

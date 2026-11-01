import type { PushTarget } from '@festie/shared/utils';

export type DeepLinkTarget = string | { pathname: string; params: Record<string, string> };

/** The expo-router href for a resolved push target. */
export function pushTargetHref(target: PushTarget): DeepLinkTarget {
  switch (target.kind) {
    case 'set':
      return `/set/${target.setId}`;
    case 'festival':
      return '/(tabs)';
    case 'crew':
      return '/(tabs)/crew';
    case 'join':
      return `/join/${target.code}`;
    case 'screen':
      if (target.screen === 'compare') return '/crew-compare';
      if (target.screen === 'picks') return '/(tabs)/picks';
      return `/${target.screen}`;
  }
}

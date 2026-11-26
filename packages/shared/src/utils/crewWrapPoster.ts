/**
 * What the crew wrap poster says. Money is opt-in: with it off, no string in
 * the result holds an amount, and the biggest-spender spotlight is replaced by
 * the crew's favourite set.
 */
import type { CrewWrapData, CrewWrapSeenTogether } from '../types/crewWrap';
import { formatAmount } from './money';

export interface CrewPosterContent {
  dominant: { value: string; label: string };
  spotlight: { label: string; value: string; sub?: string };
  stats: { label: string; value: string }[];
  seenTogether: CrewWrapSeenTogether[];
}

export function crewPosterContent(wrap: CrewWrapData, { showMoney }: { showMoney: boolean }): CrewPosterContent {
  const stats = [
    { label: 'Crew', value: String(wrap.memberCount) },
    { label: 'Seen together', value: String(wrap.setsSeenTogether.length) },
  ];
  const currency = wrap.currency ?? 'USD';
  const count = wrap.setsSeenTogether.length;
  const dominant = { value: String(count), label: count === 1 ? 'set loved together' : 'sets loved together' };
  if (showMoney) {
    const spender = wrap.biggestSpender;
    return {
      dominant,
      spotlight: {
        label: 'Biggest spender',
        value: spender ? spender.name : 'No expenses yet',
        ...(spender ? { sub: `fronted ${formatAmount(spender.amount, currency)}` } : {}),
      },
      stats: [...stats, { label: 'Split', value: formatAmount(wrap.totalSplit, currency) }],
      seenTogether: wrap.setsSeenTogether.slice(0, 5),
    };
  }
  const favourite = wrap.setsSeenTogether[0];
  return {
    dominant,
    spotlight: favourite
      ? {
          label: 'Crew favourite',
          value: favourite.artist ?? 'A set you all loved',
          sub: `${favourite.count} of you loved it`,
        }
      : { label: 'Crew favourite', value: 'Rate sets together to find yours' },
    stats,
    seenTogether: wrap.setsSeenTogether.slice(1, 6),
  };
}

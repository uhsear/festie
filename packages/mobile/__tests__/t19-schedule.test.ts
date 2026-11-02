// Source-level guards for T19 packet t19-mobile-schedule.
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('T19 mobile schedule guards', () => {
  it('SetCardMobile uses the festival separator and offers a Listen button', () => {
    const src = read('components/SetCardMobile.tsx');
    expect(src).toContain('artistDisplayName(set, b2bSeparator)');
    expect(src).toContain('Listen to');
  });

  it('Schedule orders by time, shows day dates and the shared band', () => {
    const src = read('app/(tabs)/index.tsx');
    expect(src).toContain('splitCardsByNow(');
    expect(src).toContain('formatDayChip(');
    expect(src).toContain('getHomeActions(');
    expect(src).not.toContain('getSetHotness');
  });

  it.each(['components/SetCardMobile.tsx', 'app/crew-plan.tsx'])('%s shows start - end on each set row', (rel) => {
    expect(read(rel)).toContain('formatSetTimeRange(');
  });

  it('Picks offers the Listen before you go list with Spotify link-outs and share as text', () => {
    const src = read('app/(tabs)/picks.tsx');
    expect(src).toContain('buildListenList(');
    expect(src).toContain('listenListText(');
    expect(src).toContain('Listen before you go');
  });

  it('Picks passes the separator to the card', () => {
    expect(read('app/(tabs)/picks.tsx')).toContain('b2bSeparator=');
  });

  it('FestivalList groups festivals with the shared helper', () => {
    expect(read('components/FestivalList.tsx')).toContain('groupFestivalsByStatus(');
  });
});

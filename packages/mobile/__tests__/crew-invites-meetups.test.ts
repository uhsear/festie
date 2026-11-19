import { describe, expect, it } from 'vitest';
import { read } from './read-source';


describe('t54 mobile crew invites and meet-ups', () => {
  it('SmsHandoff uses the shared SMS builder and picker', () => {
    const src = read('components/SmsHandoff.tsx');
    expect(src).toContain('buildHandoffSms');
    expect(src).toContain('pickShareMeetingPoint');
    expect(src).not.toContain('function buildMessage');
    expect(src).not.toContain('function pickMeetingPoint');
  });

  it('PlanQRShare passes planB', () => {
    expect(read('components/PlanQRShare.tsx')).toMatch(/planB[,\s]/);
    expect(read('components/PlanQRShare.tsx')).toContain('buildPlanSnapshotInput(');
  });

  it('CrewLockRow uses typeStyle, MAX_FONT_SCALE and AppSwitch', () => {
    const src = read('components/CrewLockRow.tsx');
    expect(src).toContain('typeStyle');
    expect(src).toContain('MAX_FONT_SCALE');
    expect(src).toContain('AppSwitch');
  });

  it('join screen uses inviteIsDead', () => {
    expect(read('app/join/[code].tsx')).toContain('inviteIsDead(');
  });

  it('crew screen renders CrewLockRow once', () => {
    const src = read('app/(tabs)/crew.tsx');
    expect(src.match(/<CrewLockRow\b/g)).toHaveLength(1);
  });
});

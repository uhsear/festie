import { describe, expect, it } from 'vitest';
import { read } from './read-source';


describe('T24 mobile polls source guard', () => {
  it('CrewPollCard ends polls with a lock, not a trash can', () => {
    const src = read('components/CrewPollCard.tsx');
    expect(src).toContain('lock-closed-outline');
    expect(src).toContain('End poll');
    expect(src).not.toContain('trash-outline');
  });

  it('CrewPolls groups decided polls and offers the Meet where template', () => {
    const src = read('components/CrewPolls.tsx');
    expect(src).toContain('splitPolls');
    expect(src).toContain('nextVoteIndexes');
    expect(src).toContain('Decided (');
    expect(src).toContain('Meet where?');
  });

  it.each(['components/CrewPollCard.tsx', 'components/CrewPolls.tsx'])('%s does not import socket.io-client', (f) => {
    expect(read(f)).not.toContain('socket.io-client');
  });
});

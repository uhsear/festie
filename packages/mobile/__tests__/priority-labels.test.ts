import { describe, it, expect } from 'vitest';
import { read } from './read-source';


describe('t11 priority labels source guards', () => {
  it.each(['components/SetCardMobile.tsx', 'components/TBASection.tsx'])('%s does not append (selected)', (file) => {
    expect(read(file)).not.toContain('(selected');
  });
});

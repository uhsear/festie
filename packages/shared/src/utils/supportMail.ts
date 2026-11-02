import { SUPPORT_EMAIL } from '../constants/accountCopy';

export function buildSupportMailto(info: {
  platform: 'web' | 'ios' | 'android';
  version: string;
  device: string;
  username?: string | null;
}): string {
  const lines = [
    '',
    '',
    '',
    '---',
    'Please keep these lines. They help us find the problem.',
    `App: Festie ${info.platform} ${info.version}`,
    `Device: ${info.device}`,
  ];
  if (info.username) lines.push(`Username: ${info.username}`);
  const enc = encodeURIComponent;
  return `mailto:${SUPPORT_EMAIL}?subject=${enc('Festie support')}&body=${enc(lines.join('\n'))}`;
}

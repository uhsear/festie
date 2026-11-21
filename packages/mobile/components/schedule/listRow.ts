import type { FestivalSet } from '@festie/shared/types';

export type ListRow =
  | { kind: 'groupHeader'; key: string; label: string; stageColor?: string }
  | { kind: 'earlier'; key: 'earlier'; count: number }
  | { kind: 'set'; key: string; set: FestivalSet };

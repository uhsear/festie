import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { Priority } from '@festie/shared/types';

export interface SetPickMenuProps {
  current: Priority | null;
  onPick: (next: Priority | null) => void;
  /** Absolute box of the cell. The native hosts need it because they take the cell's place in the column. */
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}

/** Web and fallback: no native menu, so the cell renders in its own box. */
export default function SetPickMenu({ style, children }: SetPickMenuProps) {
  return <View style={style}>{children}</View>;
}

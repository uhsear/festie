import { cloneElement, useState, type ReactElement } from 'react';
import { Host, DropdownMenu, DropdownMenuItem, Text, RNHostView } from '@expo/ui/jetpack-compose';
import { pickMenuItems, nextPickFromMenu } from '@festie/shared/utils';
import { useHaptics } from '../hooks/useHaptics';
import type { SetPickMenuProps } from './SetPickMenu';

/**
 * Android: Compose has no long-press context menu, so the dropdown is controlled and the
 * child's onLongPress opens it. Compose has no selected state, so the chosen item gets a check prefix.
 */
export default function SetPickMenu({ current, onPick, style, children }: SetPickMenuProps) {
  const haptics = useHaptics();
  const [open, setOpen] = useState(false);
  const child = cloneElement(children as ReactElement<{ onLongPress?: () => void }>, {
    onLongPress: () => setOpen(true),
  });
  return (
    <Host style={style}>
      <DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)}>
        <DropdownMenu.Items>
          {pickMenuItems(current).map((item) => (
            <DropdownMenuItem
              key={item.key}
              onClick={() => {
                setOpen(false);
                haptics.select();
                onPick(nextPickFromMenu(current, item.key));
              }}
            >
              <DropdownMenuItem.Text>
                <Text>{item.selected ? `\u2713 ${item.label}` : item.label}</Text>
              </DropdownMenuItem.Text>
            </DropdownMenuItem>
          ))}
        </DropdownMenu.Items>
        <DropdownMenu.Trigger>
          <RNHostView matchContents={false}>{child}</RNHostView>
        </DropdownMenu.Trigger>
      </DropdownMenu>
    </Host>
  );
}

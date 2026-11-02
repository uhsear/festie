import type { ReactElement } from 'react';
import { Host, ContextMenu, Button, RNHostView } from '@expo/ui/swift-ui';
import { pickMenuItems, nextPickFromMenu } from '@festie/shared/utils';
import { useHaptics } from '../hooks/useHaptics';
import type { SetPickMenuProps } from './SetPickMenu';

/** iOS: a native context menu opens on long press; a short tap reaches the RN cell inside. */
export default function SetPickMenu({ current, onPick, style, children }: SetPickMenuProps) {
  const haptics = useHaptics();
  return (
    <Host style={style}>
      <ContextMenu>
        <ContextMenu.Items>
          {pickMenuItems(current).map((item) => (
            <Button
              key={item.key}
              label={item.label}
              systemImage={item.selected ? 'checkmark' : undefined}
              onPress={() => {
                haptics.select();
                onPick(nextPickFromMenu(current, item.key));
              }}
            />
          ))}
        </ContextMenu.Items>
        <ContextMenu.Trigger>
          <RNHostView matchContents={false}>{children as ReactElement}</RNHostView>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  );
}

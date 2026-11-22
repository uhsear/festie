import { useRef, type HTMLAttributes } from 'react';
import { useRovingTabs } from '@/hooks/useRovingTabs';

interface RovingGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** 'tab' for a tablist, 'radio' for a radiogroup. Items need role and aria-selected or aria-checked. */
  itemRole: 'tab' | 'radio';
}

/** A tablist or radiogroup with one tab stop and arrow-key movement between its items. */
export default function RovingGroup({ itemRole, ...props }: RovingGroupProps) {
  const ref = useRef<HTMLDivElement>(null);
  useRovingTabs(ref, false, itemRole);
  return <div ref={ref} {...props} />;
}

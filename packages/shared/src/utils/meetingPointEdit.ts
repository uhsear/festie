import { COPY, meetingPointEditedBy, meetingPointEditedNoName } from '../constants/copy';
import type { CrewMeetingPoint } from '../types/domain';
import { meetingTimeDisplay } from './meetingTime';

/**
 * "Edited by ana, was Sat 3:00 PM" line for a meeting point, or null when the
 * latest time/place edit left no trail. Time reads in the festival zone when given.
 */
export function meetingPointEditLine(
  point: Pick<CrewMeetingPoint, 'edit_was' | 'editor_name' | 'recurs_daily'>,
  opts: { timeZone?: string; now?: Date } = {},
): string | null {
  const was = point.edit_was;
  if (!was) return null;
  const hasLocation = typeof was.location === 'string';
  const hasTime = 'meetAt' in was;
  if (!hasLocation && !hasTime) return null;

  const parts: string[] = [];
  if (hasLocation) parts.push(was.location as string);
  if (hasTime) {
    const label = was.meetAt
      ? meetingTimeDisplay(was.meetAt, point.recurs_daily, [], opts.now, opts.timeZone).label
      : '';
    parts.push(label || COPY.meetingPoint.noTime);
  }
  const text = parts.join(' at ');
  return point.editor_name ? meetingPointEditedBy(point.editor_name, text) : meetingPointEditedNoName(text);
}

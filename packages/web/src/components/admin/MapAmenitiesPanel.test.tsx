import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AMENITY_PALETTE } from '@festie/shared/utils';
import MapAmenitiesPanel from './MapAmenitiesPanel';

const feature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [1, 2] },
  properties: { id: 'a1', amenityType: AMENITY_PALETTE[0], label: 'North taps' },
} as never;

describe('MapAmenitiesPanel', () => {
  const setup = () => {
    const props = {
      amenityTotal: 1,
      amenityFeatures: [feature],
      label: '',
      armed: null,
      onLabelChange: vi.fn(),
      onArm: vi.fn(),
      onRename: vi.fn(),
      onArmMove: vi.fn(),
      onRemove: vi.fn(),
    };
    render(<MapAmenitiesPanel {...props} />);
    return props;
  };

  it('arms a palette type', async () => {
    const props = setup();
    await userEvent.click(screen.getAllByRole('button', { name: /^Place / })[0]);
    expect(props.onArm).toHaveBeenCalledWith(AMENITY_PALETTE[0]);
  });

  it('moves and removes a placed amenity', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove North taps' }));
    expect(props.onArmMove).toHaveBeenCalledWith('a1');
    expect(props.onRemove).toHaveBeenCalledWith('a1');
  });
});

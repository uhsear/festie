import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MapZonesPanel from './MapZonesPanel';

const setup = (over: { drawing?: boolean; vertices?: number } = {}) => {
  const props = {
    zoneTotal: 1,
    placedZones: [{ id: 'z1', label: 'VIP', color: '#ff0000' }] as never,
    zoneLabel: '',
    zoneColor: '#ff0000',
    drawing: over.drawing ?? false,
    draftVertices: Array.from({ length: over.vertices ?? 0 }, () => ({ latitude: 1, longitude: 1 })),
    armed: null,
    onZoneLabelChange: vi.fn(),
    onZoneColorChange: vi.fn(),
    onStartZone: vi.fn(),
    onUndoVertex: vi.fn(),
    onFinishZone: vi.fn(),
    onCancelZone: vi.fn(),
    onRename: vi.fn(),
    onArmMove: vi.fn(),
    onRemove: vi.fn(),
  };
  render(<MapZonesPanel {...props} />);
  return props;
};

describe('MapZonesPanel', () => {
  it('starts drawing and manages a placed zone', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Draw a zone' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove VIP' }));
    expect(props.onStartZone).toHaveBeenCalledTimes(1);
    expect(props.onArmMove).toHaveBeenCalledWith('z1');
    expect(props.onRemove).toHaveBeenCalledWith('z1');
  });

  it('needs three points to finish a zone', async () => {
    const props = setup({ drawing: true, vertices: 2 });
    expect(screen.getByRole('button', { name: 'Finish zone' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Undo point' }));
    expect(props.onUndoVertex).toHaveBeenCalledTimes(1);
  });

  it('fills the label from a colour preset', async () => {
    const props = setup();
    await userEvent.click(screen.getAllByRole('button', { name: /^Use .* color$/ })[0]!);
    expect(props.onZoneColorChange).toHaveBeenCalled();
    expect(props.onZoneLabelChange).toHaveBeenCalled();
  });
});

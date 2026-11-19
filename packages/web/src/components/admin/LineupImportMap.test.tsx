import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LineupImportMap from './LineupImportMap';

const table = [
  ['Artist', 'Day'],
  ['Kai', 'Friday'],
];

const setup = () => {
  const props = {
    table,
    hasHeader: true,
    mapping: {},
    loading: false,
    onHeaderChange: vi.fn(),
    onMappingChange: vi.fn(),
    onBack: vi.fn(),
    onCheck: vi.fn(),
  };
  render(<LineupImportMap {...props} />);
  return props;
};

describe('LineupImportMap', () => {
  it('lists columns with their header and a sample value', () => {
    setup();
    expect(screen.getAllByRole('option', { name: 'Column A: Artist (e.g. Kai)' }).length).toBeGreaterThan(0);
  });

  it('blocks the check while mapping problems remain', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Check rows' })).toBeDisabled();
  });

  it('reports header toggles and back', async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText('First row is a header'));
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(props.onHeaderChange).toHaveBeenCalledWith(false);
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import MeetingPointForm from './MeetingPointForm';

const setup = (over: Partial<Parameters<typeof MeetingPointForm>[0]> = {}) => {
  const props = {
    formRef: createRef<HTMLFormElement>(),
    labelInputRef: createRef<HTMLInputElement>(),
    editing: false,
    type: 'during',
    label: 'Gate',
    location: 'North',
    stageRef: '',
    meetAt: '',
    recursDaily: false,
    coords: null,
    festivalTimeZone: undefined,
    locating: false,
    submitting: false,
    onTypeChange: vi.fn(),
    onLabelChange: vi.fn(),
    onLocationChange: vi.fn(),
    onStageRefChange: vi.fn(),
    onMeetAtChange: vi.fn(),
    onRecursDailyChange: vi.fn(),
    onCoordsChange: vi.fn(),
    onSubmit: vi.fn((e: React.FormEvent) => e.preventDefault()),
    onReset: vi.fn(),
    onCapture: vi.fn(),
    ...over,
  };
  render(<MeetingPointForm {...props} />);
  return props;
};

describe('MeetingPointForm', () => {
  it('submits and cancels', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('disables save until label and location are filled', () => {
    setup({ label: '', editing: true });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows the time error in place of the Past hint and blocks Add', () => {
    setup({ meetAt: '2020-01-01T10:00', meetAtError: 'Pick a time in the future.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a time in the future.');
    expect(screen.queryByText('Moves to Past 30 minutes after the meet time.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('offers the daily toggle only for a timed point', async () => {
    const props = setup({ meetAt: '2026-01-01T10:00' });
    await userEvent.click(screen.getByRole('switch', { name: /Repeats daily/ }));
    expect(props.onRecursDailyChange).toHaveBeenCalledTimes(1);
  });

  it('clears captured coordinates', async () => {
    const props = setup({ coords: { lat: 1.23456, lng: 2.34567 } });
    await userEvent.click(screen.getByRole('button', { name: 'Clear captured location' }));
    expect(props.onCoordsChange).toHaveBeenCalledWith(null);
  });
});

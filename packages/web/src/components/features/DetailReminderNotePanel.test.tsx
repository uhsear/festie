import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./DetailReminderPicker', () => ({ default: () => <div data-testid="reminder-picker" /> }));

import DetailReminderNotePanel from './DetailReminderNotePanel';

const props = {
  myReminder: undefined as number | undefined,
  reminderBusy: null as null,
  onReminderClick: vi.fn(async () => {}),
  canRemind: true,
  personalNote: '',
  onPersonalChange: vi.fn(),
};

describe('DetailReminderNotePanel', () => {
  it.each([
    [{}, 'Remind me · Add a note'],
    [{ myReminder: 15, personalNote: 'x' }, 'Reminder 15m before · Note added'],
    [{ canRemind: false }, 'Add a note'],
  ])('summarises the state', (over, text) => {
    render(<DetailReminderNotePanel {...props} {...over} />);
    expect(screen.getByRole('button')).toHaveTextContent(text);
  });

  it('toggles the panel with aria-expanded', async () => {
    const user = userEvent.setup();
    const onExpand = vi.fn();
    render(<DetailReminderNotePanel {...props} onExpand={onExpand} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Your note')).not.toBeInTheDocument();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Your note')).toBeInTheDocument();
    expect(screen.getByTestId('reminder-picker')).toBeInTheDocument();
    expect(onExpand).toHaveBeenCalled();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides the reminder chips when canRemind is false', async () => {
    render(<DetailReminderNotePanel {...props} canRemind={false} />);
    await userEvent.setup().click(screen.getByRole('button'));
    expect(screen.queryByTestId('reminder-picker')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Your note')).toBeInTheDocument();
  });

  it('reports note edits', async () => {
    const onPersonalChange = vi.fn();
    render(<DetailReminderNotePanel {...props} onPersonalChange={onPersonalChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button'));
    await user.type(screen.getByLabelText('Your note'), 'a');
    expect(onPersonalChange).toHaveBeenCalledWith('a');
  });

  it('shows a failed note save with a Retry that calls the retry function', async () => {
    const onRetryPersonal = vi.fn();
    render(<DetailReminderNotePanel {...props} personalStatus="failed" onRetryPersonal={onRetryPersonal} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Add a note/ }));
    expect(screen.getByText(/Not saved\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryPersonal).toHaveBeenCalledTimes(1);
  });
});

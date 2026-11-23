import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FestivalEditForm from './FestivalEditForm';

// The release panel is admin-only. If it loads, the test below fails on this spy.
const panel = vi.fn().mockResolvedValue(null);
vi.mock('@festie/shared/services/timeReleases', () => ({ timeReleaseApi: { panel: (...a: unknown[]) => panel(...a), send: vi.fn() } }));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }) }));

const props = {
  editingId: 'f1',
  notifyPickers: true,
  onNotifyPickersChange: vi.fn(),
  changes: { total: 1, changedSetIds: new Set<string>(), newSetIds: new Set<string>() },
  issues: [],
  saving: false,
  formData: { name: 'Fest', location: 'Here', timeZone: 'UTC', stages: [], days: [] },
  setFormData: vi.fn(),
  onSave: vi.fn(),
  onDiscard: vi.fn(),
  onCancel: vi.fn(),
};

describe('FestivalEditForm in organizer mode', () => {
  it('leaves out the series picker, the set-time releases and the alert checkbox', () => {
    render(<FestivalEditForm {...props} mode="organizer" />);
    expect(screen.queryByLabelText('Series')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tell people whose picks changed')).not.toBeInTheDocument();
    expect(panel).not.toHaveBeenCalled();
    expect(screen.getByText('Attendees are alerted after Festie checks the change.')).toBeInTheDocument();
  });

  it('gives a verified organization the alert checkbox in place of the held-alert note', () => {
    render(<FestivalEditForm {...props} mode="organizer" alertsOn />);
    expect(screen.getByLabelText('Tell people whose picks changed')).toBeInTheDocument();
    expect(screen.queryByText('Attendees are alerted after Festie checks the change.')).not.toBeInTheDocument();
  });

  it('keeps the admin controls in admin mode', () => {
    render(<FestivalEditForm {...props} />);
    expect(screen.getByLabelText('Series')).toBeInTheDocument();
    expect(screen.getByLabelText('Tell people whose picks changed')).toBeInTheDocument();
    expect(screen.queryByText('Attendees are alerted after Festie checks the change.')).not.toBeInTheDocument();
  });

  it('locks name and location with a hint and a contact link when the server would refuse the change', () => {
    render(<FestivalEditForm {...props} mode="organizer" identityLocked />);
    expect(screen.getByLabelText('Festival Name')).toBeDisabled();
    expect(screen.getByLabelText('Location')).toBeDisabled();
    expect(screen.getByText(/Ask Festie to change the name or location of a live festival\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact Festie' })).toHaveAttribute('href', 'mailto:support@festie.us');
    expect(screen.getByLabelText('Festival time zone')).toBeEnabled();
  });

  it('disables every input and drops the save buttons for a viewer', () => {
    render(<FestivalEditForm {...props} mode="organizer" readOnly />);
    const group = screen.getByRole('group', { name: 'Festival details' });
    expect(group).toBeDisabled();
    expect(group).toContainElement(screen.getByLabelText('Festival Name'));
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByText('Attendees are alerted after Festie checks the change.')).not.toBeInTheDocument();
  });

  it('dims the buttons of a viewer and opens every day so the lineup can be read', () => {
    const day = { id: 'd1', label: 'Day One', date: '2026-07-04', sets: [{ id: 's1', artist: 'AAT', startTime: '20:00' }] };
    render(<FestivalEditForm {...props} mode="organizer" readOnly formData={{ ...props.formData, days: [day] } as never} />);
    expect(screen.getByRole('group', { name: 'Festival details' }).className).toContain('button):disabled]:opacity-60');
    expect(screen.getByRole('button', { name: 'Remove Day One' })).toBeDisabled();
    expect(screen.getByLabelText('Start time for AAT')).toBeInTheDocument();
  });

  it('shows a plain disabled Save when nothing changed', () => {
    render(<FestivalEditForm {...props} mode="organizer" changes={{ ...props.changes, total: 0 }} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('shows Save for an editor', () => {
    render(<FestivalEditForm {...props} mode="organizer" />);
    expect(screen.getByRole('button', { name: 'Save 1 change' })).toBeEnabled();
  });
});

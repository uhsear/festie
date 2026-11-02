import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FestivalStatusPanel from './FestivalStatusPanel';

const publishFestival = vi.fn();
vi.mock('@festie/shared/services/festivalAdmin', () => ({
  publishFestival: (...a: unknown[]) => publishFestival(...a),
  checklistFromError: () => null,
}));
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }),
}));

const todoList = [
  { key: 'timeZone', status: 'todo', label: "Choose the festival's time zone." },
  { key: 'sets', status: 'todo', label: 'Add sets to Day 1.' },
] as const;
const doneList = [{ key: 'timeZone', status: 'done', label: 'Time zone: UTC' }] as const;

const renderPanel = (over: Partial<React.ComponentProps<typeof FestivalStatusPanel>> = {}) =>
  render(
    <FestivalStatusPanel
      festivalId="f1"
      name="Fest"
      meta={{ publishedAt: null, updatedAt: '2026-10-01T00:00:00.000Z', checklist: [...doneList] }}
      dirty={false}
      onPublished={vi.fn()}
      onImport={vi.fn()}
      onEditMap={vi.fn()}
      {...over}
    />,
  );

describe('FestivalStatusPanel', () => {
  beforeEach(() => publishFestival.mockReset());

  it('disables Publish while an item is to do', () => {
    renderPanel({ meta: { publishedAt: null, checklist: [...todoList] } });
    expect(screen.getByRole('button', { name: 'Publish festival' })).toBeDisabled();
    expect(screen.getByText('Finish the open items first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import lineup' })).toBeInTheDocument();
  });

  it('asks to save first when dirty', () => {
    renderPanel({ dirty: true });
    expect(screen.getByRole('button', { name: 'Publish festival' })).toBeDisabled();
    expect(screen.getByText('Save your changes first.')).toBeInTheDocument();
  });

  it('publishes after confirmation', async () => {
    publishFestival.mockResolvedValue({ publishedAt: 'x', checklist: [] });
    const onPublished = vi.fn();
    renderPanel({ onPublished });
    await userEvent.click(screen.getByRole('button', { name: 'Publish festival' }));
    expect(screen.getByText('Publish Fest?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishFestival).toHaveBeenCalledWith('f1'));
    await waitFor(() => expect(onPublished).toHaveBeenCalled());
  });

  it('shows no checklist for a published festival', () => {
    renderPanel({ meta: { publishedAt: '2026-10-02T00:00:00.000Z', checklist: [...doneList] } });
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.queryByText('Before you publish')).toBeNull();
  });
});

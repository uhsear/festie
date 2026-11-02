import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DetailNotesSection from './DetailNotesSection';

describe('DetailNotesSection', () => {
  const defaultProps = {
    crewNote: '',
    onCrewChange: vi.fn(),
  };
  const LABEL = 'Crew note (your crew sees this)';

  it('renders only the crew note', () => {
    render(<DetailNotesSection {...defaultProps} />);
    expect(screen.getByText(LABEL)).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.queryByText('Personal Notes')).not.toBeInTheDocument();
  });

  it('displays the crew note value', () => {
    render(<DetailNotesSection {...defaultProps} crewNote="VIP area" />);
    expect(screen.getByLabelText(LABEL)).toHaveValue('VIP area');
  });

  it('calls onCrewChange when typed', async () => {
    const onCrewChange = vi.fn();
    render(<DetailNotesSection {...defaultProps} onCrewChange={onCrewChange} />);
    await userEvent.setup().type(screen.getByLabelText(LABEL), 'b');
    expect(onCrewChange).toHaveBeenCalledWith('b');
  });

  it('renders the crew placeholder', () => {
    render(<DetailNotesSection {...defaultProps} />);
    expect(screen.getByPlaceholderText(/Share a note with your crew/)).toBeInTheDocument();
  });

  it.each([
    ['saving', 'Saving…'],
    ['saved', 'Saved'],
    ['queued', 'Saved on this device — will send when online'],
    ['failed', 'Not saved.'],
  ] as const)('renders the %s status', (status, text) => {
    render(<DetailNotesSection {...defaultProps} crewStatus={status} />);
    expect(screen.getByRole('status')).toHaveTextContent(text);
  });

  it('renders nothing visible for idle', () => {
    render(<DetailNotesSection {...defaultProps} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('calls the retry callback', async () => {
    const onRetryCrew = vi.fn();
    render(<DetailNotesSection {...defaultProps} crewStatus="failed" onRetryCrew={onRetryCrew} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryCrew).toHaveBeenCalledOnce();
  });
});

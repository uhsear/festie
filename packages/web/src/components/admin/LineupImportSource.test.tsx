import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LineupImportSource from './LineupImportSource';

const setup = () => {
  const props = {
    text: 'a,b',
    onTextChange: vi.fn(),
    onChooseFile: vi.fn(),
    onExport: vi.fn(),
    onNext: vi.fn(),
    onCheckList: vi.fn(),
  };
  render(<LineupImportSource {...props} />);
  return props;
};

describe('LineupImportSource', () => {
  it('reports typed text', async () => {
    const props = setup();
    await userEvent.type(screen.getByRole('textbox'), 'x');
    expect(props.onTextChange).toHaveBeenCalledWith('a,bx');
  });

  it('runs the next, list and export actions', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Next: match columns' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check as a list of names' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export lineup CSV' }));
    expect(props.onNext).toHaveBeenCalledTimes(1);
    expect(props.onCheckList).toHaveBeenCalledTimes(1);
    expect(props.onExport).toHaveBeenCalledTimes(1);
  });

  it('passes the chosen file up', async () => {
    const props = setup();
    const file = new File(['a'], 'lineup.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('Lineup file'), file);
    expect(props.onChooseFile).toHaveBeenCalledWith(file);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFestivalStore } from '@festie/shared/stores';
import { useArtistSheetStore } from '@festie/shared/stores/artistSheetStore';
import { makeFestivalSet } from '@festie/shared/test-fixtures/festivalSet';
import ArtistName, { ArtistNameButton, RowOpenButton } from './ArtistName';
import ArtistSheetHost from './ArtistSheetHost';

// jsdom has no pointer capture; vaul calls it on pointerdown inside the sheet.
beforeEach(() => {
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  useArtistSheetStore.setState({ target: null, isOpen: false });
  useFestivalStore.setState({ sets: [] });
});

describe('ArtistName', () => {
  it('renders a B2B set as one button per artist with the separator between', () => {
    const set = makeFestivalSet({ artist: 'Ana b2b Bo', artists: [{ name: 'Ana' }, { name: 'Bo' }] });
    const { container } = render(<ArtistName set={set} />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Open Ana', 'Open Bo']);
    expect(container).toHaveTextContent('Ana b2b Bo');
  });

  it('inherits the surrounding font size and line height, not the browser button default', () => {
    render(<ArtistNameButton name="Ana" />);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('text-[length:inherit]');
    expect(cls).toContain('leading-[inherit]');
  });

  it('keeps a billed name as one button that lists every artist in the sheet', async () => {
    const set = makeFestivalSet({ displayName: 'The Duo', artists: [{ name: 'Ana' }, { name: 'Bo' }] });
    render(
      <>
        <ArtistName set={set} />
        <ArtistSheetHost />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open The Duo' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Ana')).toBeInTheDocument();
    expect(within(dialog).getByText('Bo')).toBeInTheDocument();
  });

  it('does not fire a clickable parent on click or on Enter', () => {
    const onParent = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onClick={onParent} onKeyDown={onParent}>
        <ArtistNameButton name="Solo" />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Open Solo' });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onParent).not.toHaveBeenCalled();
    expect(useArtistSheetStore.getState().isOpen).toBe(true);
  });

  it('fills photo and genres for a bare name from the loaded sets', async () => {
    useFestivalStore.setState({ sets: [makeFestivalSet({ artists: [{ name: 'Solo', genres: ['Ambient'] }] })] });
    render(
      <>
        <ArtistNameButton name="solo" />
        <ArtistSheetHost />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open solo' }));
    expect(within(await screen.findByRole('dialog')).getByText('Ambient')).toBeInTheDocument();
  });

  it('RowOpenButton is a sibling of the name button, never its ancestor', () => {
    const onOpen = vi.fn();
    render(
      <div className="relative">
        <RowOpenButton label="Solo, 9 PM" onClick={onOpen} />
        <ArtistNameButton name="Solo" />
      </div>,
    );
    const row = screen.getByRole('button', { name: 'Solo, 9 PM' });
    expect(row.contains(screen.getByRole('button', { name: 'Open Solo' }))).toBe(false);
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

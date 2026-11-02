import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PackingTab from './PackingTab';

const { state, addPackingItems, updatePackingItem } = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  addPackingItems: vi.fn(),
  updatePackingItem: vi.fn(),
}));

vi.mock('@festie/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared')>()),
  useCrewStore: (sel: (s: Record<string, unknown>) => unknown) => sel(state),
}));
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn(), toastUndo: vi.fn() }),
}));
vi.mock('../../hooks/useHaptics', () => ({
  useHaptics: () => ({ select: vi.fn(), warning: vi.fn() }),
}));

const members = [
  { userId: 'me', username: 'me', name: 'Me' },
  { userId: 'sam', username: 'sam', name: 'Sam' },
];

function setup(items: unknown[], isOwner = false) {
  Object.assign(state, {
    packingItems: items,
    loadPacking: vi.fn().mockResolvedValue(undefined),
    createPackingItem: vi.fn(),
    updatePackingItem,
    deletePackingItem: vi.fn(),
    addPackingItems,
    crewMembers: members,
    activeCrew: { id: 'crew-1', members },
  });
  return render(<PackingTab crewId="crew-1" currentUserId="me" isOwner={isOwner} />);
}

const item = (over: Record<string, unknown>) => ({
  id: 'p1',
  label: 'Tent',
  claimed: false,
  brought_by: null,
  created_by: 'sam',
  ...over,
});

describe('PackingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addPackingItems.mockResolvedValue('sent');
    updatePackingItem.mockResolvedValue(undefined);
  });

  it('open item offers a claim button', async () => {
    setup([item({})]);
    fireEvent.click(await screen.findByRole('button', { name: "I'll bring it" }));
    expect(updatePackingItem).toHaveBeenCalledWith('crew-1', 'p1', { claimed: true });
  });

  it('my claim shows packed and release actions, never struck through', async () => {
    const { container } = setup([item({ claimed: true, brought_by: 'me' })]);
    expect(await screen.findByText("You're bringing it")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Packed' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Not bringing it' })).toBeTruthy();
    expect(container.querySelector('.line-through')).toBeNull();
  });

  it('another member claim names them and hides release for a non-owner', async () => {
    setup([item({ claimed: true, brought_by: 'sam' })]);
    expect(await screen.findByText('Sam is bringing it')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove claim' })).toBeNull();
    expect(screen.queryByRole('button', { name: "I'll bring it" })).toBeNull();
  });

  it('the owner can remove another member claim', async () => {
    setup([item({ claimed: true, brought_by: 'sam' })], true);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove claim' }));
    expect(updatePackingItem).toHaveBeenCalledWith('crew-1', 'p1', { claimed: false });
  });

  it('renames an item on submit', async () => {
    setup([item({})]);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Tent' }));
    const input = screen.getByLabelText('Item name');
    fireEvent.change(input, { target: { value: 'Big tent' } });
    fireEvent.submit(input.closest('form')!);
    await vi.waitFor(() => expect(updatePackingItem).toHaveBeenCalledWith('crew-1', 'p1', { label: 'Big tent' }));
  });

  it('empty list offers templates and adds the camping items', async () => {
    setup([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Camping list' }));
    expect(screen.getByRole('button', { name: 'Day trip list' })).toBeTruthy();
    await vi.waitFor(() => expect(addPackingItems).toHaveBeenCalledTimes(1));
    const [crewId, labels] = addPackingItems.mock.calls[0]!;
    expect(crewId).toBe('crew-1');
    expect(labels).toHaveLength(12);
    expect(labels[0]).toBe('Tent');
  });
});

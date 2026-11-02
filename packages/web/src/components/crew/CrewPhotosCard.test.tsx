import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const updatePhotoAlbum = vi.fn();
vi.mock('@festie/shared/stores', () => ({
  useCrewStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel({ updatePhotoAlbum })),
}));
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }),
}));

import CrewPhotosCard from './CrewPhotosCard';

const SAVED = 'https://photos.app.goo.gl/saved';

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrewPhotosCard crewId="c1" currentUrl={SAVED} />
    </QueryClientProvider>,
  );
}

describe('CrewPhotosCard', () => {
  beforeEach(() => {
    updatePhotoAlbum.mockReset();
    updatePhotoAlbum.mockResolvedValue(undefined);
  });

  it('Cancel throws away the half-typed link', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Edit crew photo album link' }));
    fireEvent.change(screen.getByLabelText('Shared album URL'), { target: { value: 'https://half' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit crew photo album link' }));
    expect(screen.getByLabelText('Shared album URL')).toHaveValue(SAVED);
  });

  it('Save sends the trimmed URL through the crew store', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Edit crew photo album link' }));
    fireEvent.change(screen.getByLabelText('Shared album URL'), { target: { value: '  https://new.example/a  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updatePhotoAlbum).toHaveBeenCalledWith('c1', { photoAlbumUrl: 'https://new.example/a' }),
    );
  });

  it('Remove calls the store only after the confirm', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Edit crew photo album link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Remove the crew album?')).toBeInTheDocument();
    expect(updatePhotoAlbum).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(updatePhotoAlbum).toHaveBeenCalledWith('c1', { photoAlbumUrl: null }));
  });
});

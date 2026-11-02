import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DetailSpotifySection from './DetailSpotifySection';

const URL_ = 'https://open.spotify.com/artist/abc123';
const ready = { embedUrl: 'https://open.spotify.com/embed/artist/123', embedType: 'artist' as const };

describe('DetailSpotifySection', () => {
  it.each([
    [{ label: 'Legacy label' }, 'Spotify: Legacy label'],
    [{ trackName: 'Midnight City', artistName: 'M83' }, 'Spotify: Midnight City'],
    [{ artistName: 'M83' }, 'Spotify: M83'],
    [{}, 'Spotify: player'],
  ])('uses the best available iframe title', (metadata, title) => {
    render(
      <DetailSpotifySection
        status="ready"
        preview={{ ...ready, embedType: 'track', ...metadata }}
        spotifyUrl={URL_}
        visible
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByTitle(title)).toBeInTheDocument();
  });

  it('ready: toggles the player from the Listen button', () => {
    const onToggle = vi.fn();
    render(
      <DetailSpotifySection status="ready" preview={ready} spotifyUrl={URL_} visible={false} onToggle={onToggle} />,
    );
    const button = screen.getByRole('button', { name: 'Listen' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.queryByRole('link', { name: /Open in Spotify/ })).not.toBeInTheDocument();
  });

  it('ready and open: shows Hide player, the iframe and the Spotify link', () => {
    render(<DetailSpotifySection status="ready" preview={ready} spotifyUrl={URL_} visible onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Hide player' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /Open in Spotify/ })).toHaveAttribute('href', URL_);
  });

  it('loading: shows a disabled Listen button', () => {
    render(<DetailSpotifySection status="loading" preview={null} spotifyUrl={URL_} visible={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Listen' })).toBeDisabled();
  });

  it('offline: says listening needs signal and keeps the Spotify link', () => {
    render(<DetailSpotifySection status="offline" preview={null} spotifyUrl={URL_} visible={false} onToggle={vi.fn()} />);
    expect(screen.getByText('Listening needs signal.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in Spotify/ })).toHaveAttribute('href', URL_);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('none: shows only the Spotify link', () => {
    render(<DetailSpotifySection status="none" preview={null} spotifyUrl={URL_} visible={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('link', { name: /Open in Spotify/ })).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DetailArtistLinks from './DetailArtistLinks';

describe('DetailArtistLinks', () => {
  it('shows genres in the shared casing', () => {
    render(<DetailArtistLinks artistLinks={[]} isB2B={false} genres={['melodic dubstep', 'edm']} />);
    expect(screen.getByText('Melodic Dubstep')).toBeInTheDocument();
    expect(screen.getByText('EDM')).toBeInTheDocument();
  });

  it('names each link by artist and platform, and shows the platform as its visible text', () => {
    render(
      <DetailArtistLinks
        artistLinks={[{ name: 'SLANDER', links: { spotify: 'https://open.spotify.com/artist/abc', instagram: 'https://instagram.com/slander' } }]}
        isB2B={false}
        genres={[]}
      />,
    );
    expect(screen.getByRole('link', { name: 'SLANDER on Spotify' })).toHaveTextContent('Spotify');
    expect(screen.getByRole('link', { name: 'SLANDER on Instagram' })).toHaveTextContent('Instagram');
  });
});

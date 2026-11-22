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

  it('lists links in the sheet order with a new-tab arrow and drops unsafe URLs', () => {
    render(
      <DetailArtistLinks
        artistLinks={[
          {
            name: 'SLANDER',
            links: { instagram: 'https://instagram.com/slander', evil: 'javascript:alert(1)', spotify: 'https://open.spotify.com/artist/abc' },
          },
        ]}
        isB2B={false}
        genres={[]}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Spotify ↗', 'Instagram ↗']);
  });
});

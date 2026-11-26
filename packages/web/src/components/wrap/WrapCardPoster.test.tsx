import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WrapCard } from '@festie/shared/types';
import WrapCardPoster from './WrapCardPoster';

const card: WrapCard = {
  kind: 'top',
  kicker: 'YOUR TOP SETS',
  headline: 'Artist One',
  sub: '#1 of 3 sets you rated',
  rows: [
    { primary: 'Artist One', secondary: 'Main Stage', rating: 5 },
    { primary: 'Artist Two', secondary: 'Tent', rating: 4 },
  ],
};

describe('WrapCardPoster', () => {
  it('renders kicker, headline, byline and rows', () => {
    render(<WrapCardPoster card={card} festivalName="Coachella" byline="@asir · Apr 24 – Apr 26, 2026" />);
    expect(screen.getByText('YOUR TOP SETS')).toBeTruthy();
    expect(screen.getAllByText('Artist One').length).toBe(2);
    expect(screen.getByText('@asir · Apr 24 – Apr 26, 2026')).toBeTruthy();
    expect(screen.getByText('Tent')).toBeTruthy();
  });

  it('left-aligns the root and never sets opacity on text', () => {
    const { container } = render(<WrapCardPoster card={card} festivalName="Coachella" />);
    expect((container.firstElementChild as HTMLElement).style.textAlign).toBe('left');
    const withOpacity = Array.from(container.querySelectorAll<HTMLElement>('*')).filter((el) => el.style.opacity !== '');
    expect(withOpacity).toEqual([]);
  });

  it('draws one band, one 360 px dominant object and at most five rows in Clash 700', () => {
    const six = { ...card, dominant: { value: '6', label: 'sets planned' }, rows: Array.from({ length: 6 }, (_, i) => ({ primary: `Act ${i}`, time: '8:00 PM' })) };
    const { container } = render(<WrapCardPoster card={six} festivalName="Coachella" />);
    expect(container.querySelectorAll('[data-poster="band"]').length).toBe(1);
    const dominant = container.querySelector<HTMLElement>('[data-poster="dominant"]')!;
    expect(dominant.textContent).toBe('6');
    expect(parseInt(dominant.style.fontSize, 10)).toBeGreaterThanOrEqual(360);
    expect(dominant.style.fontWeight).toBe('700');
    expect(dominant.style.fontFamily).toContain('Clash Display');
    expect(container.querySelectorAll('[data-poster="row"]').length).toBe(5);
    expect(container.innerHTML).not.toMatch(/radial-gradient|font-weight: ?[89]00/);
  });
});

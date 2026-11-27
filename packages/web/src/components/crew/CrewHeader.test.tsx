import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CrewHeader from './CrewHeader';

const crew = { id: 'c1', name: 'Squad', festivalId: 'f1' } as never;

describe('CrewHeader', () => {
  it('keeps the crew name as the page h1 for the outline', () => {
    render(<CrewHeader crew={crew} selector={<button type="button">Switch</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Squad' })).toBeInTheDocument();
  });

  it('shows the switcher as the only visible title, so the name and festival print once', () => {
    const { container } = render(<CrewHeader crew={crew} selector={<button type="button">Switch</button>} />);
    expect(screen.getByRole('button', { name: 'Switch' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('sr-only');
    expect(container.querySelectorAll('[data-testid="avatar"]')).toHaveLength(0);
  });

  it('renders the owner action beside the title', () => {
    render(<CrewHeader crew={crew} selector={<span>Title</span>} action={<button type="button">Rename</button>} />);
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
  });
});

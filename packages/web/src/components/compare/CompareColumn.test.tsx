import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CompareColumn from './CompareColumn';

function renderInTable(ui: React.ReactElement) {
  return render(
    <table>
      <thead>
        <tr>{ui}</tr>
      </thead>
    </table>,
  );
}

describe('CompareColumn', () => {
  it('renders "You" for the current user', () => {
    renderInTable(<CompareColumn id="me" name="Alice" isMe color="hsl(35 70% 58%)" />);
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('renders the name for other users', () => {
    renderInTable(<CompareColumn id="other" name="Bob" isMe={false} color="hsl(35 70% 58%)" />);
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('falls back to "Member" when name is undefined for non-me', () => {
    renderInTable(<CompareColumn id="other" name={undefined} isMe={false} color="hsl(35 70% 58%)" />);
    expect(screen.getByText('Member')).toBeInTheDocument();
  });

  it('renders as a th element', () => {
    const { container } = renderInTable(
      <CompareColumn id="me" name="Alice" isMe color="hsl(35 70% 58%)" />,
    );
    expect(container.querySelector('th')).toBeInTheDocument();
  });

  it('renders an avatar component', () => {
    renderInTable(<CompareColumn id="me" name="Alice" isMe color="hsl(35 70% 58%)" />);
    // Avatar renders the first letter of the name
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('draws a colour bar in the given colour', () => {
    renderInTable(<CompareColumn id="me" name="Alice" isMe color="rgb(1, 2, 3)" />);
    expect(screen.getByTestId('compare-column-bar')).toHaveStyle({ background: 'rgb(1, 2, 3)' });
  });
});

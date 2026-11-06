import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUIStore } from '@festie/shared/stores/uiStore';
import HapticsSection from './HapticsSection';

let supported = true;
vi.mock('../../hooks/useHaptics', () => ({ useHaptics: () => ({ isSupported: supported }) }));

describe('HapticsSection', () => {
  beforeEach(() => {
    supported = true;
    useUIStore.setState({ hapticsEnabled: true });
  });

  it('renders nothing on browsers that cannot vibrate', () => {
    supported = false;
    const { container } = render(<HapticsSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it('flips hapticsEnabled and aria-checked on click', async () => {
    render(<HapticsSection />);
    const sw = screen.getByRole('switch', { name: 'Vibration' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await userEvent.setup().click(sw);
    expect(useUIStore.getState().hapticsEnabled).toBe(false);
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });
});

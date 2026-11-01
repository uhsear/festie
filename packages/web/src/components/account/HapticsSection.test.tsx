import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUIStore } from '@festie/shared/stores/uiStore';
import HapticsSection from './HapticsSection';

describe('HapticsSection', () => {
  beforeEach(() => useUIStore.setState({ hapticsEnabled: true }));

  it('flips hapticsEnabled and aria-checked on click', async () => {
    render(<HapticsSection />);
    const sw = screen.getByRole('switch', { name: 'Vibration' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await userEvent.setup().click(sw);
    expect(useUIStore.getState().hapticsEnabled).toBe(false);
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });
});

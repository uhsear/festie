import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { INTRO_LINEUP_COPY, ONBOARDING_SLIDES_SHARED, PRIORITY_LABELS } from '@festie/shared/constants';
import IntroLineup from './IntroLineup';

describe('IntroLineup', () => {
  it('cycles a set priority on tap and draws one clash line', async () => {
    const user = userEvent.setup();
    render(<IntroLineup />);
    const set = screen.getByRole('button', { name: /Low Tide Club/ });
    expect(set).toHaveTextContent(INTRO_LINEUP_COPY.unpicked);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    await user.click(set);
    expect(set).toHaveTextContent(PRIORITY_LABELS.must);
    expect(screen.getByRole('status')).toHaveTextContent(INTRO_LINEUP_COPY.clash('Nova Drift', 'Low Tide Club'));

    await user.click(set);
    expect(set).toHaveTextContent(PRIORITY_LABELS['want-to-see']);
  });

  it('keeps slide copy in the shared constant', () => {
    expect(ONBOARDING_SLIDES_SHARED[0].key).toBe('plan');
  });
});

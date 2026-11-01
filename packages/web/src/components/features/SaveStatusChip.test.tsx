import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockStatus: { kind: string; label: string } | null = null;
vi.mock('@festie/shared/hooks', () => ({ useSaveStatus: () => mockStatus }));

import SaveStatusChip from './SaveStatusChip';

describe('SaveStatusChip', () => {
  it.each([
    ['saved', 'Saved'],
    ['saving', 'Saving…'],
    ['syncing', 'Syncing…'],
    ['offline', 'Offline, will sync'],
    ['failed', 'Not saved'],
  ])('renders %s', (kind, label) => {
    mockStatus = { kind, label };
    render(<SaveStatusChip />);
    expect(screen.getByRole('status')).toHaveTextContent(label);
  });

  it('renders nothing for null', () => {
    mockStatus = null;
    const { container } = render(<SaveStatusChip />);
    expect(container).toBeEmptyDOMElement();
  });
});

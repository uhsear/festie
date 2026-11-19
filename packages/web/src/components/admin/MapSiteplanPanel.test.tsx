import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MapSiteplanPanel from './MapSiteplanPanel';

const setup = (over: Partial<Parameters<typeof MapSiteplanPanel>[0]> = {}) => {
  const props = {
    url: 'https://example.com/plan.png',
    opacity: 0.5,
    committed: false,
    placing: false,
    draftCorners: [],
    uploading: false,
    uploadError: null,
    onFile: vi.fn(),
    onUrlChange: vi.fn(),
    onOpacityChange: vi.fn(),
    onStartCorners: vi.fn(),
    onUndoCorner: vi.fn(),
    onApplyCorners: vi.fn(),
    onCancelCorners: vi.fn(),
    onRemoveOverlay: vi.fn(),
    ...over,
  };
  render(<MapSiteplanPanel {...props} />);
  return props;
};

describe('MapSiteplanPanel', () => {
  it('warns about a non-https link and blocks setting corners', () => {
    setup({ url: 'http://example.com/plan.png' });
    expect(screen.getByText('Image link must start with https://')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set corners' })).toBeDisabled();
  });

  it('starts corner placement', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Set corners' }));
    expect(props.onStartCorners).toHaveBeenCalledTimes(1);
  });

  it('applies corners only when all four are set', () => {
    setup({ placing: true, draftCorners: [{ latitude: 1, longitude: 1 }] });
    expect(screen.getByText('1/4 corners')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply corners' })).toBeDisabled();
  });

  it('removes a committed overlay and shows the upload error', async () => {
    const props = setup({ committed: true, uploadError: 'Too big' });
    expect(screen.getByRole('alert')).toHaveTextContent('Too big');
    await userEvent.click(screen.getByRole('button', { name: 'Remove site-plan overlay' }));
    expect(props.onRemoveOverlay).toHaveBeenCalledTimes(1);
  });
});

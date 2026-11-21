import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GlobalErrorBoundary from './GlobalErrorBoundary';

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/react', () => ({ captureException }));

function Boom({ error }: { error: Error }): never {
  throw error;
}

function renderBoom(error: Error) {
  return render(
    <GlobalErrorBoundary>
      <Boom error={error} />
    </GlobalErrorBoundary>,
  );
}

describe('GlobalErrorBoundary', () => {
  const reload = vi.fn();
  const realLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  });

  it('renders its children when nothing throws', () => {
    render(
      <GlobalErrorBoundary>
        <p>app</p>
      </GlobalErrorBoundary>,
    );
    expect(screen.getByText('app')).toBeInTheDocument();
  });

  it('announces the failure with role=alert and never prints the raw error message', () => {
    renderBoom(new Error('Cannot read properties of undefined (reading "secretField")'));
    expect(screen.getByRole('alert')).toHaveTextContent('Something broke');
    expect(screen.queryByText(/secretField/)).toBeNull();
    expect(screen.queryByText(/Cannot read properties/)).toBeNull();
  });

  it('uses the classified offline copy for a network failure', () => {
    renderBoom(Object.assign(new Error('Failed to fetch'), { status: 0, isNetworkError: true }));
    expect(screen.getByRole('alert')).toHaveTextContent('You appear to be offline');
    expect(screen.queryByText('Failed to fetch')).toBeNull();
  });

  it('reloads the page from the Reload button', async () => {
    renderBoom(new Error('boom'));
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports the error to Sentry', () => {
    const err = new Error('boom');
    renderBoom(err);
    expect(captureException).toHaveBeenCalledWith(err, expect.anything());
  });
});

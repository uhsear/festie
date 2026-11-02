import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSetThemeMode = vi.fn();
let uiState: Record<string, unknown>;

vi.mock('@festie/shared/stores/uiStore', async (orig) => ({
  ...(await orig<typeof import('@festie/shared/stores/uiStore')>()),
  useUIStore: (selector: (s: Record<string, unknown>) => unknown) => selector(uiState),
}));

import ThemeSection from './ThemeSection';

beforeEach(() => {
  vi.clearAllMocks();
  uiState = { theme: 'stage', followSystemTheme: false, setThemeMode: mockSetThemeMode };
});

describe('ThemeSection', () => {
  it('renders three radios with Stage checked', () => {
    render(<ThemeSection />);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /Stage/ })).toBeChecked();
  });

  it('clicking Match system calls setThemeMode("system")', async () => {
    const user = userEvent.setup();
    render(<ThemeSection />);
    await user.click(screen.getByRole('radio', { name: /Match system/ }));
    expect(mockSetThemeMode).toHaveBeenCalledWith('system');
  });

  it('checks Match system when followSystemTheme is true', () => {
    uiState = { ...uiState, theme: 'daylight', followSystemTheme: true };
    render(<ThemeSection />);
    expect(screen.getByRole('radio', { name: /Match system/ })).toBeChecked();
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { picksPerSetCsv } from '@festie/shared/utils';
import { pickInsightFixture as insight } from '@festie/shared/utils/pickInsight.fixture';
import FestivalPickInsight from './FestivalPickInsight';

const mockFetch = vi.fn();
vi.mock('@festie/shared/services/admin', () => ({
  fetchAdminPickInsight: (...a: unknown[]) => mockFetch(...a),
}));

function renderInsight() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FestivalPickInsight festivalId="f1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue(insight);
});

describe('FestivalPickInsight', () => {
  it('lists a clash with its count and one label per row', async () => {
    renderInsight();
    expect(await screen.findByText('Alpha and =Beta')).toBeInTheDocument();
    expect(screen.getByText('8 people picked both')).toBeInTheDocument();
    expect(screen.getByLabelText('8 people picked both Alpha and =Beta, Friday')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith('f1');
  });

  it('shows the empty copy when no clash passes the floor', async () => {
    mockFetch.mockResolvedValue({ ...insight, clashes: [] });
    renderInsight();
    expect(await screen.findByText('No clash was picked by 5 or more people yet.')).toBeInTheDocument();
  });

  it('a failed load shows the error and Retry refetches', async () => {
    mockFetch.mockRejectedValueOnce(new Error('boom'));
    renderInsight();
    expect(await screen.findByText("Couldn't load clashing picks.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Alpha and =Beta')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('export downloads the CSV under the dated file name', async () => {
    const create = vi.fn((_blob: Blob) => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    let fileName = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      fileName = this.download;
    });
    renderInsight();
    await screen.findByText('Alpha and =Beta');
    await userEvent.click(screen.getByRole('button', { name: 'Export picks per set' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(fileName).toMatch(/^festie-picks-f1-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(await create.mock.calls[0][0].text()).toBe(picksPerSetCsv(insight));
    expect(revoke).toHaveBeenCalledWith('blob:x');
    click.mockRestore();
  });
});

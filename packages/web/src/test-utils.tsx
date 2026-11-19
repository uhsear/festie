import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type DefaultOptions } from '@tanstack/react-query';

export function createTestQueryClient(defaultOptions: DefaultOptions = { queries: { retry: false } }) {
  return new QueryClient({ defaultOptions });
}

export function queryClientWrapper(client: QueryClient = createTestQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

export function renderWithQueryClient(ui: ReactElement, client: QueryClient = createTestQueryClient()) {
  return render(ui, { wrapper: queryClientWrapper(client) });
}

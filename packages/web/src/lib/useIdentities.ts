import { useQuery } from '@tanstack/react-query';
import { listIdentities } from '@festie/shared/services/oauth';

/** Sign-in methods of the current user. `hasPassword === false` marks a provider-only account. */
export function useIdentities() {
  return useQuery({ queryKey: ['auth', 'identities'], queryFn: listIdentities, staleTime: 30_000 });
}

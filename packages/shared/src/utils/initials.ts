import { getInitials, normalizeIdentityName } from './colors';

interface NamedUser {
  name?: string | null;
  displayName?: string | null;
  username?: string | null;
}

/** The label every avatar derives its initials and color from: name, then displayName, then username. */
export function identityLabel(user: NamedUser | null | undefined): string {
  const pick = [user?.name, user?.displayName, user?.username].find((v) => v?.trim());
  return normalizeIdentityName(pick ?? undefined);
}

/** Avatar initials for a user. Header and Account both use it so they always agree. */
export function displayInitials(user: NamedUser | null | undefined): string {
  return getInitials(identityLabel(user));
}

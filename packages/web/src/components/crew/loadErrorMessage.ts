import { isApiClientError, mapErrorToUserMessage } from '@festie/shared/services/errors';

/**
 * Why a crew tab failed to load, in words for the user. An API failure says whether the
 * device is offline or the server failed; any other error gets the tab's own `fallback`,
 * so a raw exception message never reaches the screen.
 */
export function loadErrorMessage(err: unknown, fallback: string): string {
  return isApiClientError(err) ? mapErrorToUserMessage(err, fallback) : fallback;
}

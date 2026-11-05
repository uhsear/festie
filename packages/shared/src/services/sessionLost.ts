import { COPY } from '../constants/copy';

type SignedOutListener = (message: string) => void;

const listeners = new Set<SignedOutListener>();

/** Subscribe to the "you were signed out" notice. Returns an unsubscribe function. */
export function onSignedOutNotice(listener: SignedOutListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Tell the user their session ended. `wasSignedIn` must be read BEFORE the
 * refresh attempt, because a failed refresh clears the user. A guest's 401 (the
 * initial logged-out /auth/me) passes false and stays silent, and once the user
 * is cleared every later 401 passes false, so the notice shows once per sign-out.
 */
export function noticeSignedOut(wasSignedIn: boolean): boolean {
  if (!wasSignedIn) return false;
  listeners.forEach((listener) => listener(COPY.session.signedOut));
  return true;
}

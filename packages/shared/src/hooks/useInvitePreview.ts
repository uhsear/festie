import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { InvitePreview } from '../types/api';
import { inviteErrorStatus, type InviteStatus } from '../utils/invite';

interface InvitePreviewState {
  status: InviteStatus;
  preview: InvitePreview | null;
}

const LOADING: InvitePreviewState = { status: 'loading', preview: null };

export function useInvitePreview(code: string | null): InvitePreviewState {
  const [state, setState] = useState<{ code: string | null; value: InvitePreviewState }>({ code, value: LOADING });

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    api
      .get<InvitePreview>(`/crews/join-preview/${encodeURIComponent(code)}`)
      .then((preview) => {
        if (!cancelled) setState({ code, value: { status: 'ready', preview } });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ code, value: { status: inviteErrorStatus(err), preview: null } });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  // A stale result for a previous code reads as loading until the new one lands.
  return code && state.code === code ? state.value : LOADING;
}

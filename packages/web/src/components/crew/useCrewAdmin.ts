import { useState, useCallback } from 'react';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { useCrewStore } from '@festie/shared/stores';
import type { User } from '@festie/shared/types';
import type { ToastType } from '../../lib/toastContext';

/**
 * Encapsulates admin-role detection and force-add-member logic.
 */
export function useCrewAdmin(
  user: User | null,
  activeCrewId: string | undefined,
  crewName: string | undefined,
  toast: (msg: string, type: ToastType) => void,
) {
  const selectCrew = useCrewStore((state) => state.selectCrew);
  const forceAddMember = useCrewStore((state) => state.forceAddMember);

  const isAdmin = user?.isAdmin ?? false;
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminAddBusy, setAdminAddBusy] = useState(false);

  const submitForceAdd = useCallback(async (target: { id: string; username: string }) => {
    if (!activeCrewId) return;
    setAdminAddBusy(true);
    try {
      await forceAddMember(activeCrewId, target.id);
      await selectCrew(activeCrewId);
      toast(`Added @${target.username} to ${crewName ?? 'the crew'}.`, 'success');
      setAdminOpen(false);
    } catch (e) {
      if (e instanceof Error && /already/i.test(e.message)) toast('User is already in this crew', 'info');
      else toast(mapErrorToUserMessage(e, "Couldn't add that user. Try again."), 'error');
    } finally { setAdminAddBusy(false); }
  }, [activeCrewId, crewName, forceAddMember, selectCrew, toast]);

  const handleForceAdd = useCallback(() => setAdminOpen(true), []);

  return {
    isAdmin,
    adminOpen,
    setAdminOpen,
    adminAddBusy,
    submitForceAdd,
    handleForceAdd,
  };
}

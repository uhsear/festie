import { useEffect, useRef, useState } from 'react';
import { fetchAdminUsers, type AdminUserRow } from '@festie/shared/services/admin';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { maskEmail } from '@festie/shared/utils';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import { inputBase } from '../../lib/styles';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  existingUserIds?: string[];
  fullMessage?: string | null;
  onPick: (user: AdminUserRow) => Promise<void>;
}

/** Search-and-add user picker for admin member actions. Search runs 300 ms after typing stops. */
export default function UserPickerDialog({ open, onOpenChange, title, existingUserIds = [], fullMessage, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setUsers([]);
      setSearched(false);
      setError(null);
      return;
    }
    const q = query.trim();
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const result = await fetchAdminUsers({ search: q, limit: 10 });
        if (id !== requestId.current) return;
        setUsers(result.users);
        setSearched(true);
        setError(null);
      } catch (e) {
        if (id !== requestId.current) return;
        setError(mapErrorToUserMessage(e, "Couldn't search users. Try again."));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [open, query]);

  async function add(user: AdminUserRow) {
    setAddingId(user.id);
    setError(null);
    try {
      await onPick(user);
    } catch (e) {
      setError(mapErrorToUserMessage(e, "Couldn't add that user. Try again."));
    } finally {
      setAddingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <div className="space-y-3">
        <input
          type="text"
          aria-label="Search users"
          placeholder="Search by username or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${inputBase} min-h-11 min-w-0`}
        />
        {fullMessage && <p className="text-sm text-text-secondary">{fullMessage}</p>}
        {error && (
          <p role="alert" className="text-sm text-[var(--color-text-danger)]">
            {error}
          </p>
        )}
        {searched && users.length === 0 && (
          <p className="text-sm text-text-muted">No users match "{query.trim()}".</p>
        )}
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-text-primary truncate">@{u.username}</p>
                <p className="text-xs text-text-muted truncate">{maskEmail(u.email)}</p>
              </div>
              {existingUserIds.includes(u.id) ? (
                <span className="text-xs text-text-muted shrink-0">Already in crew</span>
              ) : (
                <Button
                  variant="secondary"
                  type="button"
                  className="shrink-0"
                  disabled={!!fullMessage || addingId !== null}
                  onClick={() => add(u)}
                >
                  {addingId === u.id ? 'Adding…' : 'Add'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

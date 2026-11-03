import React, { useEffect, useMemo, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { searchAdminTargets, type AdminTarget } from '@festie/shared/utils';
import { useReturnFocus } from '../../hooks/useReturnFocus';
import { useAdminCrews, useAdminFestivals } from './adminQueries';
import { useAdminSearch, type AdminSearch } from './useAdminSearch';

const PALETTE_EVENT = 'festie:admin-palette';
const LISTBOX_ID = 'admin-palette-results';
const GROUPS: Array<{ kind: AdminTarget['kind']; heading: string }> = [
  { kind: 'festival', heading: 'Festivals' },
  { kind: 'crew', heading: 'Crews' },
  { kind: 'user', heading: 'Users' },
];

export function openAdminPalette() {
  window.dispatchEvent(new Event(PALETTE_EVENT));
}

export default function AdminCommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [, setAdminSearch] = useAdminSearch();
  const festivals = useAdminFestivals();
  const crews = useAdminCrews(open);
  const returnFocus = useReturnFocus();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(PALETTE_EVENT, onOpen);
    };
  }, []);

  const results = useMemo(
    () => searchAdminTargets(query, { festivals: festivals.data ?? [], crews: crews.data ?? [] }),
    [query, festivals.data, crews.data],
  );
  // Rows follow the drawn group order so the arrow keys move down the visible list.
  const ordered = useMemo(() => GROUPS.flatMap((g) => results.filter((r) => r.kind === g.kind)), [results]);
  const loadFailed = festivals.isError || crews.isError;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery('');
      setActive(0);
    }
  };

  const choose = (target: AdminTarget) => {
    const inviteCode = /^Invite code (\S+)/.exec(target.hint)?.[1];
    const next: AdminSearch =
      target.kind === 'festival'
        ? { tab: 'festivals', festival: target.id, view: 'edit' }
        : target.kind === 'crew'
          ? { tab: 'crews', q: inviteCode || target.label }
          : { tab: 'users', q: target.id };
    onOpenChange(false);
    setAdminSearch(next);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, ordered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && ordered[active]) {
      e.preventDefault();
      choose(ordered[active]);
    }
  };

  const trimmed = query.trim();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-black/60 backdrop-blur-sm" />
        <RadixDialog.Content
          aria-describedby={undefined}
          {...returnFocus}
          className="fixed left-1/2 top-[15vh] z-[var(--z-modal)] w-[92vw] max-w-lg -translate-x-1/2 rounded-2xl bg-bg-card border border-border-light shadow-2xl p-4 space-y-3"
        >
          <RadixDialog.Title className="sr-only">Find</RadixDialog.Title>
          <input
            type="text"
            role="combobox"
            aria-expanded={ordered.length > 0}
            aria-controls={LISTBOX_ID}
            aria-activedescendant={ordered[active] ? `admin-palette-option-${active}` : undefined}
            placeholder="Find a festival, user, crew or invite code"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            className="w-full min-h-11 rounded-md border border-glass-border bg-bg-primary px-3 text-sm text-text-primary"
          />
          <p className="text-xs text-text-muted">
            Type f, u or c and a space to search only festivals, users or crews.
          </p>
          {loadFailed && (
            <p role="alert" className="text-sm text-accent-coral">
              Couldn&apos;t load festivals and crews. Close this and try again.
            </p>
          )}
          {!loadFailed && trimmed && ordered.length === 0 && (
            <p className="text-sm text-text-muted">No festivals or crews match &quot;{trimmed}&quot;.</p>
          )}
          <div id={LISTBOX_ID} role="listbox" aria-label="Results">
            {GROUPS.map(({ kind, heading }) => {
              const rows = ordered.filter((r) => r.kind === kind);
              if (rows.length === 0) return null;
              return (
                <div key={kind} role="group" aria-label={heading}>
                  <div className="px-2 pt-2 text-xs font-semibold uppercase text-text-muted" aria-hidden="true">
                    {heading}
                  </div>
                  {rows.map((row) => {
                    const index = ordered.indexOf(row);
                    return (
                      // Keyboard use goes through the combobox input (arrows and Enter).
                      // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                      <div
                        key={`${row.kind}:${row.id}`}
                        id={`admin-palette-option-${index}`}
                        role="option"
                        aria-selected={index === active}
                        tabIndex={-1}
                        onClick={() => choose(row)}
                        onMouseMove={() => setActive(index)}
                        className={`cursor-pointer rounded-md px-2 py-2 min-h-11 ${
                          index === active ? 'bg-accent-aqua text-bg-primary' : 'text-text-primary'
                        }`}
                      >
                        <div className="text-sm font-medium">{row.label}</div>
                        {row.hint && <div className="text-xs opacity-80">{row.hint}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

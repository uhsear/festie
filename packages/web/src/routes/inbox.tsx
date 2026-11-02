import React, { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useInboxStore, isInboxItemUnread, type InboxItem } from '@festie/shared/stores/inboxStore';
import { INBOX_COPY } from '@festie/shared/constants/inboxCopy';
import { timeAgo } from '@festie/shared/utils';
import { openInboxItem } from '../lib/pushTargetPath';

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';

function ErrorLine({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 py-3 text-sm text-text-secondary">
      <span>{INBOX_COPY.error}</span>
      <button
        type="button"
        onClick={onRetry}
        className={`min-h-11 px-3 font-medium text-accent-aqua underline underline-offset-2 ${FOCUS_RING}`}
      >
        {INBOX_COPY.retry}
      </button>
    </div>
  );
}

export default function InboxView() {
  const navigate = useNavigate();
  const { items, loaded, loading, error, load } = useInboxStore();
  // Rows unread before this visit keep their dot during it.
  const seenAtOnOpen = useRef(useInboxStore.getState().seenAt);

  useEffect(() => {
    void (async () => {
      await useInboxStore.getState().load();
      await useInboxStore.getState().markAllSeen();
    })();
  }, []);

  const open = (item: InboxItem) => openInboxItem(item, navigate as unknown as Parameters<typeof openInboxItem>[1]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <h1 className="text-xl font-display font-bold text-text-primary mb-2">{INBOX_COPY.title}</h1>

      {!loaded && loading && (
        <div role="status" aria-label="Loading" className="py-8 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-text-muted border-t-accent-aqua" />
        </div>
      )}

      {error && <ErrorLine onRetry={() => void load()} />}

      {loaded && items.length === 0 && !error && <p className="py-6 text-text-secondary">{INBOX_COPY.empty}</p>}

      {items.length > 0 && (
        <ul className="divide-y divide-border-subtle">
          {items.map((item) => {
            const unread = isInboxItemUnread(item, seenAtOnOpen.current);
            const ago = timeAgo(Date.parse(item.createdAt));
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item)}
                  aria-label={`${item.title}. ${item.body}. ${ago}.${unread ? ` ${INBOX_COPY.unreadA11y}.` : ''}`}
                  className={`flex w-full min-h-11 items-start gap-3 py-3 text-left ${FOCUS_RING}`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-2 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-accent-aqua' : 'bg-transparent'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-text-primary">{item.title}</span>
                    <span className="block text-text-secondary [overflow-wrap:anywhere]">{item.body}</span>
                    <span className="block text-xs text-text-muted">{ago}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {loaded && <p className="mt-4 text-xs text-text-muted">{INBOX_COPY.footnote}</p>}
    </div>
  );
}

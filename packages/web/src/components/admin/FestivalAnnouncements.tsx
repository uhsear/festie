import React, { useCallback, useEffect, useState } from 'react';
import { announcementsApi } from '@festie/shared/services/announcements';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { ANNOUNCEMENT_COPY as COPY } from '@festie/shared/constants/announcementCopy';
import { ANNOUNCEMENT_SCREENS, announcementStatus } from '@festie/shared/utils/announcements';
import type { AdminAnnouncement, AnnouncementScreen, AnnouncementSeverity } from '@festie/shared/types/announcement';
import { useToast } from '../../lib/toastContext';
import ConfirmDialog from '../ui/ConfirmDialog';
import EmptyState from '../ui/EmptyState';

interface Props {
  festivalId: string;
  festivalName: string;
}

const TITLE_MAX = 80;
const BODY_MAX = 200;
const SEVERITIES: AnnouncementSeverity[] = ['info', 'urgent'];
const BANNER_MS = 24 * 60 * 60 * 1000;

const fieldClass =
  'w-full px-3 py-2 rounded-md bg-bg-card border border-glass-border text-text-primary text-sm min-h-11';
const buttonClass =
  'px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 disabled:opacity-50 transition-colors text-sm font-medium min-h-11';

export default function FestivalAnnouncements({ festivalId, festivalName }: Props) {
  const [items, setItems] = useState<AdminAnnouncement[]>([]);
  const [recipients, setRecipients] = useState(0);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<AnnouncementSeverity>('info');
  const [screen, setScreen] = useState<AnnouncementScreen>('home');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [sendAtLocal, setSendAtLocal] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [takeDown, setTakeDown] = useState<AdminAnnouncement | null>(null);
  const { toast, toastError } = useToast();

  const reload = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await announcementsApi.adminList(festivalId);
      setItems(res.announcements ?? []);
      setRecipients(res.recipients ?? 0);
    } catch (err: unknown) {
      setLoadError(err);
      toastError(err, "Couldn't load announcements. Try again.");
    }
  }, [festivalId, toastError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const canSubmit = !busy && !loadError && title.trim() !== '' && message.trim() !== '' && (when === 'now' || sendAtLocal !== '');

  const create = async () => {
    setBusy(true);
    try {
      const sendAt = when === 'later' ? new Date(sendAtLocal).toISOString() : undefined;
      const res = await announcementsApi.create(festivalId, {
        severity,
        title: title.trim(),
        body: message.trim(),
        screen,
        ...(sendAt ? { sendAt } : {}),
      });
      toast(sendAt ? COPY.scheduled(new Date(sendAt).toLocaleString()) : COPY.queued(res.recipients), 'success');
      setTitle('');
      setMessage('');
      setSendAtLocal('');
      setConfirmSend(false);
      await reload();
    } catch (err: unknown) {
      setConfirmSend(false);
      toastError(err, "Couldn't create the announcement. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (a: AdminAnnouncement, wasSent: boolean) => {
    setBusy(true);
    try {
      await announcementsApi.cancel(festivalId, a.id);
      toast(wasSent ? COPY.takenDownToast : COPY.cancelledToast, 'success');
      setTakeDown(null);
      await reload();
    } catch (err: unknown) {
      setTakeDown(null);
      toastError(err, "Couldn't cancel the announcement. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (when === 'now') setConfirmSend(true);
    else void create();
  };

  return (
    <section className="bg-bg-card/60 border border-glass-border rounded-lg p-4 space-y-4">
      <h3 className="type-heading text-text-primary">{COPY.heading}</h3>
      <p className="text-sm text-text-muted">{COPY.intro(festivalName)}</p>
      <p className="text-sm text-text-muted">{COPY.audience(recipients)}</p>

      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label htmlFor="announce-title" className="block text-sm text-text-primary mb-1">
            {COPY.fields.title}
          </label>
          <input
            id="announce-title"
            className={fieldClass}
            value={title}
            maxLength={TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
          />
          <p className="text-xs text-text-muted mt-1">{COPY.fields.counter(title.length, TITLE_MAX)}</p>
        </div>
        <div>
          <label htmlFor="announce-message" className="block text-sm text-text-primary mb-1">
            {COPY.fields.message}
          </label>
          <textarea
            id="announce-message"
            className={fieldClass}
            rows={3}
            value={message}
            maxLength={BODY_MAX}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="text-xs text-text-muted mt-1">{COPY.fields.counter(message.length, BODY_MAX)}</p>
        </div>
        <fieldset>
          <legend className="text-sm text-text-primary mb-1">{COPY.fields.importance}</legend>
          <div className="flex gap-4">
            {SEVERITIES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm text-text-primary min-h-11">
                <input
                  type="radio"
                  name="announce-severity"
                  checked={severity === s}
                  onChange={() => setSeverity(s)}
                />
                {COPY.severityLabels[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="announce-screen" className="block text-sm text-text-primary mb-1">
            {COPY.fields.opens}
          </label>
          <select
            id="announce-screen"
            className={fieldClass}
            value={screen}
            onChange={(e) => setScreen(e.target.value as AnnouncementScreen)}
          >
            {ANNOUNCEMENT_SCREENS.map((s) => (
              <option key={s} value={s}>
                {COPY.screenLabels[s]}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="text-sm text-text-primary mb-1">{COPY.fields.when}</legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-text-primary min-h-11">
              <input type="radio" name="announce-when" checked={when === 'now'} onChange={() => setWhen('now')} />
              {COPY.whenNow}
            </label>
            <label className="flex items-center gap-2 text-sm text-text-primary min-h-11">
              <input type="radio" name="announce-when" checked={when === 'later'} onChange={() => setWhen('later')} />
              {COPY.whenLater}
            </label>
          </div>
        </fieldset>
        {when === 'later' && (
          <div>
            <label htmlFor="announce-send-at" className="block text-sm text-text-primary mb-1">
              {COPY.fields.sendAtLabel(zone)}
            </label>
            <input
              id="announce-send-at"
              type="datetime-local"
              className={fieldClass}
              value={sendAtLocal}
              onChange={(e) => setSendAtLocal(e.target.value)}
            />
          </div>
        )}
        <button type="submit" className={buttonClass} disabled={!canSubmit}>
          {when === 'now' ? COPY.submitNow(recipients) : COPY.submitLater}
        </button>
      </form>

      {loadError && items.length === 0 ? (
        <EmptyState
          title="Couldn't load announcements"
          description={mapErrorToUserMessage(loadError, 'Check your connection, then try again.')}
          cta={{ label: 'Retry', onClick: () => void reload() }}
        />
      ) : items.length === 0 ? (
        <p className="text-sm text-text-muted">{COPY.listEmpty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => {
            const status = announcementStatus(a);
            const whenText = new Date(status === 'sent' && a.sentAt ? a.sentAt : a.sendAt).toLocaleString();
            return (
              <li
                key={a.id}
                className="bg-bg-card/60 border border-glass-border rounded-lg p-3 flex items-center justify-between gap-3"
              >
                <div className="text-sm min-w-0">
                  <p className="text-text-primary break-words">
                    {a.severity === 'urgent' && <span className="text-accent-coral">{COPY.urgentTag} · </span>}
                    {a.title}
                  </p>
                  <p className="text-text-muted break-words">{a.body}</p>
                  <p className="text-text-muted">{COPY.statusLine(status, whenText, a.recipientCount)}</p>
                </div>
                {status === 'scheduled' && (
                  <button type="button" className={buttonClass} disabled={busy} onClick={() => void cancel(a, false)}>
                    {COPY.rowCancel}
                  </button>
                )}
                {status === 'sent' && a.sentAt && Date.now() - Date.parse(a.sentAt) < BANNER_MS && (
                  <button type="button" className={buttonClass} disabled={busy} onClick={() => setTakeDown(a)}>
                    {COPY.rowTakeDown}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title={COPY.confirmSend.title}
        description={COPY.confirmSend.text(recipients)}
        confirmLabel={COPY.confirmSend.confirm}
        cancelLabel={COPY.confirmSend.cancel}
        busy={busy}
        onConfirm={create}
      />
      <ConfirmDialog
        open={!!takeDown}
        onOpenChange={(o) => !o && setTakeDown(null)}
        title={COPY.confirmTakeDown.title}
        description={COPY.confirmTakeDown.text}
        confirmLabel={COPY.confirmTakeDown.confirm}
        cancelLabel={COPY.confirmTakeDown.cancel}
        destructive
        busy={busy}
        onConfirm={() => (takeDown ? cancel(takeDown, true) : undefined)}
      />
    </section>
  );
}

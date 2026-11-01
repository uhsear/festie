import React, { useEffect, useId, useRef, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import Button from './Button';
import Dialog from './Dialog';
import { inputBase } from '../../lib/styles';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputType?: 'text' | 'email' | 'number';
  onConfirm: (value: string) => void | Promise<void>;
  busy?: boolean;
  maxLength?: number;
  error?: string;
  /** Shows a Paste button when the clipboard API exists. Maps the clipboard text to the field value; null leaves the field alone. */
  parsePaste?: (text: string) => string | null;
}

/**
 * Replacement for `window.prompt`. Built on the shared Dialog shell (Radix) so it ports
 * focus-trap, Escape handling, aria-modal, portal mounting, and click-outside
 * dismissal for free. Keeps the "inline text input + confirm/cancel" pattern
 * that made prompts convenient without the blocking, un-styleable native sheet.
 */
export default function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  defaultValue = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  inputType = 'text',
  onConfirm,
  busy = false,
  maxLength = 200,
  error,
  parsePaste,
}: Props) {
  const [value, setValue] = useState(defaultValue);
  useEffect(() => { if (open) setValue(defaultValue); }, [open, defaultValue]);
  const uid = useId();
  const errorId = error ? `${uid}-error` : undefined;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const canPaste = !!parsePaste && typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  // Reads the clipboard only on tap. A denied permission leaves the field as it is.
  async function paste() {
    try {
      const parsed = parsePaste?.(await navigator.clipboard.readText());
      if (parsed) setValue(parsed);
    } catch {
      /* clipboard read denied or unavailable */
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    await onConfirm(value.trim());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <form onSubmit={submit} className="space-y-3" {...(busy ? { 'aria-busy': true } : {})}>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type={inputType}
            value={value}
            maxLength={maxLength}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            disabled={busy}
            aria-label={title}
            {...(error ? { 'aria-invalid': true, 'aria-describedby': errorId } : {})}
            className={`${inputBase} min-h-11 min-w-0`}
          />
          {canPaste && (
            <Button variant="secondary" type="button" className="min-h-11 shrink-0" disabled={busy} onClick={paste}>
              Paste
            </Button>
          )}
        </div>
        {error && (
          <p
            id={errorId}
            role="alert"
            className="text-sm text-[var(--color-text-danger)] animate-in fade-in slide-in-from-top-1 duration-200"
          >
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <RadixDialog.Close asChild>
            <Button variant="secondary" type="button" className="flex-1 min-h-11">
              {cancelLabel}
            </Button>
          </RadixDialog.Close>
          <Button
            type="submit"
            variant="primary"
            isLoading={busy}
            disabled={!value.trim() || busy}
            className="flex-1 min-h-11"
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

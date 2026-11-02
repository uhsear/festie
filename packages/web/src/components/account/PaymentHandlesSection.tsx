import React, { useId, useState } from 'react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { PAYMENT_COPY, PAYMENT_FIELDS } from '@festie/shared/constants';
import { paymentProfileUrl } from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { Wallet } from 'lucide-react';

type Key = (typeof PAYMENT_FIELDS)[number]['key'];
type Values = Record<Key, string>;

/**
 * Account settings for payment handles (Venmo / Cash App / PayPal). These power
 * the prefilled settle-up deep links in the crew expenses tab. All optional;
 * clearing a field removes it. A leading @/$ is normalized server-side.
 */
export default function PaymentHandlesSection() {
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const updatePaymentHandles = useAuthStore((s) => s.updatePaymentHandles);
  const idBase = useId();

  const saved: Values = {
    venmoHandle: user?.venmoHandle ?? '',
    cashappCashtag: user?.cashappCashtag ?? '',
    paypalHandle: user?.paypalHandle ?? '',
  };
  const [values, setValues] = useState<Values>(saved);
  const [saving, setSaving] = useState(false);

  const dirty = PAYMENT_FIELDS.some((f) => values[f.key].trim() !== saved[f.key]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    try {
      const res = await updatePaymentHandles({
        venmoHandle: values.venmoHandle.trim(),
        cashappCashtag: values.cashappCashtag.trim(),
        paypalHandle: values.paypalHandle.trim(),
      });
      // Reflect normalized (stripped) values back into the inputs.
      setValues({
        venmoHandle: res?.venmoHandle ?? '',
        cashappCashtag: res?.cashappCashtag ?? '',
        paypalHandle: res?.paypalHandle ?? '',
      });
      toast(PAYMENT_COPY.saved, 'success');
    } catch (err) {
      toast(mapErrorToUserMessage(err, PAYMENT_COPY.saveFailed), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
        <Wallet className="w-4 h-4" aria-hidden="true" />
        {PAYMENT_COPY.title}
      </h3>
      <p className="text-xs text-text-muted">{PAYMENT_COPY.intro}</p>

      <form onSubmit={handleSave} className="space-y-3">
        {PAYMENT_FIELDS.map((f) => {
          const inputId = `${idBase}-${f.key}`;
          const prefixId = `${idBase}-${f.key}-prefix`;
          const href = paymentProfileUrl(f.method, values[f.key]);
          return (
            <div key={f.key}>
              <label htmlFor={inputId} className="block text-sm font-medium text-text-primary mb-2">
                {f.label}
              </label>
              <div className="flex items-center gap-2">
                <span id={prefixId} className="text-sm text-text-muted shrink-0">
                  {f.prefix}
                </span>
                <div className="min-w-0 flex-1">
                  <Input
                    id={inputId}
                    value={values[f.key]}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    aria-label={f.label}
                    maxLength={64}
                    autoComplete="off"
                    aria-describedby={prefixId}
                  />
                </div>
              {href && (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={PAYMENT_COPY.testLabel(f.label)}
                  className="inline-flex items-center min-h-11 px-1 text-sm text-accent-aqua underline"
                >
                  {PAYMENT_COPY.test}
                </a>
                )}
              </div>
            </div>
          );
        })}
        <Button type="submit" variant="primary" size="md" isLoading={saving} disabled={!dirty} className="min-h-[44px]">
          Save
        </Button>
      </form>
    </section>
  );
}

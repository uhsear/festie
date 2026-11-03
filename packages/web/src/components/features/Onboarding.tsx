import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { X, Users, Bell, Check, ChevronRight } from 'lucide-react';
import { ONBOARDING_SLIDES_SHARED } from '@festie/shared';
import { ONBOARDING_COPY, PRIORITY_LABELS, PRIORITY_OPTIONS } from '@festie/shared/constants';
import { useAuthStore, useFestivalStore } from '@festie/shared/stores';
import {
  formatFestivalDateRange,
  getIntroSteps,
  introCrewAction,
  introFestivalChoices,
  nextIntroStep,
} from '@festie/shared/utils';
import type { IntroCrewChoice, IntroStepKey } from '@festie/shared/utils';
import type { Priority } from '@festie/shared/types';
import PriorityIcon from '../ui/PriorityIcon';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { useKeyboardTrap } from '../../hooks/useKeyboardTrap';
import { cn } from '../../lib/utils';
import { readPendingInviteCode } from '../auth/invite';

const STORAGE_KEY = 'festie_onboarding_completed';

function isOnboardingCompleted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function markOnboardingCompleted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // localStorage unavailable — silently ignore
  }
}

interface OnboardingProps {
  /**
   * Hold the walkthrough while another prompt (the "Join this crew?" dialog)
   * is open, so the two never stack. It appears once the prompt closes.
   */
  suspended?: boolean;
}

// Copy comes from ONBOARDING_SLIDES_SHARED and ONBOARDING_COPY (@festie/shared) for web/mobile parity.
// Icons are web-specific (lucide).
const SLIDE_ICON: Record<'crew' | 'reminders', React.ReactNode> = {
  crew: <Users className="w-10 h-10 text-accent-aqua" />,
  reminders: <Bell className="w-10 h-10 text-accent-aqua" />,
};

const PRIORITY_COLOR: Record<Priority, string> = {
  must: 'var(--color-priority-must)',
  'want-to-see': 'var(--color-priority-want)',
  maybe: 'var(--color-priority-maybe)',
};

export default function Onboarding({ suspended = false }: OnboardingProps) {
  const [pending, setPending] = useState(() => {
    if (isOnboardingCompleted()) return false;
    // Arriving through an invite link: the join prompt is the first run, so
    // skip the walkthrough instead of stacking it on top.
    if (readPendingInviteCode()) {
      markOnboardingCompleted();
      return false;
    }
    return true;
  });
  const visible = pending && !suspended;
  const festivals = useFestivalStore((s) => s.festivals);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const selectFestival = useFestivalStore((s) => s.selectFestival);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { toastError } = useToast();
  const steps = getIntroSteps(festivals.length);
  const [stepKey, setStepKey] = useState<IntroStepKey>('plan');
  const { choices, defaultId } = introFestivalChoices(festivals, currentFestival?.id ?? null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selectedId = pickedId ?? defaultId;
  const cardRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    markOnboardingCompleted();
    setPending(false);
  }, []);

  // Focus management + keyboard trap. The shared hook moves initial focus into
  // the card on mount, wraps Tab / Shift+Tab so focus can't escape to the page
  // behind the modal, closes on Escape (WCAG 2.1.2), and restores focus to the
  // previously-focused element on unmount.
  useKeyboardTrap(cardRef, visible, dismiss);

  // Prevent the page behind the modal from scrolling while onboarding is open.
  useEffect(() => {
    if (!visible) return;
    const { documentElement, body } = document;
    const prevBody = body.style.overflow;
    const prevHtml = documentElement.style.overflow;
    body.style.overflow = 'hidden';
    documentElement.style.overflow = 'hidden';
    return () => {
      body.style.overflow = prevBody;
      documentElement.style.overflow = prevHtml;
    };
  }, [visible]);

  const handleNext = useCallback(async () => {
    if (stepKey === 'festival' && selectedId && selectedId !== currentFestival?.id) {
      try {
        await selectFestival(selectedId);
      } catch (err) {
        toastError(err, "Couldn't open that festival. Pick it from the festival menu.");
      }
    }
    const next = nextIntroStep(steps, stepKey);
    if (next) setStepKey(next);
  }, [stepKey, steps, selectedId, currentFestival?.id, selectFestival, toastError]);

  const handleCrewChoice = (choice: IntroCrewChoice) => {
    const { start, needsAccount } = introCrewAction(choice, !!user);
    dismiss();
    if (!start) return;
    if (needsAccount) void navigate({ to: '/register', search: { next: `/crew?start=${start}` } });
    else void navigate({ to: '/crew', search: { start } });
  };

  if (!visible) return null;

  const stepNumber = steps.indexOf(stepKey) + 1;
  const slide = ONBOARDING_SLIDES_SHARED.find((x) => x.key === stepKey);
  const isGoing = stepKey === 'going';

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 'var(--z-modal)' }}
      role="dialog"
      aria-modal="true"
      aria-label={ONBOARDING_COPY.dialogLabel}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={dismiss} aria-hidden="true" />

      {/* Card */}
      <div
        ref={cardRef}
        className={cn(
          'relative w-full max-w-sm rounded-2xl border border-border-light',
          'bg-bg-primary shadow-2xl p-6 flex flex-col items-center text-center',
        )}
      >
        {/* Close button */}
        <div className="absolute top-2 right-2">
          <IconButton icon={<X className="w-5 h-5" />} label="Dismiss onboarding" onClick={dismiss} />
        </div>

        {/* Step icon */}
        {stepKey === 'plan' ? (
          // Brand mark on the first step; decorative, the title names the app.
          <img src="/favicon.svg" width={80} height={80} alt="" className="mt-2 mb-4" />
        ) : stepKey === 'crew' || stepKey === 'reminders' ? (
          <div className="mt-2 mb-4 flex items-center justify-center w-20 h-20 rounded-full bg-bg-card border border-border">
            {SLIDE_ICON[stepKey]}
          </div>
        ) : null}

        {/* Step content */}
        {slide && (
          <>
            <h2 className="text-xl font-display font-bold text-text-primary mb-2">{slide.title}</h2>
            <p className="text-sm text-text-secondary leading-relaxed max-w-xs mb-6">{slide.description}</p>
          </>
        )}
        {stepKey === 'plan' && (
          <div className="flex flex-wrap justify-center gap-2 mb-6" aria-hidden="true">
            {PRIORITY_OPTIONS.map((p) => (
              <span
                key={p.value}
                className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-semibold"
                style={{ color: PRIORITY_COLOR[p.value] }}
              >
                <PriorityIcon priority={p.value} className="w-3 h-3" filled />
                {PRIORITY_LABELS[p.value]}
              </span>
            ))}
          </div>
        )}
        {stepKey === 'festival' && (
          <>
            <h2 className="text-xl font-display font-bold text-text-primary mb-2 mt-6">
              {ONBOARDING_COPY.festival.title}
            </h2>
            <p className="text-sm text-text-secondary leading-relaxed max-w-xs mb-4">
              {ONBOARDING_COPY.festival.description}
            </p>
            <div className="flex w-full flex-col gap-2 mb-6">
              {choices.map((f) => {
                const selected = f.id === selectedId;
                const dates = formatFestivalDateRange(f.startDate, f.endDate);
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setPickedId(f.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border px-3 py-2 min-h-[52px] text-left cursor-pointer',
                      selected ? 'border-accent-aqua' : 'border-border',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-text-primary">{f.name}</span>
                      {dates && <span className="block truncate text-xs text-text-muted">{dates}</span>}
                    </span>
                    {selected && <Check className="w-4 h-4 shrink-0 text-accent-aqua" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {isGoing && (
          <>
            <h2 className="text-xl font-display font-bold text-text-primary mb-2 mt-6">
              {ONBOARDING_COPY.going.title}
            </h2>
            <p className="text-sm text-text-secondary leading-relaxed max-w-xs mb-4">
              {ONBOARDING_COPY.going.description}
            </p>
            <div className="flex w-full flex-col gap-2 mb-4">
              <Button variant="primary" size="md" className="w-full" onClick={() => handleCrewChoice('start')}>
                {ONBOARDING_COPY.going.start}
              </Button>
              <Button variant="outline" size="md" className="w-full" onClick={() => handleCrewChoice('join')}>
                {ONBOARDING_COPY.going.join}
              </Button>
              <Button variant="ghost" size="md" className="w-full" onClick={() => handleCrewChoice('solo')}>
                {ONBOARDING_COPY.going.solo}
              </Button>
            </div>
            {!user && (
              <p className="mb-4 text-sm text-text-secondary">
                {ONBOARDING_COPY.signInPrompt}{' '}
                <button
                  type="button"
                  className="min-h-11 font-semibold text-accent-aqua cursor-pointer"
                  onClick={() => {
                    dismiss();
                    void navigate({ to: '/login' });
                  }}
                >
                  {ONBOARDING_COPY.signIn}
                </button>
              </p>
            )}
          </>
        )}

        {/* Step indicators */}
        <div
          className="flex items-center gap-2 mb-6"
          role="progressbar"
          aria-label={`Step ${stepNumber} of ${steps.length}`}
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={stepNumber}
        >
          {steps.map((k) => (
            <div
              key={k}
              aria-hidden="true"
              className={cn(
                'h-1.5 rounded-full transition-[width,background-color] duration-300',
                k === stepKey ? 'w-6 bg-accent-aqua' : 'w-1.5 bg-text-muted/30',
              )}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex w-full gap-3">
          <Button variant="ghost" size="md" className="flex-1" onClick={dismiss}>
            {ONBOARDING_COPY.skip}
          </Button>
          {!isGoing && (
            <Button variant="primary" size="md" className="flex-1" onClick={() => void handleNext()}>
              <span className="flex items-center gap-1">
                {ONBOARDING_COPY.next}
                <ChevronRight className="w-4 h-4" />
              </span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

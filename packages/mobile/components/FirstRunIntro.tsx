import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, useWindowDimensions, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useFestivalDataStore } from '@festie/shared/stores';
import { ONBOARDING_COPY, ONBOARDING_SLIDES_SHARED, PRIORITY_LABELS } from '@festie/shared/constants';
import {
  formatFestivalDateRange,
  getIntroSteps,
  introCrewAction,
  introFestivalChoices,
  nextIntroStep,
  type IntroCrewChoice,
  type IntroStepKey,
} from '@festie/shared/utils';
import Button from './Button';
import AppPressable from './AppPressable';
import DisplayWords from './DisplayWords';
import { makeStyles, typeStyle, useTokens, useLargeText, MAX_FONT_SCALE } from '../hooks/useTokens';
import { setReturnTo } from '../lib/returnTo';

/**
 * First-run intro, also replayed from Account. Five steps (the festival step is
 * left out until the festival list loads): three explainer slides, "Which
 * festival?" and "Going with friends?". The copy and the step rules come from
 * `@festie/shared`, so web and mobile say the same words. The last step routes
 * into a crew (start, join, or sign in first). `onDone` fires for Skip and for
 * every way out of the last step.
 *
 * Layout intent (design roadmap P2-1): the slide visual sits in the upper half
 * and the value-first copy is anchored low (just above the controls) rather than
 * dead-centered, so the screen doesn't read as a generic empty template. Slide 1
 * leads with a product visual (a miniature of the picks/schedule surface); the
 * remaining slides use a single accent glyph.
 */
const SLIDE_ICON: Record<'crew' | 'reminders', keyof typeof Ionicons.glyphMap> = {
  crew: 'people-outline',
  reminders: 'notifications-outline',
};

/** A miniature of the picks surface — a "Friday" day card with priority-tiered
 *  set rows. Pure decoration (hidden from the a11y tree) that signals the
 *  product instead of a generic centered icon. */
function ProductVisual() {
  const t = useTokens();
  const styles = useStyles();
  const rows = [
    { color: t.colors.priority.must, label: PRIORITY_LABELS.must, time: '8:30' },
    { color: t.colors.priority.want, label: PRIORITY_LABELS['want-to-see'], time: '9:45' },
    { color: t.colors.priority.maybe, label: PRIORITY_LABELS.maybe, time: '11:00' },
  ];
  return (
    <View style={styles.visualCard} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.visualHeader}>
        <Text style={styles.visualDay}>Friday</Text>
        <View style={styles.visualPill}>
          <Text style={styles.visualPillText}>3 picks</Text>
        </View>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={styles.visualRow}>
          <View style={[styles.visualDot, { backgroundColor: r.color }]} />
          <Text style={styles.visualLabel}>{r.label}</Text>
          <Text style={styles.visualTime}>{r.time}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * DC16: Real horizontal paging pager. Pages are laid out in a horizontal
 * ScrollView with pagingEnabled; `stepKey` is driven by onMomentumScrollEnd so
 * the dots always reflect where the user actually landed. The Next button
 * remains as a secondary/keyboard path — it programmatically scrolls to the
 * next page instead of toggling state directly, keeping both paths in sync.
 * The step is tracked by key, so a festival list that arrives while the intro
 * is open adds the "festival" page without moving the user off their page.
 */
export default function FirstRunIntro({ onDone }: { onDone: () => void }) {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const largeText = useLargeText();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const festivals = useFestivalDataStore((s) => s.festivals);
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const isLoading = useFestivalDataStore((s) => s.isLoading);
  const loadFestivals = useFestivalDataStore((s) => s.loadFestivals);
  const selectFestival = useFestivalDataStore((s) => s.selectFestival);

  const [stepKey, setStepKey] = useState<IntroStepKey>('plan');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);

  const { width: screenWidth } = useWindowDimensions();
  const previousWidth = useRef(screenWidth);

  // Cold install: the list may not be cached yet.
  useEffect(() => {
    if (festivals.length === 0 && !isLoading) {
      // The store error shows on the festival picker.
      loadFestivals().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const steps = useMemo(() => getIntroSteps(festivals.length), [festivals.length]);
  const index = Math.max(steps.indexOf(stepKey), 0);
  const isLast = index === steps.length - 1;
  const { choices, defaultId } = useMemo(
    () => introFestivalChoices(festivals, currentFestival?.id ?? null),
    [festivals, currentFestival?.id],
  );
  const selectedId = pickedId ?? defaultId;

  // Scroll to the target page programmatically (used by the Next button).
  const scrollToPage = useCallback(
    (page: number) => {
      scrollRef.current?.scrollTo({ x: page * screenWidth, animated: true });
    },
    [screenWidth],
  );

  // Leaving the festival step by any route (Next, swipe, a11y action) applies the choice.
  const commitFestival = useCallback(() => {
    if (selectedId && selectedId !== currentFestival?.id) {
      // The store error shows on the schedule, as in FestivalList.
      selectFestival(selectedId).catch(() => {});
    }
  }, [selectedId, currentFestival?.id, selectFestival]);

  // Update the dot indicator when a swipe lands on a page boundary.
  const handleMomentumScrollEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const page = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
      const target = steps[page];
      if (!target) return;
      if (stepKey === 'festival' && target !== 'festival') commitFestival();
      setStepKey(target);
    },
    [screenWidth, steps, stepKey, commitFestival],
  );

  const goTo = useCallback(
    (target: IntroStepKey | null) => {
      if (!target) return;
      if (stepKey === 'festival' && target !== 'festival') commitFestival();
      setStepKey(target);
      scrollToPage(steps.indexOf(target));
    },
    [steps, scrollToPage, stepKey, commitFestival],
  );

  const handleNext = useCallback(() => goTo(nextIntroStep(steps, stepKey)), [stepKey, goTo, steps]);

  const handleSkip = useCallback(() => {
    if (stepKey === 'festival' && pickedId) commitFestival();
    onDone();
  }, [stepKey, pickedId, commitFestival, onDone]);

  const handleCrewChoice = useCallback(
    (choice: IntroCrewChoice) => {
      const { start, needsAccount } = introCrewAction(choice, !!user);
      onDone();
      if (!start) return;
      if (needsAccount) {
        setReturnTo(`/(tabs)/crew?start=${start}`);
        router.push('/(auth)/register');
        return;
      }
      router.push({ pathname: '/(tabs)/crew', params: { start } });
    },
    [user, onDone, router],
  );

  const handleSignIn = useCallback(() => {
    onDone();
    router.push('/(auth)/login');
  }, [onDone, router]);

  // Keep the current page aligned after rotation, split-screen resize, or the
  // festival page joining the list.
  const previousStepCount = useRef(steps.length);
  useEffect(() => {
    if (previousWidth.current === screenWidth && previousStepCount.current === steps.length) return;
    previousWidth.current = screenWidth;
    previousStepCount.current = steps.length;
    scrollRef.current?.scrollTo({ x: index * screenWidth, animated: false });
  }, [index, screenWidth, steps.length]);

  const handleAccessibilityAction = useCallback(
    (actionName: string) => {
      const nextIndex =
        actionName === 'increment'
          ? Math.min(index + 1, steps.length - 1)
          : actionName === 'decrement'
            ? Math.max(index - 1, 0)
            : index;
      if (nextIndex === index) return;
      goTo(steps[nextIndex] ?? null);
    },
    [index, steps, goTo],
  );

  const renderSlide = (slideKey: 'plan' | 'crew' | 'reminders') => {
    const slide = ONBOARDING_SLIDES_SHARED.find((s) => s.key === slideKey)!;
    return (
      <>
        {/* Upper region. The product card (slide 1) anchors high — it has
            enough visual mass to own the top third. The bare icon slides
            center in the region instead: a 112px circle pinned to the top
            of a mostly-empty screen reads as unfinished. */}
        {!largeText && (
          <View style={[styles.hero, slideKey !== 'plan' && styles.heroCentered]}>
            {slideKey === 'plan' ? (
              <ProductVisual />
            ) : (
              <View
                style={styles.iconCircle}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Ionicons name={SLIDE_ICON[slideKey]} size={88} color={t.colors.accent.aqua} />
              </View>
            )}
          </View>
        )}

        {/* Value-first copy, anchored low (just above the controls). */}
        <View style={styles.copy}>
          <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            <DisplayWords text={slide.title} fontSize={styles.title.fontSize} />
          </Text>
          <Text style={styles.text}>{slide.description}</Text>
        </View>
      </>
    );
  };

  const renderFestivalStep = () => (
    <View style={styles.formPage}>
      <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {ONBOARDING_COPY.festival.title}
      </Text>
      <Text style={styles.text}>{ONBOARDING_COPY.festival.description}</Text>
      <View accessibilityRole="radiogroup" style={styles.choiceList}>
        {choices.map((f) => {
          const selected = f.id === selectedId;
          const dates = formatFestivalDateRange(f.startDate, f.endDate);
          return (
            <AppPressable
              key={f.id}
              onPress={() => setPickedId(f.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={dates ? `${f.name}, ${dates}` : f.name}
              style={[styles.choice, selected && styles.choiceSelected]}
            >
              <View style={styles.choiceText}>
                <Text style={styles.choiceName} maxFontSizeMultiplier={MAX_FONT_SCALE}>{f.name}</Text>
                {dates ? <Text style={styles.choiceDates} maxFontSizeMultiplier={MAX_FONT_SCALE}>{dates}</Text> : null}
              </View>
              {selected ? <Ionicons name="checkmark-circle" size={22} color={t.colors.accent.aqua} /> : null}
            </AppPressable>
          );
        })}
      </View>
    </View>
  );

  const renderGoingStep = () => (
    <View style={styles.formPage}>
      <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {ONBOARDING_COPY.going.title}
      </Text>
      <Text style={styles.text}>{ONBOARDING_COPY.going.description}</Text>
      <View style={styles.goingButtons}>
        <Button label={ONBOARDING_COPY.going.start} onPress={() => handleCrewChoice('start')} />
        <Button label={ONBOARDING_COPY.going.join} variant="secondary" onPress={() => handleCrewChoice('join')} />
        <Button label={ONBOARDING_COPY.going.solo} variant="ghost" onPress={() => handleCrewChoice('solo')} />
      </View>
      {!user ? (
        <View style={styles.signInRow}>
          <Text style={styles.signInPrompt} maxFontSizeMultiplier={MAX_FONT_SCALE}>{ONBOARDING_COPY.signInPrompt}</Text>
          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSignIn}
            accessibilityRole="button"
            accessibilityLabel={ONBOARDING_COPY.signIn}
          >
            <Text style={styles.signInLink} maxFontSizeMultiplier={MAX_FONT_SCALE}>{ONBOARDING_COPY.signIn}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.skipRow}>
        <TouchableOpacity
          testID="intro-skip"
          style={styles.skipButton}
          onPress={handleSkip}
          accessibilityRole="button"
          accessibilityLabel={ONBOARDING_COPY.skipA11y}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.skip} maxFontSizeMultiplier={MAX_FONT_SCALE}>{ONBOARDING_COPY.skip}</Text>
        </TouchableOpacity>
      </View>

      {/* Paging ScrollView — each step gets exactly one screen-width slot. */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        style={styles.pager}
        contentContainerStyle={styles.pagerContent}
        accessibilityRole="adjustable"
        accessibilityLabel="Intro slides"
        accessibilityValue={{ min: 1, max: steps.length, now: index + 1, text: `Step ${index + 1} of ${steps.length}` }}
        accessibilityActions={[
          { name: 'increment', label: 'Next step' },
          { name: 'decrement', label: 'Previous step' },
        ]}
        onAccessibilityAction={(event) => handleAccessibilityAction(event.nativeEvent.actionName)}
      >
        {steps.map((step) => (
          <ScrollView
            key={step}
            style={{ width: screenWidth }}
            contentContainerStyle={[styles.slide, largeText && styles.slideCentered]}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {step === 'festival' ? renderFestivalStep() : step === 'going' ? renderGoingStep() : renderSlide(step)}
          </ScrollView>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {steps.map((step) => (
            <View key={step} style={[styles.dot, step === steps[index] && styles.dotActive]} />
          ))}
        </View>
        {isLast ? null : <Button label={ONBOARDING_COPY.next} onPress={handleNext} style={styles.button} />}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  overlay: {
    ...({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const),
    backgroundColor: t.colors.bg.primary,
    zIndex: 100,
  },
  skipRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: t.spacing[3],
    paddingHorizontal: t.spacing[6],
  },
  skip: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  skipButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // DC16: pager container takes all remaining vertical space above the footer.
  pager: {
    flex: 1,
  },
  pagerContent: {
    // alignItems stretch so each slide fills the pager's cross-axis (height).
    // The pager itself gets height via flex:1, so this makes each slide fill
    // that measured height without needing an explicit pixel value.
    alignItems: 'stretch' as const,
  },
  // Each slide is exactly one screen-width wide (set inline from Dimensions).
  // Height is inherited from the content container's alignItems: 'stretch'.
  slide: {
    flexGrow: 1,
    paddingHorizontal: t.spacing[6],
  },
  // Hero hidden at large text: center the copy instead of anchoring it low.
  slideCentered: {
    justifyContent: 'center',
  },
  // Upper region: visual sits in the top third, not dead-centered. flex:1
  // fills remaining height so the copy block stays anchored at the bottom.
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: t.spacing[10],
  },
  // Icon slides (2/3): center the small glyph in the hero region; the
  // top-anchored layout only works when the visual fills the zone (slide 1).
  heroCentered: {
    justifyContent: 'center',
    paddingTop: 0,
  },
  // Form pages (festival, going) read top-down; the copy is not anchored low.
  formPage: {
    gap: t.spacing[3],
    paddingTop: t.spacing[6],
    paddingBottom: t.spacing[8],
  },
  choiceList: {
    gap: t.spacing[2],
    marginTop: t.spacing[2],
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    minHeight: 56,
    paddingVertical: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  choiceSelected: {
    borderColor: t.colors.accent.aqua,
  },
  choiceText: {
    flex: 1,
  },
  choiceName: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  choiceDates: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  goingButtons: {
    gap: t.spacing[3],
    marginTop: t.spacing[2],
  },
  signInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
  },
  signInPrompt: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  signInLink: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  copy: {
    gap: t.spacing[3],
    paddingBottom: t.spacing[8],
  },
  // 176px circle / 88px glyph: a 112px circle centered in the ~500px hero
  // region read as a small glyph lost in a void on device.
  iconCircle: {
    width: 176,
    height: 176,
    borderRadius: 88,
    alignItems: 'center',
    justifyContent: 'center',
    // aquaAlpha[12] (was [6]) gives enough fill to distinguish the circle
    // shape from a pure-black (#0a0a0a) background. Border bumped to [20]
    // so the container boundary reads clearly.
    backgroundColor: t.colors.aquaAlpha[12],
    borderWidth: 1,
    borderColor: t.colors.aquaAlpha[20],
  },
  // ── Product visual (slide 1) ───────────────────────────────────────────────
  visualCard: {
    width: '100%',
    maxWidth: 320,
    padding: t.spacing[4],
    gap: t.spacing[3],
    borderRadius: t.radii.lg,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  visualHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  visualDay: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  visualPill: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[20],
    borderWidth: 1,
    borderColor: t.colors.aquaAlpha[30],
  },
  visualPillText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  visualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingVertical: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.card,
  },
  visualDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  visualLabel: {
    ...typeStyle('label'),
    flex: 1,
    color: t.colors.text.primary,
  },
  visualTime: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  // ───────────────────────────────────────────────────────────────────────────
  title: {
    ...typeStyle('heading'),
    color: t.colors.text.primary,
  },
  text: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  footer: {
    gap: t.spacing[4],
    paddingBottom: t.spacing[6],
    paddingHorizontal: t.spacing[6],
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: t.spacing[2],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    // border.light is only rgba(255,255,255,0.1) — near-invisible on #0a0a0a.
    // text.muted keeps inactive dots a clear progress indicator in both themes.
    backgroundColor: t.colors.text.muted,
  },
  dotActive: {
    backgroundColor: t.colors.accent.aqua,
    width: 20,
    borderRadius: 9999,
  },
  // CTA layout only — fill/ink/radius live in components/Button (F8). Keeps the
  // taller intro-CTA padding.
  button: {
    paddingVertical: t.spacing[4],
  },
}));

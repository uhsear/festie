import { createRef, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, Share2 } from 'lucide-react';
import type { WrapCard } from '@festie/shared/types';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import PosterPreview from './PosterPreview';
import WrapCardPoster from './WrapCardPoster';
import ConfettiBurst from './ConfettiBurst';

interface Props {
  cards: WrapCard[];
  festivalName: string;
  byline: string | null;
  sharing: boolean;
  /** Called with the current card's unscaled 1080x1920 node and its index. */
  onShare: (node: HTMLElement, index: number) => void;
}

/** Active poster width on desktop; phones fill the row. */
export const DESKTOP_POSTER_WIDTH = 480;
const DESKTOP_MIN_VIEWPORT = 1024;
/**
 * Side posters shrink to 80% and their boxes overlap so three fit a laptop. A side poster's drawn edge sits
 * width * (1 - SIDE_SCALE) / 2 inside its box, and two margins of SIDE_OVERLAP join each pair, so the
 * overlap may be at most half of that inset: more would paint the side poster over the active one.
 */
export const SIDE_SCALE = 0.8;
export const SIDE_OVERLAP = 24;

/** Swipeable row of Wrap cards, each a scaled preview of its 1080x1920 poster. */
export default function WrapCarousel({ cards, festivalName, byline, sharing, onShare }: Props) {
  const reduceMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [layout, setLayout] = useState({ desktop: false, width: 270 });
  const cardRefs = useMemo(() => cards.map(() => createRef<HTMLDivElement>()), [cards]);

  useLayoutEffect(() => {
    const measure = () => {
      const desktop = window.innerWidth >= DESKTOP_MIN_VIEWPORT;
      const rowWidth = listRef.current?.clientWidth || 270;
      const width = desktop ? DESKTOP_POSTER_WIDTH : rowWidth;
      setLayout((prev) => (prev.desktop === desktop && prev.width === width ? prev : { desktop, width }));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const goTo = useCallback(
    (i: number) => {
      const el = listRef.current;
      if (!el) return;
      const next = Math.min(Math.max(i, 0), cards.length - 1);
      const slide = el.children[next] as HTMLElement | undefined;
      const left = slide ? slide.offsetLeft + slide.offsetWidth / 2 - el.clientWidth / 2 : 0;
      el.scrollTo({ left, behavior: reduceMotion ? 'auto' : 'smooth' });
      setIndex(next);
      if (next === cards.length - 1) setReachedEnd(true);
    },
    [cards.length, reduceMotion],
  );

  const onScroll = () => {
    const el = listRef.current;
    if (!el || el.clientWidth === 0) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestDistance = Infinity;
    Array.from(el.children).forEach((child, i) => {
      const c = child as HTMLElement;
      const distance = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    setIndex(best);
    if (best === cards.length - 1) setReachedEnd(true);
  };

  const share = () => {
    const node = cardRefs[index]?.current;
    if (node) onShare(node, index);
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Your wrap cards">
      <div className="relative">
        <div
          ref={listRef}
          onScroll={onScroll}
          className="flex overflow-x-auto snap-x snap-mandatory [scrollbar-width:none]"
          style={layout.desktop ? { paddingInline: `calc(50% - ${layout.width / 2 - SIDE_OVERLAP}px)` } : undefined}
        >
          {cards.map((card, i) => (
            <div
              key={card.kind}
              role="group"
              aria-roledescription="slide"
              aria-label={`Card ${i + 1} of ${cards.length}`}
              className="group shrink-0 snap-center transition-[transform,opacity] duration-(--duration-fast)"
              style={
                layout.desktop
                  ? {
                      width: layout.width,
                      marginInline: -SIDE_OVERLAP,
                      transform: i === index ? undefined : `scale(${SIDE_SCALE})`,
                      opacity: i === index ? 1 : 0.6,
                    }
                  : { width: '100%' }
              }
            >
              <PosterPreview ref={cardRefs[i]} width={layout.width}>
                <WrapCardPoster card={card} festivalName={festivalName} byline={byline} />
              </PosterPreview>
            </div>
          ))}
        </div>
        {reachedEnd && index === cards.length - 1 && <ConfettiBurst />}
      </div>

      <div className="mx-auto flex w-full max-w-lg flex-wrap items-center justify-center gap-2 px-6">
        <IconButton
          label="Previous card"
          icon={<ChevronLeft className="w-5 h-5" />}
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
        />
        <div className="flex flex-wrap items-center justify-center">
          {cards.map((card, i) => (
            <button
              key={card.kind}
              type="button"
              aria-label={`Card ${i + 1} of ${cards.length}`}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => goTo(i)}
              className="min-h-11 min-w-11 flex items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
            >
              <span
                className={`block h-2 w-2 rounded-full ${i === index ? 'bg-accent-aqua' : 'bg-border-light'}`}
              />
            </button>
          ))}
        </div>
        <IconButton
          label="Next card"
          icon={<ChevronRight className="w-5 h-5" />}
          onClick={() => goTo(index + 1)}
          disabled={index === cards.length - 1}
        />
      </div>

      <Button variant="primary" fullWidth isLoading={sharing} onClick={share} className="min-h-[44px]">
        <Share2 className="w-4 h-4" aria-hidden="true" />
        {sharing ? 'Preparing…' : 'Share this card'}
      </Button>
    </section>
  );
}

import { createRef, useCallback, useMemo, useRef, useState } from 'react';
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

/** Swipeable row of Wrap cards, each a scaled preview of its 1080x1920 poster. */
export default function WrapCarousel({ cards, festivalName, byline, sharing, onShare }: Props) {
  const reduceMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [reachedEnd, setReachedEnd] = useState(false);
  const cardRefs = useMemo(() => cards.map(() => createRef<HTMLDivElement>()), [cards]);

  const goTo = useCallback(
    (i: number) => {
      const el = listRef.current;
      if (!el) return;
      const next = Math.min(Math.max(i, 0), cards.length - 1);
      el.scrollTo({ left: next * el.clientWidth, behavior: reduceMotion ? 'auto' : 'smooth' });
      setIndex(next);
      if (next === cards.length - 1) setReachedEnd(true);
    },
    [cards.length, reduceMotion],
  );

  const onScroll = () => {
    const el = listRef.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setIndex(i);
    if (i === cards.length - 1) setReachedEnd(true);
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
        >
          {cards.map((card, i) => (
            <div
              key={card.kind}
              role="group"
              aria-roledescription="slide"
              aria-label={`Card ${i + 1} of ${cards.length}`}
              className="group w-full shrink-0 snap-center"
            >
              <PosterPreview ref={cardRefs[i]}>
                <WrapCardPoster card={card} festivalName={festivalName} byline={byline} />
              </PosterPreview>
            </div>
          ))}
        </div>
        {reachedEnd && index === cards.length - 1 && <ConfettiBurst />}
      </div>

      <div className="flex items-center justify-center gap-2">
        <IconButton
          label="Previous card"
          icon={<ChevronLeft className="w-5 h-5" />}
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
        />
        <div className="flex items-center">
          {cards.map((card, i) => (
            <button
              key={card.kind}
              type="button"
              aria-label={`Card ${i + 1} of ${cards.length}`}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => goTo(i)}
              className="min-h-11 min-w-6 flex items-center justify-center"
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

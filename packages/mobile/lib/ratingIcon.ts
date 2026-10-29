import type { Ionicons } from '@expo/vector-icons';

// Ionicons for the 5-tier rating scale (web uses Lucide Flame/Smile/ThumbsUp/Meh/ThumbsDown).
export const RATING_IONICON: Record<number, keyof typeof Ionicons.glyphMap> = {
  5: 'flame',
  4: 'happy',
  3: 'thumbs-up',
  2: 'remove',
  1: 'thumbs-down',
};

/**
 * Prop groups shared by the two compose states. ComposeScreen owns all
 * state; these bundles keep the child component signatures readable
 * instead of 30-odd flat props.
 */
import type { KeyboardEvent } from 'react';
import type { ReplyContext } from '../../types';

/** Reply-context affordances (card / banner / clear) used by both states. */
export interface ReplyContextControls {
  replyContext: ReplyContext | null;
  captureModeIsReplyContext: boolean;
  onToggleReplyContextMode: () => void;
  onClearReplyContext: () => void;
}

/** The brief — bullets textarea + character-cap toggle — used by both states. */
export interface BriefControls {
  bullets: string;
  setBullets: (v: string) => void;
  charCap: boolean;
  setCharCap: (v: boolean) => void;
  softCapChars: number;
  /** Bullet mode: the box writes real • bullets and the request carries
   *  an explicit fragments signal for the intent framing. */
  bulleted: boolean;
  setBulleted: (v: boolean) => void;
  onGenKey: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

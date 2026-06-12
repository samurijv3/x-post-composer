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
  onGenKey: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/** One bundle as the picker shows it — the count is the RESOLVED
 *  member count (dangling ids excluded), i.e. exactly how many voice
 *  examples seeding from it would send. */
export interface BundleOption {
  id: string;
  name: string;
  memberCount: number;
}

/** The voice-seed picker (Phase 6). ComposeScreen passes null when no
 *  bundles exist, hiding the control entirely — a power feature stays
 *  out of the default path. `selectedId` drives the NEXT generation;
 *  an active draft's own seed is shown separately from its content. */
export interface BundlePickerControls {
  bundles: BundleOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

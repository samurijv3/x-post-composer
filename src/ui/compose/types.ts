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

/** Thread-mode controls (roadmap Phase 10): the post↔thread switch and
 *  the ≈N post-target stepper. ComposeScreen passes null while a reply
 *  context exists — threads are standalone posts in v1, so reply mode
 *  forces single-tweet composition and the control disappears. */
export interface ThreadModeControls {
  composeMode: 'single' | 'thread';
  onSetMode: (mode: 'single' | 'thread') => void;
  /** The ≈N target. Pre-draft it just seeds the next generation; over
   *  an ACTIVE thread draft, changing it fires a repack refine. */
  target: number;
  onSetTarget: (n: number) => void;
  /** Disables the stepper while a request is in flight. */
  busy: boolean;
}

/** One bundle as the picker shows it — the count is the RESOLVED
 *  member count (dangling ids excluded), i.e. exactly how many voice
 *  examples seeding from it would send. */
export interface BundleOption {
  id: string;
  name: string;
  memberCount: number;
  /** Dangling member ids — surfaced honestly in the seed menu. */
  missingCount: number;
}

/** The voice-seed picker (Phase 6). Always rendered — with zero
 *  bundles it shows the default-sample option plus a create-one-in-
 *  Voice hint, so the feature is discoverable before it's usable.
 *  `selectedId` drives the NEXT generation; an active draft's own seed
 *  is shown separately from its content. */
export interface BundlePickerControls {
  bundles: BundleOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

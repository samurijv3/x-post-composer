import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  consumeAutoReplyFlag,
  countItems,
  getAllBundles,
  getAllItems,
  getCaptureMode,
  getReplyContextLock,
  getSettings,
  setCaptureMode,
  setReplyContextLock,
  subscribeCaptureMode,
  subscribeReplyContextLock,
  subscribeSettings,
} from '../storage';
import { isMessageOfType, onNotice, sendToBackground, type BackgroundReply } from '../messaging';
import { weightedLength, X_HARD_LIMIT } from '../lib/counting';
import { resolveBundleMembers } from '../lib/bundles';
import { isSameTweet, mergeReplyContextSelection } from '../lib/replyContext';
import {
  BULLET_PREFIX,
  emitDraftCommit,
  hasBulletLines,
  INITIAL_DRAFT_LIFECYCLE,
  normalizeTypedBullets,
  onDraftCommit,
  reduceDraftLifecycle,
  stripBulletPrefixes,
} from '../lib/draft';
import { DEFAULT_THREAD_TARGET, joinSegments } from '../lib/thread';
import type {
  ChipPreset,
  GenerationRequest,
  GenerationResult,
  RefineRequest,
  ReplyContext,
  Settings,
} from '../types';
import type { ToastData } from './Toast';
import { PreDraftState } from './compose/PreDraftState';
import { DraftState, type DraftView, type RefineControls } from './compose/DraftState';
import type { ErrorKind } from './compose/ErrorCard';
import type {
  BriefControls,
  BundleOption,
  BundlePickerControls,
  ReplyContextControls,
  ThreadModeControls,
} from './compose/types';

interface Props {
  onToast: (msg: string, action?: ToastData['action']) => void;
  onOpenOptions: () => void;
}

/**
 * Compose — owns all composition state and the background round-trips;
 * rendering lives in ./compose (PreDraftState before a draft exists,
 * DraftState after).
 */
export function ComposeScreen({ onToast, onOpenOptions }: Props) {
  // ---- settings + library counts (live) ----
  const [chips, setChips] = useState<ChipPreset[]>([]);
  const [charCap, setCharCap] = useState<boolean>(true);
  const [softCapChars, setSoftCapChars] = useState<number>(1000);
  const [libraryCount, setLibraryCount] = useState<number>(0);

  // The Phase 4 corpus loop's global switch, mirrored live; the
  // per-draft override below resets to it on every new generation.
  const [saveShippedDefault, setSaveShippedDefault] = useState<boolean>(true);
  useEffect(() => {
    let cancelled = false;
    async function loadSettings(): Promise<void> {
      const s: Settings = await getSettings();
      if (cancelled) return;
      setChips(s.chips);
      setCharCap(s.charCapDefault);
      setSoftCapChars(s.softCapChars);
      setSaveShippedDefault(s.saveShippedDrafts);
    }
    void loadSettings();
    const unsub = subscribeSettings((s) => {
      setChips(s.chips);
      setSoftCapChars(s.softCapChars);
      setSaveShippedDefault(s.saveShippedDrafts);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const refreshLibraryCount = useCallback(async () => {
    try {
      setLibraryCount(await countItems());
    } catch {
      setLibraryCount(0);
    }
  }, []);

  useEffect(() => {
    void refreshLibraryCount();
  }, [refreshLibraryCount]);

  // ---- bundles (Phase 6): the voice-seed picker ----
  // Counts are RESOLVED member counts — what seeding would actually
  // send — so the picker never claims members that no longer exist.
  const [bundleOptions, setBundleOptions] = useState<BundleOption[]>([]);
  const [seedBundleId, setSeedBundleId] = useState<string | null>(null);
  const refreshBundleOptions = useCallback(async () => {
    try {
      const [allBundles, allItems] = await Promise.all([getAllBundles(), getAllItems()]);
      allBundles.sort((a, b) => b.createdAt - a.createdAt);
      setBundleOptions(
        allBundles.map((b) => ({
          id: b.id,
          name: b.name,
          memberCount: resolveBundleMembers(b.memberIds, allItems).members.length,
        })),
      );
    } catch {
      setBundleOptions([]);
    }
  }, []);
  useEffect(() => {
    void refreshBundleOptions();
    const unsub = onNotice((notice) => {
      if (
        isMessageOfType(notice, 'bg:bundles-changed') ||
        isMessageOfType(notice, 'bg:library-changed')
      ) {
        void refreshBundleOptions();
      }
    });
    return () => unsub();
  }, [refreshBundleOptions]);
  // A picked bundle that disappears (deleted in Voice) resets the
  // picker to the default sample rather than silently misadvertising.
  useEffect(() => {
    if (seedBundleId !== null && !bundleOptions.some((b) => b.id === seedBundleId)) {
      setSeedBundleId(null);
    }
  }, [bundleOptions, seedBundleId]);

  // ---- reply context lock ----
  const [replyContext, setReplyContext] = useState<ReplyContext | null>(null);
  useEffect(() => {
    const unsub = subscribeReplyContextLock(setReplyContext);
    return () => unsub();
  }, []);
  const [captureMode, setCaptureModeState] = useState<'none' | 'library' | 'reply-context'>('none');
  useEffect(() => {
    void getCaptureMode().then(setCaptureModeState);
    const unsub = subscribeCaptureMode(setCaptureModeState);
    return () => unsub();
  }, []);

  // ---- keyboard shortcut (Alt-Shift-R): auto-capture reply context ----
  // The background opens the panel, stamps a one-shot session flag, and
  // broadcasts a notice — both carrying the same timestamp. A panel
  // opened BY the shortcut consumes the flag on mount; a panel that was
  // already open hears the broadcast. The shared stamp dedupes the pair.
  const lastShortcutAt = useRef<number>(0);
  const captureFromShortcut = useCallback(
    async (at: number) => {
      if (at <= lastShortcutAt.current) return;
      lastShortcutAt.current = at;
      try {
        const reply = await sendToBackground<
          Extract<BackgroundReply, { type: 'bg:reply-context-result' }>
        >({ type: 'panel:capture-reply-context' });
        if (reply.ok && reply.context) {
          // Composer-anchored extraction reads X's dialog copies, which
          // can be metadata-poor — merge a re-delivery of the same
          // tweet instead of degrading the lock. Read the current lock
          // fresh (the React state here may be a stale closure).
          await setReplyContextLock(
            mergeReplyContextSelection(await getReplyContextLock(), reply.context),
          );
        } else {
          onToast(reply.message ?? 'Could not capture reply context.');
        }
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Could not capture reply context.');
      }
    },
    [onToast],
  );
  useEffect(() => {
    void consumeAutoReplyFlag().then((at) => {
      // Ignore stale flags (a shortcut pressed for a long-gone panel);
      // 15s comfortably covers a slow panel load.
      if (at !== null && Date.now() - at < 15_000) void captureFromShortcut(at);
    });
    const unsub = onNotice((notice) => {
      if (isMessageOfType(notice, 'bg:auto-reply-capture')) {
        void captureFromShortcut(notice.at);
      }
    });
    return () => unsub();
  }, [captureFromShortcut]);

  // ---- composition state ----
  const [bullets, setBullets] = useState<string>('');
  // Thread mode (Phase 10): the post↔thread switch + the ≈N target.
  // Reply context forces single-tweet reply mode (posts-only threads),
  // so the effective request mode derives from both.
  const [composeMode, setComposeMode] = useState<'single' | 'thread'>('single');
  const [threadTarget, setThreadTarget] = useState<number>(DEFAULT_THREAD_TARGET);
  // Scoped refines (thread cards): when set, chips and the steer box
  // aim at this post instead of the whole thread. One visible scope,
  // cleared by its ×, a new generation, or the post disappearing.
  const [steerScope, setSteerScope] = useState<number | null>(null);
  // The draft lifecycle (empty → generating → active → committed) is a
  // pure reducer in lib/draft — every consequential transition,
  // including stale-request gating and both undo scopes, is decided
  // (and tested) there. This component only dispatches events and
  // renders the result.
  const [lifecycle, dispatchDraft] = useReducer(reduceDraftLifecycle, INITIAL_DRAFT_LIFECYCLE);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [steerText, setSteerText] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [chipCounts, setChipCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<ErrorKind | null>(null);
  // Per-draft override of the shipped-corpus loop ("not every drafted
  // tweet should shape future voice"). Resets to the setting on every
  // new generation; consulted by the commit listener via ref.
  const [shipToVoice, setShipToVoice] = useState<boolean>(true);
  const shipToVoiceRef = useRef(shipToVoice);
  shipToVoiceRef.current = shipToVoice;
  const saveShippedDefaultRef = useRef(saveShippedDefault);
  saveShippedDefaultRef.current = saveShippedDefault;
  // Per-draft override of bundle auto-filing — same pattern: a seeded
  // draft files back into its bundle by default, but borrowing a
  // bundle's voice for a one-off shouldn't grow the series. Resets ON
  // per generation; consulted by the commit listener via ref.
  const [fileToBundle, setFileToBundle] = useState<boolean>(true);
  const fileToBundleRef = useRef(fileToBundle);
  fileToBundleRef.current = fileToBundle;

  // Latest-call-wins coordination (the reducer's pendingSeq is the
  // authoritative gate; this ref numbers the requests and lets the
  // error paths skip stale toasts).
  const requestSeq = useRef<number>(0);
  // Render-fresh mirrors for async handlers and []-deps effects.
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;
  const replyContextRef = useRef(replyContext);
  replyContextRef.current = replyContext;

  const hasContext = replyContext !== null;
  const content = lifecycle.content;
  const hasDraft = lifecycle.phase !== 'empty';
  const busy = lifecycle.phase === 'generating';

  // ---- timed undo (replacement scope, ~5 s Gmail convention) ----
  // The reducer holds the snapshot; this is the only timer. A panel
  // close during the window means the replacement stands (in-panel
  // state, deliberately unpersisted).
  const REPLACEMENT_UNDO_MS = 5000;
  useEffect(() => {
    if (lifecycle.replaced === null) return;
    const t = window.setTimeout(
      () => dispatchDraft({ type: 'replacement-expired' }),
      REPLACEMENT_UNDO_MS,
    );
    return () => window.clearTimeout(t);
  }, [lifecycle.replaced]);

  // Set when the timed undo is about to restore a previous lock: the
  // restore write echoes back through the lock subscription, and the
  // new-context effect must not read its own restoration as yet
  // another "new context" (which would re-clear the just-restored
  // draft). Consumed on first match.
  const suppressNewContextRef = useRef<ReplyContext | null>(null);

  const fireReplacementToast = useCallback(
    (message: string) => {
      onToast(message, {
        label: 'Undo',
        onClick: () => {
          // Read the snapshot BEFORE dispatching: a new-context clear
          // took the whole workbench (draft + angle + the previous
          // lock), so one Undo restores the whole workbench.
          const snapshot = lifecycleRef.current.replaced;
          dispatchDraft({ type: 'replacement-undone' });
          if (snapshot?.workbench) {
            setBullets(snapshot.workbench.bullets);
            const restoreLock = snapshot.workbench.replyContext;
            if (restoreLock !== null) suppressNewContextRef.current = restoreLock;
            void setReplyContextLock(restoreLock);
          }
        },
      });
    },
    [onToast],
  );

  // ---- new context clears the active draft (guarded by timed undo) ----
  // "New context" = a reply-context lock arriving that is a different
  // tweet from the immediately-previous lock (same-tweet re-deliveries
  // are enrichments, not new context). Clearing the lock is NOT new
  // context — the draft stays.
  const prevLockRef = useRef<ReplyContext | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevLockRef.current;
    prevLockRef.current = replyContext;
    if (prev === undefined) return; // initial subscription fire
    if (replyContext === null) return; // cleared ≠ new
    // The timed undo restoring the previous lock echoes back through
    // this subscription — that restoration is not a new context.
    const suppressed = suppressNewContextRef.current;
    if (suppressed !== null && isSameTweet(suppressed, replyContext)) {
      suppressNewContextRef.current = null;
      return;
    }
    if (prev !== null && isSameTweet(prev, replyContext)) return; // enrichment
    const lc = lifecycleRef.current;
    if (lc.content === null && lc.phase !== 'generating') return; // nothing to clear
    const hadDraft = lc.content !== null;
    // The whole workbench was built against the old context — draft,
    // angle text, and the lock itself clear as one, and the timed undo
    // restores them as one.
    dispatchDraft({ type: 'new-context', bullets, previousContext: prev });
    setBullets('');
    if (hadDraft) fireReplacementToast('Draft cleared — new reply context');
  }, [replyContext, bullets, fireReplacementToast]);

  // ---- handlers ----
  async function toggleReplyContextMode(): Promise<void> {
    await setCaptureMode(captureMode === 'reply-context' ? 'none' : 'reply-context');
  }
  async function clearReplyContext(): Promise<void> {
    await setReplyContextLock(null);
  }

  async function generate(opts: { isRegenerate: boolean }): Promise<void> {
    if (!opts.isRegenerate && bullets.trim() === '') return;
    setError(null);
    setExpanded(false);
    setChipCounts({});
    setSteerScope(null);
    if (!opts.isRegenerate) setSteerText('');
    const myId = ++requestSeq.current;
    // Whether this generate will REPLACE a visible draft decides the
    // timed-undo toast when it lands.
    const replacesDraft = lifecycleRef.current.content !== null;
    // A new draft gets a fresh per-draft loop decision.
    setShipToVoice(saveShippedDefaultRef.current);
    setFileToBundle(true);
    dispatchDraft({ type: 'generation-started', seq: myId });
    const effectiveMode = hasContext ? 'reply' : composeMode === 'thread' ? 'thread' : 'post';
    const request: GenerationRequest = {
      mode: effectiveMode,
      bullets,
      charCap,
      replyContext: hasContext ? replyContext : null,
      isRegenerate: opts.isRegenerate,
      // Derived, not a mode: any bullet line present = fragments signal.
      bulletedInput: hasBulletLines(bullets),
      // The picker's selection seeds THIS generation; the background
      // resolves it (and errors honestly if it was just deleted).
      bundleId: seedBundleId,
      ...(effectiveMode === 'thread' && { targetCount: threadTarget }),
    };
    try {
      const reply = await sendToBackground<
        Extract<BackgroundReply, { type: 'bg:generation-result' }>
      >({ type: 'panel:generate', request });
      if (myId !== requestSeq.current) return;
      applyResult(reply.result, myId, replacesDraft, request.bundleId ?? null);
      void refreshLibraryCount();
    } catch (err) {
      if (myId !== requestSeq.current) return;
      dispatchDraft({ type: 'generation-failed', seq: myId });
      setError('other');
      onToast(err instanceof Error ? err.message : 'Generation failed.');
    }
  }

  function applyResult(
    result: GenerationResult,
    seq: number,
    replacesDraft: boolean,
    // The bundle that seeded a GENERATE; refines pass null and the
    // reducer keeps the draft's existing seed.
    seedBundleId: string | null = null,
    // A scoped thread refine: splice exactly this post (the reducer
    // enforces it — only that post's copied flag resets).
    scope: number | null = null,
  ): void {
    if (!result.ok) {
      dispatchDraft({ type: 'generation-failed', seq });
      setError(result.kind);
      return;
    }
    setError(null);
    if (scope !== null) {
      const post = result.draft.posts[0];
      dispatchDraft({
        type: 'post-replaced',
        seq,
        postIndex: scope,
        post: {
          text: post?.text ?? '',
          residualViolations: post?.residualViolations ?? [],
        },
        wasRepaired: result.wasRepaired,
      });
      return;
    }
    dispatchDraft({
      type: 'generation-succeeded',
      seq,
      // The result's posts map 1:1 onto lifecycle posts — length 1 for
      // singles, the thread's segments otherwise.
      draft: {
        kind: result.kind,
        posts: result.draft.posts.map((p) => ({
          text: p.text,
          residualViolations: p.residualViolations,
        })),
        wasRepaired: result.wasRepaired,
        targetCount: result.targetCount,
      },
      seedBundleId,
    });
    if (replacesDraft) fireReplacementToast('Draft replaced');
  }

  async function applyChip(chip: ChipPreset): Promise<void> {
    if (busy || content === null) return;
    setFlash(chip.id);
    const nextCount = (chipCounts[chip.id] ?? 0) + 1;
    setChipCounts((c) => ({ ...c, [chip.id]: nextCount }));
    window.setTimeout(() => setFlash(null), 550);
    // Pass the per-chip press count as `intensity` — background uses
    // it to escalate the chip's instruction wording so the AI takes
    // each subsequent press more seriously.
    await runRefine({ type: 'chip', chipId: chip.id, intensity: nextCount }, undefined, scopeArg());
  }

  async function applySteer(): Promise<void> {
    if (busy || content === null) return;
    if (steerText.trim() === '') return;
    setChipCounts({});
    await runRefine({ type: 'freeform', instruction: steerText }, undefined, scopeArg());
  }

  // The aim, validated at use: it only means something over a thread
  // draft and a post that still exists.
  function scopeArg(): number | undefined {
    const c = lifecycleRef.current.content;
    if (c?.kind !== 'thread' || steerScope === null || steerScope >= c.posts.length) {
      return undefined;
    }
    return steerScope;
  }

  async function rewritePost(postIndex: number): Promise<void> {
    if (busy || content === null) return;
    await runRefine({ type: 'rewrite' }, undefined, postIndex);
  }

  async function applyPolish(): Promise<void> {
    if (busy || content === null) return;
    // One refine invocation with the code-supplied polish instruction;
    // the one-level refine undo covers it like any other refine.
    await runRefine({ type: 'polish' });
  }

  function handleCapToggle(next: boolean): void {
    setCharCap(next);
    // Flipping OFF never touches the text; pre-generation behavior is
    // unchanged (no draft → the toggle is just a setting).
    if (!next || busy) return;
    const lc = lifecycleRef.current;
    if (lc.phase !== 'active' || lc.content === null) return;
    if (lc.content.kind === 'thread') {
      // Per-post refit: only fires when some post actually measures
      // over — same content, re-fitted per post, never a regenerate.
      const anyOver = lc.content.posts.some((post) => weightedLength(post.text) > X_HARD_LIMIT);
      if (!anyOver) return;
      onToast('Refitting \u2014 same thread, each post \u2264280');
      void runRefine({ type: 'refit' }, true);
      return;
    }
    if (weightedLength(lc.content.posts[0]?.text ?? '') <= X_HARD_LIMIT) return; // already fits
    // REFIT, never regenerate: the draft's content is the fixed point.
    onToast('Refitting to \u2264280 \u2014 same draft, shorter');
    void runRefine({ type: 'refit' }, true);
  }

  async function runRefine(
    kind: RefineRequest['kind'],
    capOverride?: boolean,
    scope?: number,
  ): Promise<void> {
    const myId = ++requestSeq.current;
    // Refine reshapes the CURRENT draft — hand edits included; threads
    // travel joined in the --- wire format. Only the model's output
    // gets re-checked; the user's words went in as-is.
    const current = lifecycleRef.current.content;
    const isThreadDraft = current?.kind === 'thread';
    const effectiveScope = isThreadDraft && scope !== undefined ? scope : null;
    const previousDraftText = isThreadDraft
      ? joinSegments(current.posts.map((p) => p.text))
      : (current?.posts[0]?.text ?? '');
    dispatchDraft({ type: 'refine-started', seq: myId });
    const request: RefineRequest = {
      mode: isThreadDraft ? 'thread' : hasContext ? 'reply' : 'post',
      previousDraftText,
      // The refit fires in the same tick as the toggle flip, before the
      // charCap state has re-rendered — the caller passes the new value.
      charCap: capOverride ?? charCap,
      ...(effectiveScope !== null && { scope: effectiveScope }),
      kind,
    };
    try {
      const reply = await sendToBackground<
        Extract<BackgroundReply, { type: 'bg:generation-result' }>
      >({ type: 'panel:refine', request });
      if (myId !== requestSeq.current) return;
      applyResult(reply.result, myId, false, null, effectiveScope);
    } catch (err) {
      if (myId !== requestSeq.current) return;
      dispatchDraft({ type: 'generation-failed', seq: myId });
      setError('other');
      onToast(err instanceof Error ? err.message : 'Refine failed.');
    }
  }

  function undo(): void {
    dispatchDraft({ type: 'refine-undone' });
    setChipCounts({});
  }

  function editPost(postIndex: number, text: string): void {
    dispatchDraft({ type: 'hand-edited', postIndex, text });
  }

  // Copy ONE post — clipboard + the lifecycle's post-copied. The
  // corpus event fires from the committed-transition effect below, so
  // copying here is deliberately side-effect-light.
  const copyPost = useCallback(
    async (postIndex: number): Promise<void> => {
      const current = lifecycleRef.current;
      if (current.content === null || current.phase === 'generating') return;
      const text = current.content.posts[postIndex]?.text;
      if (text === undefined) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        dispatchDraft({ type: 'post-copied', postIndex });
        onToast(
          current.content.kind === 'thread'
            ? `Copied post ${String(postIndex + 1)}/${String(current.content.posts.length)}`
            : 'Copied to clipboard',
        );
        window.setTimeout(() => setCopied(false), 1500);
      } catch {
        onToast('Could not copy.');
      }
    },
    [onToast],
  );

  // Copy-next: the single draft's one post, or the first uncopied post
  // of a thread — the ⌃⇧↵ shortcut and the big button share this
  // (sequential paste-into-X workflow). All-copied re-copies post 1,
  // which is idempotent.
  const copyNext = useCallback(async (): Promise<void> => {
    const content = lifecycleRef.current.content;
    if (content === null) return;
    const next = content.posts.findIndex((post) => !post.copied);
    await copyPost(next === -1 ? 0 : next);
  }, [copyPost]);

  // The corpus half of "done": fire the commit EVENT exactly when the
  // lifecycle crosses into committed (every post copied since its last
  // change). Singles cross on their one copy; threads on the last
  // card. Re-copying an unchanged committed draft doesn't re-cross, so
  // nothing double-fires; editing un-commits, and the next full copy
  // crosses again (the dedupe downstream makes that refresh, not a
  // duplicate).
  const prevPhaseRef = useRef(lifecycle.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = lifecycle.phase;
    if (lifecycle.phase !== 'committed' || prev === 'committed') return;
    const content = lifecycleRef.current.content;
    if (content === null) return;
    const isThread = content.kind === 'thread';
    const texts = content.posts.map((post) => post.text);
    emitDraftCommit({
      text: isThread ? joinSegments(texts) : (texts[0] ?? ''),
      segments: isThread ? texts : null,
      mode: isThread ? 'thread' : replyContextRef.current !== null ? 'reply' : 'post',
      handEdited: content.handEdited,
      // Explicit provenance, read from the draft itself — never
      // inferred from the picker, which may have moved on.
      seedBundleId: content.seedBundleId,
      committedAt: Date.now(),
    });
    if (isThread) onToast('All posts copied — thread committed');
  }, [lifecycle.phase, onToast]);

  // The Phase 4 corpus loop listener: the commit hook fires on copy;
  // when the global setting AND the per-draft override allow, the
  // committed text goes to the background to be saved as a 'shipped'
  // voice example (deduped there).
  useEffect(() => {
    const unsub = onDraftCommit((commit) => {
      if (!saveShippedDefaultRef.current || !shipToVoiceRef.current) return;
      sendToBackground({
        type: 'panel:draft-committed',
        text: commit.text,
        segments: commit.segments,
        mode: commit.mode,
        // The per-draft filing override: off means the shipped example
        // still saves but the bundle doesn't grow.
        bundleId: fileToBundleRef.current ? commit.seedBundleId : null,
      }).catch(() => {
        onToast('Copied — but saving it to Voice failed.');
      });
    });
    return () => unsub();
  }, [onToast]);

  // Panel-scoped copy shortcut: Ctrl+Shift+Enter. Field-verified on
  // macOS Chrome: ⌘⇧↵ never reaches the panel's keydown (consumed
  // upstream), while ⌃⇧↵ arrives fine — so Ctrl is the binding on
  // every platform and the UI says so; metaKey stays accepted
  // opportunistically for platforms that do deliver it. Panel-scoped
  // is a hard constraint, not a choice: key events only reach this
  // document while the panel has focus, and the clipboard can only be
  // written from the focused document anyway. Capture phase so no
  // inner handler can swallow it.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      void copyNext();
    }
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [copyNext]);

  function discard(): void {
    dispatchDraft({ type: 'discarded' });
    setBullets('');
    setSteerText('');
    setSteerScope(null);
    setExpanded(false);
    setChipCounts({});
    setError(null);
    onToast('Started over');
  }

  function retry(): void {
    setError(null);
    void generate({ isRegenerate: lifecycleRef.current.content !== null });
  }

  function genKey(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Shift+mod+Enter is the copy shortcut (window-level) — let it pass.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault();
      if (!busy && bullets.trim() !== '') void generate({ isRegenerate: false });
      return;
    }
    const el = e.currentTarget;
    // Typing a space right after a lone -/* at the start of a line is
    // bullet intent — convert to the real glyph in place (setRangeText
    // keeps the caret native; state syncs from the DOM value).
    if (e.key === ' ' && !e.metaKey && !e.ctrlKey && el.selectionStart === el.selectionEnd) {
      const caret = el.selectionStart;
      const lineStart = el.value.lastIndexOf('\n', caret - 1) + 1;
      const linePrefix = el.value.slice(lineStart, caret);
      if (/^\s*[-*]$/.test(linePrefix)) {
        e.preventDefault();
        el.setRangeText(BULLET_PREFIX, lineStart + linePrefix.length - 1, caret, 'end');
        setBullets(el.value);
        return;
      }
    }
    // Enter on a bullet line continues the list; Enter on an EMPTY
    // bullet ends it (clears the dangling marker). Shift+Enter is the
    // escape hatch for a plain newline inside a list.
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      const caret = el.selectionStart;
      const lineStart = el.value.lastIndexOf('\n', caret - 1) + 1;
      const line = el.value.slice(lineStart, caret);
      const bullet = /^(\s*)\u2022\s?(.*)$/.exec(line);
      if (bullet) {
        e.preventDefault();
        if ((bullet[2] ?? '').trim() === '') {
          el.setRangeText('', lineStart, caret, 'end');
        } else {
          el.setRangeText('\n' + (bullet[1] ?? '') + BULLET_PREFIX, caret, el.selectionEnd, 'end');
        }
        setBullets(el.value);
      }
    }
  }
  function steerKey(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault();
      void applySteer();
    }
  }

  const briefText =
    stripBulletPrefixes(bullets)
      .trim()
      .split('\n')
      .find((l) => l.trim() !== '') ?? (hasContext ? 'Untitled reply' : 'Untitled post');

  // ---- prop groups for the two states ----
  const reply: ReplyContextControls = {
    replyContext,
    captureModeIsReplyContext: captureMode === 'reply-context',
    onToggleReplyContextMode: () => void toggleReplyContextMode(),
    onClearReplyContext: () => void clearReplyContext(),
  };
  const brief: BriefControls = {
    bullets,
    // Paste-time safety net for typed markers; keystroke conversion
    // happens in genKey via setRangeText.
    setBullets: (v: string) => setBullets(normalizeTypedBullets(v)),
    charCap,
    setCharCap: handleCapToggle,
    softCapChars,
    onGenKey: genKey,
  };
  const draftView: DraftView = {
    kind: content?.kind ?? 'single',
    posts: (content?.posts ?? []).map((post) => {
      const count = weightedLength(post.text);
      return {
        text: post.text,
        residualViolations: post.residualViolations,
        copied: post.copied,
        count,
        over: charCap && count > X_HARD_LIMIT,
      };
    }),
    refined: lifecycle.refineSnapshot !== null,
    handEdited: content?.handEdited ?? false,
    committed: lifecycle.phase === 'committed',
    copied,
    canUndo: lifecycle.refineSnapshot !== null,
  };
  // Changing the ≈N target over an ACTIVE thread draft repacks it —
  // content is the fixed point, only the packaging changes (the refit
  // pattern: the value rides the request same-tick, before state
  // re-renders). Pre-draft, the stepper just seeds the next generate.
  function handleSetTarget(n: number): void {
    setThreadTarget(n);
    const lc = lifecycleRef.current;
    if (lc.phase !== 'active' || lc.content === null || lc.content.kind !== 'thread') return;
    if (lc.content.targetCount === n) return;
    onToast(`Repacking into \u2248${String(n)} posts \u2014 same content`);
    void runRefine({ type: 'repack', targetCount: n });
  }

  // Thread controls hide while a reply context exists — threads are
  // standalone posts in v1, so reply mode forces single composition.
  const threadControls: ThreadModeControls | null = hasContext
    ? null
    : {
        composeMode,
        onSetMode: setComposeMode,
        target: threadTarget,
        onSetTarget: handleSetTarget,
        busy,
      };
  // The picker drives the NEXT generation; the note in DraftState
  // describes the CURRENT draft's seed. A seed whose bundle was
  // deleted resolves to null — the note hides, matching the fact that
  // copying would no longer file anywhere.
  const bundlePicker: BundlePickerControls = {
    bundles: bundleOptions,
    selectedId: seedBundleId,
    onSelect: setSeedBundleId,
  };
  const seedBundleName =
    content?.seedBundleId != null
      ? (bundleOptions.find((b) => b.id === content.seedBundleId)?.name ?? null)
      : null;

  // A scope whose post disappeared (repack shrank the thread, mode
  // changed) silently un-aims — a pill pointing at nothing would lie.
  useEffect(() => {
    if (
      steerScope !== null &&
      (content?.kind !== 'thread' || steerScope >= (content?.posts.length ?? 0))
    ) {
      setSteerScope(null);
    }
  }, [steerScope, content]);

  const refineControls: RefineControls = {
    chips,
    chipCounts,
    flash,
    steerText,
    setSteerText,
    canApplySteer: !busy && steerText.trim() !== '',
    onSteerKey: steerKey,
    onApplyChip: (c) => void applyChip(c),
    onApplySteer: () => void applySteer(),
    scope: steerScope,
    onAimPost: (i) => setSteerScope((prev) => (prev === i ? null : i)),
    onClearScope: () => setSteerScope(null),
  };

  return (
    <div className="screen">
      {!hasDraft ? (
        <PreDraftState
          reply={reply}
          brief={brief}
          bundlePicker={bundlePicker}
          threadControls={threadControls}
          busy={busy}
          libraryCount={libraryCount}
          error={error}
          onGenerate={() => void generate({ isRegenerate: false })}
          onRetry={retry}
          onOpenOptions={onOpenOptions}
        />
      ) : (
        <DraftState
          reply={reply}
          brief={brief}
          draft={draftView}
          refine={refineControls}
          bundlePicker={bundlePicker}
          seedBundleName={seedBundleName}
          fileToBundle={fileToBundle}
          onToggleFileToBundle={() => setFileToBundle((v) => !v)}
          threadControls={threadControls}
          briefText={briefText}
          busy={busy}
          expanded={expanded}
          setExpanded={setExpanded}
          error={error}
          onEditPost={editPost}
          onRewritePost={(i) => void rewritePost(i)}
          shipToVoice={saveShippedDefault ? shipToVoice : null}
          onToggleShipToVoice={() => setShipToVoice((v) => !v)}
          onRegenerate={() => void generate({ isRegenerate: true })}
          onPolish={() => void applyPolish()}
          onUndo={undo}
          onCopy={() => void copyNext()}
          onCopyPost={(i) => void copyPost(i)}
          onDiscard={discard}
          onRetry={retry}
          onOpenOptions={onOpenOptions}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  countItems,
  getCaptureMode,
  getSettings,
  setCaptureMode,
  setReplyContextLock,
  subscribeCaptureMode,
  subscribeReplyContextLock,
  subscribeSettings,
} from '../storage';
import { sendToBackground, type BackgroundReply } from '../messaging';
import { weightedLength, X_HARD_LIMIT } from '../lib/counting';
import type {
  ChipPreset,
  GenerationRequest,
  GenerationResult,
  RefineRequest,
  ReplyContext,
  Settings,
} from '../types';
import type { Span } from '../lib/exclusion';
import type { ToastData } from './Toast';
import { PreDraftState } from './compose/PreDraftState';
import { DraftState, type DraftView, type RefineControls } from './compose/DraftState';
import type { ErrorKind } from './compose/ErrorCard';
import type { BriefControls, ReplyContextControls } from './compose/types';

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

  useEffect(() => {
    let cancelled = false;
    async function loadSettings(): Promise<void> {
      const s: Settings = await getSettings();
      if (cancelled) return;
      setChips(s.chips);
      setCharCap(s.charCapDefault);
      setSoftCapChars(s.softCapChars);
    }
    void loadSettings();
    const unsub = subscribeSettings((s) => {
      setChips(s.chips);
      setSoftCapChars(s.softCapChars);
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

  // ---- composition state ----
  const [bullets, setBullets] = useState<string>('');
  const [phase, setPhase] = useState<'idle' | 'drafting' | 'done'>('idle');
  const [draft, setDraft] = useState<string>('');
  const [residualViolations, setResidualViolations] = useState<Span[]>([]);
  const [wasRepaired, setWasRepaired] = useState<boolean>(false);
  const [prevDraft, setPrevDraft] = useState<string | null>(null);
  const [prevResidual, setPrevResidual] = useState<Span[]>([]);
  const [prevRepaired, setPrevRepaired] = useState<boolean>(false);
  const [refined, setRefined] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [moreText, setMoreText] = useState<string>('');
  const [lessText, setLessText] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [chipCounts, setChipCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<ErrorKind | null>(null);

  // Latest-call-wins coordination.
  const requestSeq = useRef<number>(0);

  const hasContext = replyContext !== null;
  const hasDraft = phase !== 'idle';
  const busy = phase === 'drafting';

  // ---- handlers ----
  async function toggleReplyContextMode(): Promise<void> {
    await setCaptureMode(captureMode === 'reply-context' ? 'none' : 'reply-context');
  }
  async function clearReplyContext(): Promise<void> {
    await setReplyContextLock(null);
  }

  async function generate(opts: { isRegenerate: boolean }): Promise<void> {
    if (!opts.isRegenerate && bullets.trim() === '') return;
    setPhase('drafting');
    setError(null);
    setRefined(false);
    setPrevDraft(null);
    setPrevResidual([]);
    setPrevRepaired(false);
    setExpanded(false);
    setChipCounts({});
    if (!opts.isRegenerate) {
      setMoreText('');
      setLessText('');
    }
    const myId = ++requestSeq.current;
    const request: GenerationRequest = {
      mode: hasContext ? 'reply' : 'post',
      bullets,
      charCap,
      replyContext: hasContext ? replyContext : null,
      isRegenerate: opts.isRegenerate,
    };
    try {
      const reply = await sendToBackground<
        Extract<BackgroundReply, { type: 'bg:generation-result' }>
      >({ type: 'panel:generate', request });
      if (myId !== requestSeq.current) return;
      applyResult(reply.result);
      void refreshLibraryCount();
    } catch (err) {
      if (myId !== requestSeq.current) return;
      setPhase('done');
      setError('other');
      onToast(err instanceof Error ? err.message : 'Generation failed.');
    }
  }

  function applyResult(result: GenerationResult): void {
    if (!result.ok) {
      setPhase('done');
      setError(result.kind);
      return;
    }
    setError(null);
    const text = result.draft.posts[0]?.text ?? '';
    setDraft(text);
    setResidualViolations(result.residualViolations);
    setWasRepaired(result.wasRepaired);
    setPhase('done');
  }

  async function applyChip(chip: ChipPreset): Promise<void> {
    if (busy || draft === '') return;
    setPrevDraft(draft);
    setPrevResidual(residualViolations);
    setPrevRepaired(wasRepaired);
    setRefined(true);
    setFlash(chip.id);
    const nextCount = (chipCounts[chip.id] ?? 0) + 1;
    setChipCounts((c) => ({ ...c, [chip.id]: nextCount }));
    window.setTimeout(() => setFlash(null), 550);
    // Pass the per-chip press count as `intensity` — background uses
    // it to escalate the chip's instruction wording so the AI takes
    // each subsequent press more seriously.
    await runRefine({ type: 'chip', chipId: chip.id, intensity: nextCount });
  }

  async function applySteer(): Promise<void> {
    if (busy || draft === '') return;
    if (moreText.trim() === '' && lessText.trim() === '') return;
    setPrevDraft(draft);
    setPrevResidual(residualViolations);
    setPrevRepaired(wasRepaired);
    setRefined(true);
    setChipCounts({});
    await runRefine({ type: 'moreless', more: moreText, less: lessText });
  }

  async function runRefine(kind: RefineRequest['kind']): Promise<void> {
    setPhase('drafting');
    const myId = ++requestSeq.current;
    const request: RefineRequest = {
      mode: hasContext ? 'reply' : 'post',
      previousDraftText: draft,
      charCap,
      kind,
    };
    try {
      const reply = await sendToBackground<
        Extract<BackgroundReply, { type: 'bg:generation-result' }>
      >({ type: 'panel:refine', request });
      if (myId !== requestSeq.current) return;
      applyResult(reply.result);
    } catch (err) {
      if (myId !== requestSeq.current) return;
      setPhase('done');
      setError('other');
      onToast(err instanceof Error ? err.message : 'Refine failed.');
    }
  }

  function undo(): void {
    if (prevDraft === null) return;
    setDraft(prevDraft);
    setResidualViolations(prevResidual);
    setWasRepaired(prevRepaired);
    setPrevDraft(null);
    setRefined(false);
    setChipCounts({});
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      onToast('Copied to clipboard');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      onToast('Could not copy.');
    }
  }

  function discard(): void {
    setPhase('idle');
    setDraft('');
    setBullets('');
    setPrevDraft(null);
    setMoreText('');
    setLessText('');
    setRefined(false);
    setExpanded(false);
    setChipCounts({});
    setError(null);
    onToast('Started over');
  }

  function retry(): void {
    setError(null);
    void generate({ isRegenerate: hasDraft });
  }

  function genKey(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!busy && bullets.trim() !== '') void generate({ isRegenerate: false });
    }
  }
  function steerKey(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void applySteer();
    }
  }

  const count = weightedLength(draft);
  const over = charCap && count > X_HARD_LIMIT;
  const briefText =
    bullets
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
    setBullets,
    charCap,
    setCharCap,
    softCapChars,
    onGenKey: genKey,
  };
  const draftView: DraftView = {
    text: draft,
    residualViolations,
    refined,
    count,
    over,
    copied,
    canUndo: prevDraft !== null,
  };
  const refineControls: RefineControls = {
    chips,
    chipCounts,
    flash,
    moreText,
    setMoreText,
    lessText,
    setLessText,
    canApplySteer: !busy && (moreText.trim() !== '' || lessText.trim() !== ''),
    onSteerKey: steerKey,
    onApplyChip: (c) => void applyChip(c),
    onApplySteer: () => void applySteer(),
  };

  return (
    <div className="screen">
      {!hasDraft ? (
        <PreDraftState
          reply={reply}
          brief={brief}
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
          briefText={briefText}
          busy={busy}
          expanded={expanded}
          setExpanded={setExpanded}
          error={error}
          onRegenerate={() => void generate({ isRegenerate: true })}
          onUndo={undo}
          onCopy={() => void copy()}
          onDiscard={discard}
          onRetry={retry}
          onOpenOptions={onOpenOptions}
        />
      )}
    </div>
  );
}

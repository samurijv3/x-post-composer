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
import {
  IcCheck,
  IcCopy,
  IcEdit,
  IcKey,
  IcLess,
  IcMore,
  IcRefresh,
  IcReply,
  IcSettings,
  IcSparkle,
  IcTrash,
  IcUndo,
  IcWarn,
  IcX,
} from './icons';
import { renderWithHighlights } from './highlights';
import { LastPromptInspector } from './LastPromptInspector';
import type { ToastData } from './Toast';
import { Avatar } from './Avatar';
import { formatRelativeTweetTime } from '../lib/format/relativeTime';

interface Props {
  onToast: (msg: string, action?: ToastData['action']) => void;
  onOpenOptions: () => void;
}

const MORELESS_MAX = 140;

type ErrorKind = 'auth' | 'rate-limit' | 'network' | 'server' | 'bad-request' | 'other';

interface ErrorDef {
  tone: 'danger' | 'warn';
  title: string;
  msg: string;
  action: 'settings' | 'retry';
}

const ERRORS: Record<ErrorKind, ErrorDef> = {
  auth: {
    tone: 'danger',
    title: 'Check your API key',
    msg: 'Anthropic rejected the saved key. Update it in settings, then try again.',
    action: 'settings',
  },
  'rate-limit': {
    tone: 'warn',
    title: 'Rate limited',
    msg: 'Too many requests in a row. Wait a moment, then retry.',
    action: 'retry',
  },
  network: {
    tone: 'warn',
    title: "Couldn't reach Anthropic",
    msg: 'A network error interrupted the request. Check your connection and retry.',
    action: 'retry',
  },
  server: {
    tone: 'warn',
    title: 'Anthropic is having trouble',
    msg: 'The service returned a server error. Wait a moment and retry.',
    action: 'retry',
  },
  'bad-request': {
    tone: 'danger',
    title: 'Anthropic rejected the request',
    msg: 'The prompt was malformed. Check the Prompts settings; try Reset to default if you edited a template.',
    action: 'settings',
  },
  other: {
    tone: 'warn',
    title: "Couldn't generate",
    msg: 'An unexpected error occurred. Retry, or check Inspect last prompt in settings.',
    action: 'retry',
  },
};

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
  const [captureMode, setCaptureModeState] =
    useState<'none' | 'library' | 'reply-context'>('none');
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
    bullets.trim().split('\n').find((l) => l.trim() !== '') ??
    (hasContext ? 'Untitled reply' : 'Untitled post');
  const canApplySteer = !busy && (moreText.trim() !== '' || lessText.trim() !== '');

  return (
    <div className="screen">
      {!hasDraft ? (
        <PreDraftState
          replyContext={replyContext}
          captureModeIsReplyContext={captureMode === 'reply-context'}
          onToggleReplyContextMode={() => void toggleReplyContextMode()}
          onClearReplyContext={() => void clearReplyContext()}
          bullets={bullets}
          setBullets={setBullets}
          charCap={charCap}
          setCharCap={setCharCap}
          softCapChars={softCapChars}
          busy={busy}
          libraryCount={libraryCount}
          error={error}
          onGenerate={() => void generate({ isRegenerate: false })}
          onGenKey={genKey}
          onRetry={retry}
          onOpenOptions={onOpenOptions}
        />
      ) : (
        <DraftState
          expanded={expanded}
          setExpanded={setExpanded}
          hasContext={hasContext}
          replyContext={replyContext}
          captureModeIsReplyContext={captureMode === 'reply-context'}
          onToggleReplyContextMode={() => void toggleReplyContextMode()}
          onClearReplyContext={() => void clearReplyContext()}
          bullets={bullets}
          setBullets={setBullets}
          charCap={charCap}
          setCharCap={setCharCap}
          softCapChars={softCapChars}
          busy={busy}
          draft={draft}
          residualViolations={residualViolations}
          wasRepaired={wasRepaired}
          refined={refined}
          count={count}
          over={over}
          copied={copied}
          briefText={briefText}
          chips={chips}
          chipCounts={chipCounts}
          flash={flash}
          moreText={moreText}
          setMoreText={setMoreText}
          lessText={lessText}
          setLessText={setLessText}
          canApplySteer={canApplySteer}
          prevDraft={prevDraft}
          error={error}
          onGenKey={genKey}
          onSteerKey={steerKey}
          onRegenerate={() => void generate({ isRegenerate: true })}
          onApplyChip={(c) => void applyChip(c)}
          onApplySteer={() => void applySteer()}
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

// ---------------------------------------------------------------------
// Pre-draft (no draft yet) — full input
// ---------------------------------------------------------------------

interface PreDraftProps {
  replyContext: ReplyContext | null;
  captureModeIsReplyContext: boolean;
  onToggleReplyContextMode: () => void;
  onClearReplyContext: () => void;
  bullets: string;
  setBullets: (v: string) => void;
  charCap: boolean;
  setCharCap: (v: boolean) => void;
  softCapChars: number;
  busy: boolean;
  libraryCount: number;
  error: ErrorKind | null;
  onGenerate: () => void;
  onGenKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onRetry: () => void;
  onOpenOptions: () => void;
}

function PreDraftState(props: PreDraftProps) {
  const {
    replyContext,
    captureModeIsReplyContext,
    onToggleReplyContextMode,
    onClearReplyContext,
    bullets,
    setBullets,
    charCap,
    setCharCap,
    softCapChars,
    busy,
    libraryCount,
    error,
    onGenerate,
    onGenKey,
    onRetry,
    onOpenOptions,
  } = props;
  const hasContext = replyContext !== null;
  const canGenerate = bullets.trim() !== '' && !busy;
  return (
    <>
      {hasContext ? (
        <ReplyContextCard context={replyContext} onClear={onClearReplyContext} />
      ) : (
        <ReplyContextBanner
          on={captureModeIsReplyContext}
          onToggle={onToggleReplyContextMode}
        />
      )}

      <label className="fld compose-input">
        <span className="fld-label">{hasContext ? 'Your angle' : 'What do you want to say?'}</span>
        <textarea
          rows={4}
          value={bullets}
          onKeyDown={onGenKey}
          onChange={(e) => setBullets(e.target.value)}
          placeholder={
            hasContext
              ? 'the point you want to make\nany detail to include'
              : 'the topic\nyour angle\nany detail to include'
          }
        />
      </label>

      <div className="compose-tools">
        <CapToggle charCap={charCap} setCharCap={setCharCap} />
        {!charCap && <span className="help">soft cap {softCapChars}</span>}
      </div>

      <button
        type="button"
        className="btn primary lg block"
        disabled={!canGenerate}
        onClick={onGenerate}
        title="⌘↵ to generate"
      >
        {busy ? (
          'Drafting…'
        ) : (
          <>
            <IcSparkle /> {hasContext ? 'Generate reply' : 'Generate post'}
            <span className="kbd kbd-on">⌘↵</span>
          </>
        )}
      </button>

      {error ? (
        <ErrorCard kind={error} onRetry={onRetry} onSettings={onOpenOptions} />
      ) : libraryCount === 0 ? (
        <p className="help" style={{ textAlign: 'center', margin: '2px 0' }}>
          No examples yet — add a few in <em>Voice</em> so drafts sound like you.
        </p>
      ) : (
        <p className="help" style={{ textAlign: 'center', margin: '2px 0' }}>
          Drawing on <em>{libraryCount} saved {libraryCount === 1 ? 'example' : 'examples'}</em> of
          your writing. More in Voice means a closer match.
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Draft state — input collapses to a brief, draft is the focal point
// ---------------------------------------------------------------------

interface DraftStateProps {
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  hasContext: boolean;
  replyContext: ReplyContext | null;
  captureModeIsReplyContext: boolean;
  onToggleReplyContextMode: () => void;
  onClearReplyContext: () => void;
  bullets: string;
  setBullets: (v: string) => void;
  charCap: boolean;
  setCharCap: (v: boolean) => void;
  softCapChars: number;
  busy: boolean;
  draft: string;
  residualViolations: Span[];
  wasRepaired: boolean;
  refined: boolean;
  count: number;
  over: boolean;
  copied: boolean;
  briefText: string;
  chips: ChipPreset[];
  chipCounts: Record<string, number>;
  flash: string | null;
  moreText: string;
  setMoreText: (v: string) => void;
  lessText: string;
  setLessText: (v: string) => void;
  canApplySteer: boolean;
  prevDraft: string | null;
  error: ErrorKind | null;
  onGenKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSteerKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onRegenerate: () => void;
  onApplyChip: (c: ChipPreset) => void;
  onApplySteer: () => void;
  onUndo: () => void;
  onCopy: () => void;
  onDiscard: () => void;
  onRetry: () => void;
  onOpenOptions: () => void;
}

function DraftState(props: DraftStateProps) {
  const mode: 'post' | 'reply' = props.hasContext ? 'reply' : 'post';
  return (
    <>
      {!props.expanded ? (
        <div className="brief">
          <span className={`badge ${mode}`}>{mode}</span>
          <button
            type="button"
            className="brief-main"
            onClick={() => props.setExpanded(true)}
            title="Edit your brief"
          >
            <span className="brief-text">
              {mode === 'reply' && props.replyContext?.targetAuthorHandle
                ? `to @${props.replyContext.targetAuthorHandle} · ${props.briefText}`
                : props.briefText}
            </span>
            <IcEdit className="brief-edit" />
          </button>
          <button
            type="button"
            className="icon-btn brief-discard"
            title="Discard and start over"
            aria-label="Discard and start over"
            onClick={props.onDiscard}
          >
            <IcTrash />
          </button>
        </div>
      ) : (
        <div className="card inset" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {props.hasContext && props.replyContext ? (
            <div className="brief-ctx">
              <IcReply />
              Replying to @{props.replyContext.targetAuthorHandle ?? '—'}
              <span className="head-spacer" />
              <button
                type="button"
                className="icon-btn"
                style={{ width: 26, height: 26 }}
                title="Remove reply context"
                aria-label="Remove reply context"
                onClick={props.onClearReplyContext}
              >
                <IcX />
              </button>
            </div>
          ) : (
            <ReplyContextBanner
              compact
              on={props.captureModeIsReplyContext}
              onToggle={props.onToggleReplyContextMode}
            />
          )}
          <label className="fld">
            <span className="fld-label">
              {props.hasContext ? 'Your angle' : 'What do you want to say?'}
            </span>
            <textarea
              rows={3}
              value={props.bullets}
              onKeyDown={props.onGenKey}
              onChange={(e) => props.setBullets(e.target.value)}
            />
          </label>
          <CapToggle charCap={props.charCap} setCharCap={props.setCharCap} />
          <div className="pillrow">
            <button type="button" className="btn primary" onClick={props.onRegenerate}>
              <IcRefresh /> Regenerate
            </button>
            <button type="button" className="btn ghost" onClick={() => props.setExpanded(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {props.error && <ErrorCard kind={props.error} onRetry={props.onRetry} onSettings={props.onOpenOptions} />}

      {/* DRAFT CARD — focal point */}
      <div className="draft">
        <div className="draft-head">
          <span className="eyebrow">Your draft</span>
          {props.refined && !props.busy && <span className="badge reply">refined</span>}
          <span className="head-spacer" />
          <button
            type="button"
            className={`minitoggle ${props.charCap ? 'on' : 'off'}`}
            title={
              props.charCap
                ? '≤280 cap is ON — click to switch to uncapped'
                : 'Uncapped — click to enforce ≤280'
            }
            onClick={() => props.setCharCap(!props.charCap)}
          >
            ≤280
          </button>
          {props.busy && props.draft !== '' ? (
            <span className="upd">
              <span className="upd-dot" />
              updating…
            </span>
          ) : (
            <span
              className={`count ${props.over ? 'over' : ''}`}
              title="X-weighted count — URLs always count as 23, some characters as 2"
            >
              {props.count}
              {props.charCap ? ` / ${X_HARD_LIMIT}` : ' chars'}
            </span>
          )}
        </div>
        {props.busy && props.draft === '' ? (
          <div className="drafting">
            <div className="shim" style={{ width: '92%' }} />
            <div className="shim" style={{ width: '100%' }} />
            <div className="shim" style={{ width: '64%' }} />
          </div>
        ) : (
          <>
            <div className="draft-body">
              <p className="draft-text" key={props.draft}>
                {renderWithHighlights(props.draft, props.residualViolations)}
              </p>
            </div>
            {props.over && (
              <div className="draft-warn">
                <div className="callout warn">
                  <IcWarn />
                  <span>
                    Over by {props.count - X_HARD_LIMIT}. A tighten pass already ran — trim by
                    hand or regenerate.
                  </span>
                </div>
              </div>
            )}
            <div className="draft-actions">
              <button
                type="button"
                className="btn primary lg"
                onClick={props.onCopy}
                disabled={props.busy}
              >
                {props.copied ? (
                  <>
                    <IcCheck /> Copied
                  </>
                ) : (
                  <>
                    <IcCopy /> Copy to X
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn lg"
                title="Regenerate — same brief, fresh take"
                aria-label="Regenerate"
                onClick={props.onRegenerate}
                disabled={props.busy}
              >
                <IcRefresh />
              </button>
              <button
                type="button"
                className="btn lg"
                title="Undo last change"
                aria-label="Undo"
                disabled={props.prevDraft === null || props.busy}
                onClick={props.onUndo}
              >
                <IcUndo />
              </button>
            </div>
          </>
        )}
      </div>

      {/* REFINE — chips + steer */}
      <div
        className={`refine ${props.busy ? 'is-busy' : ''}`}
        aria-disabled={props.busy}
      >
        {props.chips.length > 0 && (
          <div className="refine-block">
            <span className="eyebrow">Quick refine</span>
            <div className="pillrow">
              {props.chips.map((c) => {
                const n = props.chipCounts[c.id] ?? 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`chip ${props.flash === c.id ? 'flash' : ''}`}
                    title={c.instruction}
                    disabled={props.busy}
                    onClick={() => props.onApplyChip(c)}
                  >
                    {c.label}
                    {n >= 2 && <span className="chip-x">×{n}</span>}
                  </button>
                );
              })}
            </div>
            <p className="help">Tap to apply. Tap again to push the same direction further.</p>
          </div>
        )}
        <div className="refine-block">
          <span className="eyebrow">Steer it</span>
          <div className="moreless-grid">
            <div className="ml-cell">
              <span className="ml-label">
                <IcMore /> More of
              </span>
              <textarea
                rows={2}
                maxLength={MORELESS_MAX}
                value={props.moreText}
                disabled={props.busy}
                onKeyDown={props.onSteerKey}
                onChange={(e) => props.setMoreText(e.target.value)}
                placeholder="the dry humor, concrete detail…"
              />
            </div>
            <div className="ml-cell">
              <span className="ml-label">
                <IcLess /> Less of
              </span>
              <textarea
                rows={2}
                maxLength={MORELESS_MAX}
                value={props.lessText}
                disabled={props.busy}
                onKeyDown={props.onSteerKey}
                onChange={(e) => props.setLessText(e.target.value)}
                placeholder="hedging, jargon, hype…"
              />
            </div>
          </div>
          <div className="steer-apply">
            <span className="help">Describe a tweak, then apply.</span>
            <button
              type="button"
              className="btn primary sm"
              disabled={!props.canApplySteer}
              onClick={props.onApplySteer}
            >
              Apply <span className="kbd kbd-on">⌘↵</span>
            </button>
          </div>
        </div>
      </div>

      <LastPromptInspector />
    </>
  );
}

// ---------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------

function CapToggle({ charCap, setCharCap }: { charCap: boolean; setCharCap: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={charCap}
        onChange={(e) => setCharCap(e.target.checked)}
      />
      <span className="track" />
      <span>Keep under 280</span>
    </label>
  );
}

interface ReplyContextBannerProps {
  on: boolean;
  /** Slimmer layout for the in-draft brief card. Drops the help paragraph. */
  compact?: boolean;
  onToggle: () => void;
}

/**
 * Reply-context-mode banner. Mirrors the save-to-voice `CaptureBanner`
 * in VoiceScreen so the two "mode is ON" indicators read as siblings —
 * same green tint, same pulsing dot, same switch — only the wording
 * differs. Replaces the older single-button affordance.
 */
function ReplyContextBanner({ on, compact = false, onToggle }: ReplyContextBannerProps) {
  return (
    <div className={`capture-banner ${on ? 'on' : ''} ${compact ? 'compact' : ''}`}>
      <div className="cb-top">
        <span className="cb-dot" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {on ? 'Reply-context mode: ON' : 'Reply to a tweet'}
          </div>
          {!compact && (
            <p className="help" style={{ marginTop: 1 }}>
              {on
                ? 'Pick the tweet you want to reply to on x.com.'
                : 'Pull in the post you’re replying to.'}
            </p>
          )}
        </div>
        <label className="switch" title={on ? 'Turn off reply-context mode' : 'Turn on reply-context mode'}>
          <input type="checkbox" checked={on} onChange={onToggle} />
          <span className="track track-ok" />
        </label>
      </div>
    </div>
  );
}

interface ReplyContextCardProps {
  context: ReplyContext;
  onClear: () => void;
}

function ReplyContextCard({ context, onClear }: ReplyContextCardProps) {
  const relTime = formatRelativeTweetTime(context.targetTimestamp);
  return (
    <div className="context-card">
      <div className="ctx-top">
        <IcReply style={{ width: 15, height: 15, color: 'var(--accent)' }} />
        <span className="eyebrow" style={{ color: 'var(--accent)' }}>
          Replying to
        </span>
        <span className="head-spacer" />
        <button
          type="button"
          className="icon-btn"
          style={{ width: 26, height: 26 }}
          title="Clear"
          aria-label="Clear reply context"
          onClick={onClear}
        >
          <IcX />
        </button>
      </div>
      {context.grandparentText && (
        <div className="ctx-grand">
          <div className="ctx-thread-label">Earlier in thread</div>
          <p className="ctx-thread-text">{context.grandparentText}</p>
        </div>
      )}
      <div className="tweet-native">
        <Avatar
          src={context.targetAuthorAvatarUrl}
          name={context.targetAuthorDisplayName ?? context.targetAuthorHandle}
        />
        <div className="tweet-native-body">
          <div className="tweet-native-head">
            {context.targetAuthorDisplayName && (
              <span className="tn-name">{context.targetAuthorDisplayName}</span>
            )}
            {context.targetAuthorHandle && (
              <span className="tn-handle">@{context.targetAuthorHandle}</span>
            )}
            {relTime && (
              <>
                <span className="tn-dot">·</span>
                <span className="tn-time">{relTime}</span>
              </>
            )}
          </div>
          <p className="tn-text">{context.targetText}</p>
          {context.hadUnreadableMedia && (
            <p className="help" style={{ marginTop: 6 }}>
              Media (images / quoted posts) were present but not read — v1 captures text only.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface ErrorCardProps {
  kind: ErrorKind;
  onRetry: () => void;
  onSettings: () => void;
}

function ErrorCard({ kind, onRetry, onSettings }: ErrorCardProps) {
  const e = ERRORS[kind];
  return (
    <div className={`error-card ${e.tone}`}>
      {e.tone === 'danger' ? <IcKey className="ec-ic" /> : <IcWarn className="ec-ic" />}
      <div style={{ flex: 1 }}>
        <div className="ec-title">{e.title}</div>
        <div className="ec-msg">{e.msg}</div>
        <div className="ec-actions">
          {e.action === 'settings' ? (
            <button type="button" className="btn sm" onClick={onSettings}>
              <IcSettings /> Open settings
            </button>
          ) : (
            <button type="button" className="btn sm" onClick={onRetry}>
              <IcRefresh /> Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

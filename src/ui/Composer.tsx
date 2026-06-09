import { useCallback, useEffect, useRef, useState } from 'react';
import { isMessageOfType, onNotice, sendToBackground, type BackgroundReply } from '../messaging';
import { countItems, getAllItems, getSettings, subscribeSettings } from '../storage';
import type {
  ChipPreset,
  GenerationResult,
  RefineRequest,
  ReplyContext,
  Settings,
} from '../types';
import { ReplyContextDisplay } from './ReplyContextDisplay';
import { DraftDisplay } from './DraftDisplay';

type Mode = 'post' | 'reply';

const MORELESS_MAX = 140;
const REFINE_DEBOUNCE_MS = 1000;

/**
 * Top-of-panel composer. Generates a draft and then offers four ways
 * to reshape it:
 *
 *   - Chips (one click, applies the chip's stored instruction)
 *   - more / less debounced auto-refine (no button)
 *   - Regenerate (fresh samples + bumped temperature; clears more/less)
 *   - Undo (one level — reverts the most recent refine)
 *
 * Only Regenerate touches the example pool. Chips and more/less only
 * reshape whatever draft is on screen.
 */
export function Composer() {
  // Composition inputs
  const [mode, setMode] = useState<Mode>('post');
  const [bullets, setBullets] = useState<string>('');
  const [charCap, setCharCap] = useState<boolean>(true);
  const [softCapChars, setSoftCapChars] = useState<number>(1000);
  const [replyContext, setReplyContext] = useState<ReplyContext | null>(null);

  // Refine inputs (persist across chip clicks; cleared only by user or Regenerate)
  const [moreText, setMoreText] = useState<string>('');
  const [lessText, setLessText] = useState<string>('');

  // Chips come from Settings
  const [chips, setChips] = useState<ChipPreset[]>([]);

  // Status
  const [capturing, setCapturing] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [refining, setRefining] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [previousResult, setPreviousResult] = useState<GenerationResult | null>(null);
  const [libraryCount, setLibraryCount] = useState<number>(0);
  const [postCount, setPostCount] = useState<number>(0);
  const [replyCount, setReplyCount] = useState<number>(0);

  // Latest-call-wins coordination. Any new send increments; responses
  // whose id no longer matches are discarded ("abandon in-flight").
  const requestSeq = useRef<number>(0);

  // The debounced more/less timer. Cleared on every keystroke + on
  // Regenerate / chip click / unmount so only the latest settled pause
  // actually fires.
  const refineTimer = useRef<number | null>(null);

  const refreshLibrary = useCallback(async () => {
    try {
      const [total, items] = await Promise.all([countItems(), getAllItems()]);
      setLibraryCount(total);
      let posts = 0;
      let replies = 0;
      for (const item of items) {
        if (item.type === 'post') posts++;
        else if (item.type === 'reply') replies++;
      }
      setPostCount(posts);
      setReplyCount(replies);
    } catch {
      setLibraryCount(0);
      setPostCount(0);
      setReplyCount(0);
    }
  }, []);

  // Settings load + live subscription so chip edits land immediately.
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const s: Settings = await getSettings();
      if (cancelled) return;
      setCharCap(s.charCapDefault);
      setSoftCapChars(s.softCapChars);
      setChips(s.chips);
    }
    void load();
    void refreshLibrary();
    const unsub = subscribeSettings((s) => {
      setChips(s.chips);
      setSoftCapChars(s.softCapChars);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [refreshLibrary]);

  // Keyboard-shortcut auto-capture. Two paths converge here:
  //   1. Panel was just opened by the shortcut → storage flag is set.
  //   2. Panel was already open → bg:auto-reply-capture notice fires.
  // Either way, switch to reply mode and trigger capture once.
  useEffect(() => {
    let cancelled = false;
    let alreadyTriggered = false;

    async function maybeTriggerFromFlag(): Promise<void> {
      const stored = await chrome.storage.session.get('autoReplyCapture:v1');
      const at = stored['autoReplyCapture:v1'];
      if (typeof at !== 'number') return;
      const age = Date.now() - at;
      // Drop the flag so subsequent panel opens don't re-fire.
      await chrome.storage.session.remove('autoReplyCapture:v1');
      if (age > 5000 || cancelled || alreadyTriggered) return;
      alreadyTriggered = true;
      setMode('reply');
      void captureContext();
    }
    void maybeTriggerFromFlag();

    const unsub = onNotice((notice) => {
      if (!isMessageOfType(notice, 'bg:auto-reply-capture')) return;
      if (alreadyTriggered || cancelled) return;
      const age = Date.now() - notice.at;
      if (age > 5000) return;
      alreadyTriggered = true;
      setMode('reply');
      void captureContext();
    });

    return () => {
      cancelled = true;
      unsub();
    };
    // captureContext is stable enough; binding it would re-run on every
    // generation. Intentionally not in deps.
  }, []);

  // Live snapshot of state the debounced fire needs to read at trigger
  // time. We keep it in a ref so neither `result` updating after a
  // refine nor a mode/charCap toggle re-runs the debounce effect — only
  // typing in more/less should reset the timer.
  const latestRef = useRef<{
    result: GenerationResult | null;
    mode: Mode;
    charCap: boolean;
    moreText: string;
    lessText: string;
  }>({ result: null, mode: 'post', charCap: true, moreText: '', lessText: '' });
  latestRef.current = { result, mode, charCap, moreText, lessText };

  // Reset the timer on every more/less keystroke. Only fire when there's
  // actually a draft to refine and at least one input has content. The
  // earlier version of this effect listed `result` in its deps and
  // looped forever (each refine updated result → re-fired the effect →
  // scheduled another refine).
  useEffect(() => {
    if (refineTimer.current !== null) {
      window.clearTimeout(refineTimer.current);
      refineTimer.current = null;
    }
    if (moreText.trim() === '' && lessText.trim() === '') return;
    refineTimer.current = window.setTimeout(() => {
      refineTimer.current = null;
      const s = latestRef.current;
      if (!s.result?.ok) return;
      const draftText = s.result.draft.posts[0]?.text ?? '';
      if (draftText === '') return;
      void fireRefine({
        mode: s.mode,
        previousDraftText: draftText,
        charCap: s.charCap,
        kind: { type: 'moreless', more: s.moreText, less: s.lessText },
      });
    }, REFINE_DEBOUNCE_MS);
    return () => {
      if (refineTimer.current !== null) {
        window.clearTimeout(refineTimer.current);
        refineTimer.current = null;
      }
    };
    // Intentionally narrow deps: ONLY typing should reset the debounce.
    // `result`/`mode`/`charCap` are read live via latestRef at fire time.
  }, [moreText, lessText]);

  async function captureContext(): Promise<void> {
    setCapturing(true);
    setError(null);
    try {
      const reply = await sendToBackground<
        Extract<BackgroundReply, { type: 'bg:reply-context-result' }>
      >({ type: 'panel:capture-reply-context' });
      if (reply.ok && reply.context) {
        setReplyContext(reply.context);
      } else {
        setError(reply.message ?? 'Could not capture reply context.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture failed.');
    } finally {
      setCapturing(false);
    }
  }

  async function generate(isRegenerate: boolean): Promise<void> {
    if (mode === 'reply' && !replyContext) {
      setError('Capture the reply context first.');
      return;
    }
    cancelPendingRefine();
    if (isRegenerate) {
      // Regenerate clears more/less per spec.
      setMoreText('');
      setLessText('');
    }
    const myId = ++requestSeq.current;
    setGenerating(true);
    setError(null);
    if (!isRegenerate) {
      setResult(null);
      setPreviousResult(null);
    }
    try {
      const reply = await sendToBackground<
        Extract<BackgroundReply, { type: 'bg:generation-result' }>
      >({
        type: 'panel:generate',
        request: {
          mode,
          bullets,
          charCap,
          replyContext: mode === 'reply' ? replyContext : null,
          isRegenerate,
        },
      });
      if (myId !== requestSeq.current) return; // superseded
      setPreviousResult(null); // Regenerate clears undo history
      setResult(reply.result);
      void refreshLibrary();
    } catch (err) {
      if (myId !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      if (myId === requestSeq.current) setGenerating(false);
    }
  }

  async function fireRefine(request: RefineRequest): Promise<void> {
    if (!result?.ok) return;
    const myId = ++requestSeq.current;
    const snapshot = result; // remember for undo before the call lands
    setRefining(true);
    setError(null);
    try {
      const reply = await sendToBackground<
        Extract<BackgroundReply, { type: 'bg:generation-result' }>
      >({ type: 'panel:refine', request });
      if (myId !== requestSeq.current) return; // discarded
      if (reply.result.ok) {
        setPreviousResult(snapshot);
        setResult(reply.result);
      } else {
        setError(reply.result.message);
      }
    } catch (err) {
      if (myId !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : 'Refine failed.');
    } finally {
      if (myId === requestSeq.current) setRefining(false);
    }
  }

  function chipClick(chip: ChipPreset): void {
    if (!result?.ok) return;
    cancelPendingRefine();
    const draftText = result.draft.posts[0]?.text ?? '';
    void fireRefine({
      mode,
      previousDraftText: draftText,
      charCap,
      kind: { type: 'chip', chipId: chip.id },
    });
  }

  function undo(): void {
    if (!previousResult) return;
    cancelPendingRefine();
    setResult(previousResult);
    setPreviousResult(null); // one level only
  }

  function cancelPendingRefine(): void {
    if (refineTimer.current !== null) {
      window.clearTimeout(refineTimer.current);
      refineTimer.current = null;
    }
  }

  const inFlight = generating || refining;
  const haveDraft = result?.ok === true;
  const readyToGenerate =
    !inFlight && bullets.trim() !== '' && (mode === 'post' || replyContext !== null);

  return (
    <section className="composer">
      <div className="row composer-mode">
        <ModeButton current={mode} value="post" setMode={setMode}>
          Post
        </ModeButton>
        <ModeButton current={mode} value="reply" setMode={setMode}>
          Reply
        </ModeButton>
      </div>

      {mode === 'reply' && (
        <div className="composer-reply-section">
          {replyContext ? (
            <ReplyContextDisplay
              context={replyContext}
              onClear={() => setReplyContext(null)}
            />
          ) : (
            <div className="capture-hint">
              <p className="help">
                Click X&apos;s native <strong>Reply</strong> button on the tweet, then capture the
                context here. We read text only — media isn&apos;t read in v1.
              </p>
              <button
                type="button"
                className="primary"
                onClick={() => void captureContext()}
                disabled={capturing}
              >
                {capturing ? 'Capturing…' : 'Capture reply context'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="bullets">What do you want to say?</label>
        <textarea
          id="bullets"
          rows={4}
          value={bullets}
          onChange={(e) => setBullets(e.target.value)}
          placeholder={
            mode === 'reply'
              ? '- the angle you want to take\n- any specific point or detail'
              : '- the topic\n- the angle\n- any specific point or detail'
          }
          spellCheck={true}
        />
      </div>

      <div className="row">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={charCap}
            onChange={(e) => setCharCap(e.target.checked)}
          />
          <span>Keep under 280 chars</span>
        </label>
        {!charCap && <span className="help">soft cap: {softCapChars} chars</span>}
      </div>

      {libraryCount === 0 && (
        <div className="help">
          Your library is empty — drafts will lean entirely on the style guide. Capture or paste
          examples in the <em>Voice</em> tab for stronger voice matching.
        </div>
      )}
      {libraryCount > 0 && mode === 'reply' && replyCount === 0 && (
        <div className="help">
          You have {postCount} {postCount === 1 ? 'post' : 'posts'} in your library but no
          replies. This reply will lean on your style guide alone. Capture some of your replies
          in the <em>Voice</em> tab for stronger voice matching.
        </div>
      )}
      {libraryCount > 0 && mode === 'post' && postCount === 0 && (
        <div className="help">
          You have {replyCount} {replyCount === 1 ? 'reply' : 'replies'} in your library but no
          standalone posts. This post will lean on your style guide alone. Capture some of your
          posts in the <em>Voice</em> tab for stronger voice matching.
        </div>
      )}

      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={() => void generate(false)}
          disabled={!readyToGenerate}
        >
          {generating && !haveDraft ? 'Generating…' : 'Generate'}
        </button>
        {haveDraft && (
          <button
            type="button"
            onClick={() => void generate(true)}
            disabled={inFlight}
            title="Fresh samples + higher temperature. Clears more/less."
          >
            {generating ? 'Regenerating…' : 'Regenerate'}
          </button>
        )}
        {previousResult && (
          <button type="button" onClick={undo} disabled={inFlight}>
            Undo
          </button>
        )}
        {refining && <span className="status">updating…</span>}
      </div>

      {error && <div className="status err">{error}</div>}

      {result && !result.ok && (
        <div className="status err">
          <strong>{labelForErrorKind(result.kind)}:</strong> {result.message}
        </div>
      )}

      {result && result.ok && (
        <>
          <DraftDisplay
            draft={result.draft}
            residualViolations={result.residualViolations}
            wasRepaired={result.wasRepaired}
            charCap={charCap}
          />

          {chips.length > 0 && (
            <div className="chips">
              <div className="ctx-label">Refine with a chip</div>
              <div className="row">
                {chips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => chipClick(chip)}
                    disabled={inFlight}
                    title={chip.instruction}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="moreless">
            <div className="ctx-label">Or steer with more / less (auto-refines after ~1s pause)</div>
            <MoreLessInput
              label="More of"
              value={moreText}
              onChange={setMoreText}
              placeholder="add more X to the draft"
            />
            <MoreLessInput
              label="Less of"
              value={lessText}
              onChange={setLessText}
              placeholder="trim back the Y"
            />
          </div>
        </>
      )}
    </section>
  );
}

interface ModeButtonProps {
  current: Mode;
  value: Mode;
  setMode: (m: Mode) => void;
  children: React.ReactNode;
}

function ModeButton({ current, value, setMode, children }: ModeButtonProps) {
  return (
    <button
      type="button"
      className={`mode-btn ${current === value ? 'active' : ''}`}
      onClick={() => setMode(value)}
      aria-pressed={current === value}
    >
      {children}
    </button>
  );
}

interface MoreLessInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}

function MoreLessInput({ label, value, onChange, placeholder }: MoreLessInputProps) {
  const remaining = MORELESS_MAX - value.length;
  return (
    <div className="moreless-row">
      <label className="moreless-label">{label}</label>
      <input
        type="text"
        value={value}
        maxLength={MORELESS_MAX}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={true}
      />
      <span className={`moreless-count ${remaining < 20 ? 'low' : ''}`}>{remaining}</span>
    </div>
  );
}

function labelForErrorKind(
  kind: GenerationResult extends infer R
    ? R extends { ok: false; kind: infer K }
      ? K
      : never
    : never,
): string {
  switch (kind) {
    case 'auth':
      return 'Auth error';
    case 'rate-limit':
      return 'Rate limit';
    case 'network':
      return 'Network';
    case 'server':
      return 'Anthropic server';
    case 'bad-request':
      return 'Bad request';
    default:
      return 'Error';
  }
}

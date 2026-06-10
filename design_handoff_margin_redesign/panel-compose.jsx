// panel-compose.jsx — core loop. Pre-draft input collapses once a draft exists,
// so the draft itself becomes the focal point.
const { useState, useRef, useEffect } = React;

// One concept: "Generate". Errors are surfaced as calm, actionable cards.
const ERRORS = {
  auth:         { tone: 'danger', icon: 'IcKey',  title: 'Check your API key', msg: 'Anthropic rejected the saved key. Update it in settings, then try again.', action: 'settings' },
  'rate-limit': { tone: 'warn',   icon: 'IcWarn', title: 'Rate limited',        msg: 'Too many requests in a row. Wait a moment, then retry.', action: 'retry' },
  network:      { tone: 'warn',   icon: 'IcWarn', title: "Couldn't reach Anthropic", msg: 'A network error interrupted the request. Check your connection and retry.', action: 'retry' },
};

function ComposeScreen({ onToast, onOpenOptions, demoError, libraryCount }) {
  const [bullets, setBullets] = useState('');
  const [capped, setCapped] = useState(true);
  const [hasContext, setHasContext] = useState(false);

  const [phase, setPhase] = useState('idle'); // idle | drafting | done
  const [draft, setDraft] = useState('');
  const [prevDraft, setPrevDraft] = useState(null);
  const [variantIdx, setVariantIdx] = useState(0);
  const [refined, setRefined] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [more, setMore] = useState('');
  const [less, setLess] = useState('');
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState(null);
  const [chipCounts, setChipCounts] = useState({});
  const [error, setError] = useState(null); // error kind string
  const flashTimer = useRef(null);

  const mode = hasContext ? 'reply' : 'post';
  const hasDraft = phase !== 'idle';
  const busy = phase === 'drafting';
  const canGenerate = bullets.trim() !== '' && !busy;
  const demo = demoError && demoError !== 'off' ? demoError : null;

  function finishOrError(regen, idx) {
    if (demo) { setError(demo); setPhase(regen ? 'done' : 'idle'); return; }
    setError(null); setDraft(window.DRAFTS[mode][idx]); setPhase('done');
  }

  function runGenerate(regen) {
    if (!canGenerate && !regen) return;
    setPhase('drafting'); setError(null); setRefined(false); setPrevDraft(null);
    setExpanded(false); setChipCounts({});
    if (!regen) { setMore(''); setLess(''); }
    const idx = regen ? (variantIdx + 1) % window.DRAFTS[mode].length : 0;
    setVariantIdx(idx);
    window.setTimeout(() => finishOrError(regen, idx), 850);
  }

  function applyChip(chip) {
    if (busy) return;
    setPrevDraft(draft); setRefined(true); setPhase('drafting');
    setFlash(chip.id);
    setChipCounts((c) => ({ ...c, [chip.id]: (c[chip.id] || 0) + 1 }));
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 550);
    const variant = window.REFINE_VARIANTS[chip.label];
    window.setTimeout(() => { if (variant) setDraft(variant); setPhase('done'); }, 600);
  }

  const canApplySteer = !busy && (more.trim() !== '' || less.trim() !== '');
  function applySteer() {
    if (!canApplySteer) return;
    setPrevDraft(draft); setRefined(true); setChipCounts({}); setPhase('drafting');
    window.setTimeout(() => {
      setDraft(window.REFINE_VARIANTS[more.trim() ? 'Warmer' : 'Shorter'] || draft);
      setPhase('done');
    }, 600);
  }
  function steerKey(e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); applySteer(); } }
  function genKey(e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (canGenerate) runGenerate(false); } }

  function undo() { if (prevDraft == null) return; setDraft(prevDraft); setPrevDraft(null); setRefined(false); setChipCounts({}); }
  function copy() { setCopied(true); onToast && onToast('Copied to clipboard'); window.setTimeout(() => setCopied(false), 1500); }
  function discard() {
    setPhase('idle'); setDraft(''); setBullets(''); setPrevDraft(null);
    setMore(''); setLess(''); setRefined(false); setExpanded(false); setChipCounts({}); setError(null);
    onToast && onToast('Started over');
  }
  function retry() { setError(null); runGenerate(phase === 'done'); }

  const count = window.weighted(draft);
  const over = capped && count > 280;
  const briefText = bullets.trim().split('\n').filter(Boolean)[0] || (mode === 'reply' ? 'Untitled reply' : 'Untitled post');

  const CapSwitch = (
    <label className="switch">
      <input type="checkbox" checked={capped} onChange={(e) => setCapped(e.target.checked)} />
      <span className="track" /><span>Keep under 280</span>
    </label>
  );

  return (
    <div className="screen">
      {/* ---------- Pre-draft: full input ---------- */}
      {!hasDraft && (
        <>
          {hasContext
            ? <ReplyContext onClear={() => setHasContext(false)} />
            : <button className="attach-reply" onClick={() => setHasContext(true)}>
                <window.IcReply />
                <span className="attach-txt">
                  <span className="attach-label">Reply to a tweet</span>
                  <span className="attach-hint">pull in the post you're replying to</span>
                </span>
              </button>}

          <label className="fld compose-input">
            <span className="fld-label">{mode === 'reply' ? 'Your angle' : 'What do you want to say?'}</span>
            <textarea rows={4} value={bullets} onKeyDown={genKey} onChange={(e) => setBullets(e.target.value)}
              placeholder={mode === 'reply' ? "the point you want to make\nany detail to include" : "the topic\nyour angle\nany detail to include"} />
          </label>

          <div className="compose-tools">{CapSwitch}{!capped && <span className="help">soft cap 1000</span>}</div>

          <button className="btn primary lg block" disabled={!canGenerate} onClick={() => runGenerate(false)} title="⌘↵ to generate">
            {busy ? 'Drafting…' : <><window.IcSparkle /> {hasContext ? 'Generate reply' : 'Generate post'}</>}
          </button>

          {error
            ? <ErrorCard kind={error} onRetry={retry} onSettings={onOpenOptions} />
            : libraryCount === 0
              ? <p className="help" style={{ textAlign: 'center', margin: '2px 0' }}>
                  No examples yet — add a few in <strong style={{ color: 'var(--text-2)' }}>Voice</strong> so drafts sound like you.
                </p>
              : <p className="help" style={{ textAlign: 'center', margin: '2px 0' }}>
                  Drawing on <strong style={{ color: 'var(--text-2)' }}>{libraryCount} saved {libraryCount === 1 ? 'example' : 'examples'}</strong> of your writing. More in Voice means a closer match.
                </p>}
        </>
      )}

      {/* ---------- Draft exists ---------- */}
      {hasDraft && (
        <>
          {!expanded ? (
            <div className="brief">
              <span className={`badge ${mode}`}>{mode}</span>
              <button className="brief-main" onClick={() => setExpanded(true)} title="Edit your brief">
                <span className="brief-text">{mode === 'reply' ? <>to @{window.REPLY_CONTEXT.handle} · {briefText}</> : briefText}</span>
                <window.IcEdit className="brief-edit" />
              </button>
              <button className="icon-btn brief-discard" title="Discard & start over" onClick={discard}><window.IcTrash /></button>
            </div>
          ) : (
            <div className="card inset" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {hasContext
                ? <div className="brief-ctx"><window.IcReply /> Replying to @{window.REPLY_CONTEXT.handle}<span className="head-spacer" /><button className="icon-btn" style={{ width: 26, height: 26 }} title="Remove reply context" onClick={() => setHasContext(false)}><window.IcX /></button></div>
                : <button className="attach-reply sm" onClick={() => setHasContext(true)}><window.IcReply /> Reply to a tweet</button>}
              <label className="fld"><span className="fld-label">{mode === 'reply' ? 'Your angle' : 'What do you want to say?'}</span>
                <textarea rows={3} value={bullets} onKeyDown={genKey} onChange={(e) => setBullets(e.target.value)} /></label>
              {CapSwitch}
              <div className="pillrow">
                <button className="btn primary" onClick={() => runGenerate(false)}><window.IcRefresh /> Regenerate</button>
                <button className="btn ghost" onClick={() => setExpanded(false)}>Cancel</button>
              </div>
            </div>
          )}

          {error && <ErrorCard kind={error} onRetry={retry} onSettings={onOpenOptions} />}

          {/* THE DRAFT — focal point */}
          <div className="draft draft-lg">
            <div className="draft-head">
              <span className="eyebrow">Your draft</span>
              {refined && !busy && <span className="badge reply">refined</span>}
              <span className="head-spacer" />
              {busy && draft
                ? <span className="upd"><span className="upd-dot" />updating…</span>
                : <span className={`count ${over ? 'over' : ''}`} title="X-weighted count — URLs always count as 23, some characters as 2">{count}{capped ? ' / 280' : ' chars'}</span>}
            </div>
            {busy && !draft
              ? <div className="drafting"><div className="shim" style={{ width: '92%' }} /><div className="shim" style={{ width: '100%' }} /><div className="shim" style={{ width: '64%' }} /></div>
              : <>
                  <div className="draft-body">
                    <p className="draft-text" key={draft}>{draft}</p>
                  </div>
                  {over && <div className="draft-warn"><div className="callout warn"><window.IcWarn /><span>Over by {count - 280}. A tighten pass already ran — trim by hand or regenerate.</span></div></div>}
                  <div className="draft-actions">
                    <button className="btn primary lg" onClick={copy} disabled={busy}>{copied ? <><window.IcCheck /> Copied</> : <><window.IcCopy /> Copy to X</>}</button>
                    <button className="btn lg" title="Regenerate — same brief, fresh take" onClick={() => runGenerate(true)} disabled={busy}><window.IcRefresh /></button>
                    <button className="btn lg" title="Undo last change" disabled={prevDraft == null || busy} onClick={undo}><window.IcUndo /></button>
                  </div>
                </>}
          </div>

          {/* Refine */}
          <div className={`refine ${busy ? 'is-busy' : ''}`} aria-disabled={busy}>
            <div className="refine-block">
              <span className="eyebrow">Quick refine</span>
              <div className="pillrow">
                {window.CHIPS.map((c) => {
                  const n = chipCounts[c.id] || 0;
                  return (
                    <button key={c.id} className={`chip ${flash === c.id ? 'flash' : ''}`} title={c.instruction}
                            disabled={busy} onClick={() => applyChip(c)}>
                      {c.label}{n >= 2 && <span className="chip-x">×{n}</span>}
                    </button>
                  );
                })}
              </div>
              <p className="help">Tap to apply. Tap again to push the same direction further.</p>
            </div>
            <div className="refine-block">
              <span className="eyebrow">Steer it</span>
              <div className="moreless-grid">
                <div className="ml-cell">
                  <span className="ml-label"><window.IcMore /> More of</span>
                  <textarea rows={2} maxLength={140} value={more} disabled={busy} onKeyDown={steerKey} onChange={(e) => setMore(e.target.value)} placeholder="the dry humor, concrete detail…" />
                </div>
                <div className="ml-cell">
                  <span className="ml-label"><window.IcLess /> Less of</span>
                  <textarea rows={2} maxLength={140} value={less} disabled={busy} onKeyDown={steerKey} onChange={(e) => setLess(e.target.value)} placeholder="hedging, jargon, hype…" />
                </div>
              </div>
              <div className="steer-apply">
                <span className="help">Describe a tweak, then apply.</span>
                <button className="btn primary sm" disabled={!canApplySteer} onClick={applySteer}>Apply <span className="kbd kbd-on">⌘↵</span></button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ErrorCard({ kind, onRetry, onSettings }) {
  const e = ERRORS[kind] || ERRORS.network;
  const Icon = window[e.icon];
  return (
    <div className={`error-card ${e.tone}`}>
      <Icon className="ec-ic" />
      <div style={{ flex: 1 }}>
        <div className="ec-title">{e.title}</div>
        <div className="ec-msg">{e.msg}</div>
        <div className="ec-actions">
          {e.action === 'settings'
            ? <button className="btn sm" onClick={onSettings}><window.IcSettings /> Open settings</button>
            : <button className="btn sm" onClick={onRetry}><window.IcRefresh /> Retry</button>}
        </div>
      </div>
    </div>
  );
}

function ReplyContext({ onClear }) {
  const c = window.REPLY_CONTEXT;
  return (
    <div className="context-card">
      <div className="ctx-top">
        <window.IcReply style={{ width: 15, height: 15, color: 'var(--accent)' }} />
        <span className="eyebrow" style={{ color: 'var(--accent)' }}>Replying to</span>
        <span className="head-spacer" />
        <button className="icon-btn" style={{ width: 26, height: 26 }} title="Clear" onClick={onClear}><window.IcX /></button>
      </div>
      {c.grandparent && <div className="ctx-grand"><div className="ctx-thread-label">Earlier in thread</div><p className="ctx-thread-text">{c.grandparent}</p></div>}
      <div className="ctx-tweet">
        <div className="ctx-avatar" />
        <div className="ctx-tweet-body">
          <div className="ctx-namerow"><span className="ctx-author">{c.author}</span><span className="ctx-handle">@{c.handle}</span></div>
          <p className="ctx-text">{c.text}</p>
        </div>
      </div>
    </div>
  );
}

window.ComposeScreen = ComposeScreen;

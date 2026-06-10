// panel-voice.jsx — voice library: saving from X, filter, list, add manually,
// and prominent save-result feedback (success / not-yours / truncated / duplicate).
const { useState: useStateV, useRef: useRefV, useLayoutEffect: useLayoutEffectV, useEffect: useEffectV } = React;

const SAVE_META = {
  success:      { tone: 'ok',     icon: 'IcCheck', autodismiss: true },
  'text-media': { tone: 'warn',   icon: 'IcWarn',  autodismiss: false },
  duplicate:    { tone: 'info',   icon: 'IcInfo',  autodismiss: false },
  'not-mine':   { tone: 'danger', icon: 'IcX',     autodismiss: false },
  truncated:    { tone: 'warn',   icon: 'IcWarn',  autodismiss: false },
  'media-only': { tone: 'danger', icon: 'IcX',     autodismiss: false },
};

const CAPTURED = {
  post: "the best debugging tool is still a good night's sleep. half my \u201cimpossible\u201d bugs are just me being tired and missing the obvious.",
  reply: "this is the way \u2014 and write the comment explaining the hack before you write the hack, or future-you deletes it thinking it's dead code.",
  'text-media': "spent way too long making this little diagram but honestly it explained the whole system better than three paragraphs ever could.",
};

function VoiceScreen({ onToast, items, setItems }) {
  const [filter, setFilter] = useStateV('all');
  const [capture, setCapture] = useStateV(false);
  const [adding, setAdding] = useStateV(false);
  const [openIds, setOpenIds] = useStateV(() => new Set());
  const [result, setResult] = useStateV(null);   // { kind, type, stamp }
  const [justAdded, setJustAdded] = useStateV(null);
  const [flashDup, setFlashDup] = useStateV(null);
  const stampRef = useRefV(0);

  const posts = items.filter((i) => i.type === 'post').length;
  const replies = items.filter((i) => i.type === 'reply').length;
  const visible = filter === 'all' ? items : items.filter((i) => i.type === filter);

  // auto-dismiss only for success
  useEffectV(() => {
    if (!result || !SAVE_META[result.kind].autodismiss) return;
    const t = window.setTimeout(() => setResult(null), 4500);
    return () => window.clearTimeout(t);
  }, [result]);

  function remove(id) {
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const removed = items[idx];
    setItems((p) => p.filter((i) => i.id !== id));
    onToast && onToast('Removed', { label: 'Undo', onClick: () =>
      setItems((prev) => { const next = prev.slice(); next.splice(Math.min(idx, next.length), 0, removed); return next; }) });
  }
  function updateItem(id, patch) {
    setItems((p) => p.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    onToast && onToast('Changes saved');
  }
  function toggleRow(id) { setOpenIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  const visibleIds = visible.map((i) => i.id);
  const allOpen = visibleIds.length > 0 && visibleIds.every((id) => openIds.has(id));
  function toggleAll() { setOpenIds(allOpen ? new Set() : new Set(visibleIds)); }

  function announce(kind, type) { stampRef.current += 1; setResult({ kind, type, stamp: stampRef.current }); }
  function addItem(item) {
    setItems((p) => [item, ...p]);
    setJustAdded(item.id);
    window.setTimeout(() => setJustAdded(null), 2300);
  }
  function flagDuplicate(id) {
    setFlashDup(id);
    window.setTimeout(() => setFlashDup(null), 2300);
    announce('duplicate');
  }

  // manual add: dedupe, then succeed
  function manualAdd(it) {
    setAdding(false);
    const dup = items.find((i) => i.text.trim().toLowerCase() === it.text.trim().toLowerCase());
    if (dup) { setFilter('all'); flagDuplicate(dup.id); return; }
    addItem(it); announce('success', it.type);
  }

  // demo triggers (simulate clicking a tweet on x.com)
  function demo(kind) {
    setFilter('all');
    if (kind === 'post' || kind === 'reply') {
      addItem({ id: 'cap' + Date.now(), type: kind, source: 'captured', text: CAPTURED[kind] });
      announce('success', kind);
    } else if (kind === 'text-media') {
      addItem({ id: 'cap' + Date.now(), type: 'post', source: 'captured', text: CAPTURED['text-media'] });
      announce('text-media', 'post');
    } else if (kind === 'duplicate') {
      flagDuplicate('l1');
    } else {
      announce(kind);
    }
  }

  return (
    <div className="screen">
      {result && <SaveResult result={result} onDismiss={() => setResult(null)} onShowDup={() => flagDuplicate('l1')} />}

      <div>
        <h2 className="section-title">Voice</h2>
        <p className="help" style={{ marginTop: 2 }}>Examples of your own writing. Drafts borrow this voice — the more here, the closer the match.</p>
      </div>

      {/* Saving from X */}
      <div className={`capture-banner ${capture ? 'on' : ''}`}>
        <div className="cb-top">
          <span className="cb-dot" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{capture ? 'Saving from X' : 'Save tweets from X'}</div>
            <p className="help" style={{ marginTop: 1 }}>{capture ? 'Click your posts on x.com and they’ll land here.' : 'Click your own posts on x.com to save them. Only @' + window.HANDLE + '’s writing gets in.'}</p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={capture} onChange={(e) => setCapture(e.target.checked)} />
            <span className="track track-ok" />
          </label>
        </div>
      </div>

      {/* Demo strip — simulate clicking tweets on X to preview the messages */}
      {capture && (
        <div className="demo-strip">
          <div className="demo-top"><span className="demo-tag">Preview</span><span className="help">Simulate clicking a tweet on x.com:</span></div>
          <div className="pillrow">
            <button className="pill" onClick={() => demo('post')}>Your post</button>
            <button className="pill" onClick={() => demo('reply')}>Your reply</button>
            <button className="pill" onClick={() => demo('not-mine')}>Someone else’s</button>
            <button className="pill" onClick={() => demo('truncated')}>Cut-off tweet</button>
            <button className="pill" onClick={() => demo('text-media')}>Text + image</button>
            <button className="pill" onClick={() => demo('media-only')}>Image only</button>
            <button className="pill" onClick={() => demo('duplicate')}>Already saved</button>
          </div>
        </div>
      )}

      {/* Library section header */}
      <div className="lib-header">
        <div>
          <span className="eyebrow">Saved examples</span>
          <p className="help" style={{ marginTop: 2 }}>The writing your drafts learn from. Edit or retype anytime.</p>
        </div>
        <button className="icon-btn" title={adding ? 'Close' : 'Add manually'} onClick={() => setAdding(!adding)}>
          {adding ? <window.IcX /> : <window.IcPlus />}
        </button>
      </div>

      {adding && <AddForm onAdd={manualAdd} />}

      {/* Filter + expand-all */}
      <div className="field-row">
        <div className="pillrow">
          <button className={`pill ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All {items.length}</button>
          <button className={`pill ${filter === 'post' ? 'active' : ''}`} onClick={() => setFilter('post')}>Posts {posts}</button>
          <button className={`pill ${filter === 'reply' ? 'active' : ''}`} onClick={() => setFilter('reply')}>Replies {replies}</button>
        </div>
        {visible.length > 0 && (
          <button className="btn ghost sm" onClick={toggleAll}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
        )}
      </div>

      {visible.length === 0
        ? (items.length === 0
            ? <div className="empty"><window.IcVoice className="ei" />Nothing saved yet. Turn on saving above and click your own posts on x.com — or paste one in by hand.</div>
            : <div className="empty"><window.IcVoice className="ei" />No {filter === 'post' ? 'posts' : 'replies'} saved yet — switch to <strong>All</strong> to see the rest.</div>)
        : <ul className="lib-list">{visible.map((it) => (
            <LibRow key={it.id} item={it} open={openIds.has(it.id)}
              highlight={justAdded === it.id ? 'added' : flashDup === it.id ? 'dup' : null}
              onToggle={() => toggleRow(it.id)} onRemove={() => remove(it.id)} onSave={(patch) => updateItem(it.id, patch)} />
          ))}</ul>}
    </div>
  );
}

function SaveResult({ result, onDismiss, onShowDup }) {
  const meta = SAVE_META[result.kind];
  const Icon = window[meta.icon];
  const h = window.HANDLE;
  let title, msg, action = null;
  if (result.kind === 'success') { title = 'Saved to your voice'; msg = <>Added as a <strong>{result.type}</strong>.</>; }
  else if (result.kind === 'text-media') { title = 'Saved — text only'; msg = <>This post had media. We saved the <strong>text</strong>; images and quoted posts aren’t read.</>; }
  else if (result.kind === 'duplicate') { title = 'Already in your voice'; msg = 'You saved this one before — no need to add it twice.'; action = { label: 'Show me', onClick: onShowDup }; }
  else if (result.kind === 'not-mine') { title = 'Not saved'; msg = <>That post is by <strong>@lenabuilds</strong>. Only your own posts (@{h}) can join your voice.</>; }
  else if (result.kind === 'media-only') { title = 'Not saved — nothing to read'; msg = <>This post is media only. Margin learns from text, so there’s nothing to add to your voice.</>; }
  else { title = 'Not saved — this tweet is cut off'; msg = <>We only save the full text. Click <strong>“Show more”</strong> on the post to expand it, then save it again.</>; }

  return (
    <div className={`save-result ${meta.tone}`} role="status" key={result.stamp}>
      <span className="sr-ic"><Icon /></span>
      <div className="sr-body">
        <div className="sr-title">{title}</div>
        <div className="sr-msg">{msg}</div>
        {action && <button className="btn sm" onClick={action.onClick} style={{ marginTop: 8 }}>{action.label}</button>}
      </div>
      <button className="sr-x" onClick={onDismiss} title="Dismiss"><window.IcX /></button>
      {meta.autodismiss && <span className="sr-progress" />}
    </div>
  );
}

function LibRow({ item, open, onToggle, onRemove, onSave, highlight }) {
  const textRef = useRefV(null);
  const [truncatable, setTruncatable] = useStateV(false);
  const [editing, setEditing] = useStateV(false);
  const [text, setText] = useStateV(item.text);
  const [type, setType] = useStateV(item.type);
  useLayoutEffectV(() => {
    const el = textRef.current;
    if (el && !editing) setTruncatable(el.scrollHeight > el.clientHeight + 2);
  }, [editing]);
  const hl = highlight === 'added' ? 'just-added' : highlight === 'dup' ? 'flash-dup' : '';
  function save() { if (!text.trim()) return; onSave({ text: text.trim(), type }); setEditing(false); }
  function cancel() { setText(item.text); setType(item.type); setEditing(false); }
  return (
    <li className={`lib-row ${hl} ${editing ? 'editing' : ''}`}>
      <div className="lib-meta">
        <span className={`badge ${editing ? type : item.type}`}>{editing ? type : item.type}</span>
        <span className="badge outline">{item.source}</span>
        <span className="head-spacer" />
        {!editing && (
          <div className="lib-actions">
            <button className="icon-btn" style={{ width: 26, height: 26 }} title="Edit" onClick={() => setEditing(true)}><window.IcEdit /></button>
            <button className="icon-btn" style={{ width: 26, height: 26 }} title="Delete" onClick={onRemove}><window.IcTrash /></button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="lib-edit">
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="field-row">
            <div className="seg" style={{ flex: '0 0 auto' }}>
              <button className={type === 'post' ? 'active' : ''} onClick={() => setType('post')} style={{ padding: '5px 14px' }}>Post</button>
              <button className={type === 'reply' ? 'active' : ''} onClick={() => setType('reply')} style={{ padding: '5px 14px' }}>Reply</button>
            </div>
            <span className="head-spacer" />
            <button className="btn ghost sm" onClick={cancel}>Cancel</button>
            <button className="btn primary sm" disabled={!text.trim()} onClick={save}>Save</button>
          </div>
        </div>
      ) : (
        <>
          <p ref={textRef} className={`lib-text ${open ? '' : 'clamp'}`}>{item.text}</p>
          {(truncatable || open) && (
            <button className="lib-more" onClick={onToggle}>{open ? 'Show less' : 'Show more'}</button>
          )}
        </>
      )}
    </li>
  );
}

function AddForm({ onAdd }) {
  const [text, setText] = useStateV('');
  const [type, setType] = useStateV('post');
  const [ok, setOk] = useStateV(false);
  return (
    <div className="card inset" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="fld">
        <span className="fld-label">Paste your own post or reply</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="exactly as you wrote it" />
      </label>
      <div className="field-row">
        <div className="seg" style={{ flex: '0 0 auto' }}>
          <button className={type === 'post' ? 'active' : ''} onClick={() => setType('post')} style={{ padding: '5px 14px' }}>Post</button>
          <button className={type === 'reply' ? 'active' : ''} onClick={() => setType('reply')} style={{ padding: '5px 14px' }}>Reply</button>
        </div>
      </div>
      <label className="switch"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span className="track" /><span className="help" style={{ color: 'var(--text-2)' }}>This is my own writing</span></label>
      <button className="btn primary" disabled={!text.trim() || !ok} onClick={() => onAdd({ id: 'n' + Date.now(), type, source: 'manual', text: text.trim() })}>Save to voice</button>
    </div>
  );
}

window.VoiceScreen = VoiceScreen;

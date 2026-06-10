// panel-settings.jsx — full-page settings sections (Account, Output rules, Data)
// + category metadata. Prompts lives in panel-prompts.jsx.
const { useState: useStateS } = React;

const SET_CATEGORIES = [
  { id: 'account', name: 'Account',      desc: 'Handle, API key, key storage', icon: 'IcKey',
    blurb: 'Your handle and API key. Stored locally in this browser — never synced.' },
  { id: 'rules',   name: 'Output rules', desc: 'Structure, banlist, sampling',  icon: 'IcSliders',
    blurb: 'Shape what the model may say and how adventurous it gets. Saves as you go.' },
  { id: 'prompts', name: 'Prompts',      desc: 'Templates, chips, last prompt', icon: 'IcPrompt',
    blurb: 'Every template and chip behind a draft — fully editable, nothing hidden.' },
  { id: 'data',    name: 'Data',         desc: 'Export or clear your voice',    icon: 'IcData',
    blurb: 'Everything Margin has saved lives on your machine. Take it or wipe it.' },
];

/* ---------- Account (explicit save — it holds a key) ---------- */
function AccountSection() {
  const [mode, setMode] = useStateS('local');
  const [saved, setSaved] = useStateS(false);
  const [verified, setVerified] = useStateS(false);
  return (
    <div className="opt-stack">
      <div className="opt-card">
        <div className="opt-card-title">Your X account</div>
        <p className="opt-card-desc">The hard filter for saving — only posts from this handle can join your voice.</p>
        <label className="fld" style={{ maxWidth: 320 }}>
          <span className="fld-label">X handle</span>
          <div className="input-prefixed">
            <span className="ip-prefix">@</span>
            <input type="text" defaultValue={window.HANDLE} placeholder="yourhandle" />
          </div>
        </label>
      </div>

      <div className="opt-card">
        <div className="opt-card-title">Anthropic API key</div>
        <p className="opt-card-desc">Read only by the background worker — never injected into the X page, never logged.</p>
        <div className="opt-grid-2">
          <label className="fld">
            <span className="fld-label">API key</span>
            <input type="password" defaultValue="sk-ant-••••••••••••••••••••" />
          </label>
          <label className="fld">
            <span className="fld-label">Where to keep it</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="local">Persistent — survives restarts</option>
              <option value="session">Session only — cleared on quit</option>
            </select>
          </label>
        </div>
        <div className="callout warn">
          <window.IcShield />
          <span><strong>Set a spend cap first.</strong> Your key is stored unencrypted, protected by your OS account and the extension sandbox. A leak is bounded to API spend and revocable in seconds.</span>
        </div>
        <div className="pillrow" style={{ marginTop: 4 }}>
          <button className="btn primary" onClick={() => { setSaved(true); window.setTimeout(() => setSaved(false), 1600); }}>{saved ? <><window.IcCheck /> Saved</> : 'Save key'}</button>
          <button className="btn" onClick={() => { setVerified(true); window.setTimeout(() => setVerified(false), 1600); }}><window.IcKey /> Verify</button>
          {verified && <span className="status ok"><window.IcCheck /> Key works</span>}
        </div>
      </div>
    </div>
  );
}

/* ---------- Output rules (immediate apply + quiet Saved) ---------- */
function RulesSection({ onSaved }) {
  const [rules, setRules] = useStateS({ em: true, quotes: true, staccato: false });
  const [pool, setPool] = useStateS(18);
  const [tGen, setTGen] = useStateS(0.7);
  const [tRegen, setTRegen] = useStateS(0.9);
  const ping = () => onSaved && onSaved();
  const toggle = (k) => { setRules({ ...rules, [k]: !rules[k] }); ping(); };
  return (
    <div className="opt-stack">
      <div className="opt-grid-2">
        <div className="opt-card">
          <div className="opt-card-title">Structural rules</div>
          <p className="opt-card-desc">The prompt asks the model to avoid these; a deterministic check + one repair pass catches any residue.</p>
          <div className="rule-list">
            {[['em', 'No em dashes (—)'], ['quotes', 'No smart / curly quotes'], ['staccato', 'No staccato runs (3+ short sentences)']].map(([k, label]) => (
              <label key={k} className="field-row rule-toggle">
                <span>{label}</span>
                <span className="switch"><input type="checkbox" checked={rules[k]} onChange={() => toggle(k)} /><span className="track" /></span>
              </label>
            ))}
          </div>
        </div>
        <div className="opt-card">
          <div className="opt-card-title">Do-not-say banlist</div>
          <p className="opt-card-desc">One entry per line. Matched whole-word and case-insensitive.</p>
          <textarea rows={6} defaultValue={window.BANLIST.join('\n')} onChange={ping} style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)' }} />
        </div>
      </div>

      <div className="opt-grid-2">
        <div className="opt-card">
          <div className="opt-card-title">Example sampling</div>
          <div className="field-row"><span className="fld-label">Pool size</span><span className="count">{pool}</span></div>
          <input type="range" className="range" min={5} max={40} value={pool} onChange={(e) => { setPool(+e.target.value); ping(); }} />
          <p className="opt-card-desc">How many of your saved examples the prompt may sample. Higher = more variety, longer prompt.</p>
        </div>
        <div className="opt-card">
          <div className="opt-card-title">Temperature</div>
          <div className="field-row"><span className="fld-label">Generate</span><span className="count">{tGen.toFixed(2)}</span></div>
          <input type="range" className="range" min={0} max={1} step={0.05} value={tGen} onChange={(e) => { setTGen(+e.target.value); ping(); }} />
          <div className="field-row" style={{ marginTop: 8 }}><span className="fld-label">Regenerate</span><span className="count">{tRegen.toFixed(2)}</span></div>
          <input type="range" className="range" min={0} max={1} step={0.05} value={tRegen} onChange={(e) => { setTRegen(+e.target.value); ping(); }} />
          <p className="opt-card-desc">Regenerate runs hotter so re-rolls feel different.</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- Data ---------- */
function DataSection({ library, setLibrary, onSaved }) {
  const [done, setDone] = useStateS(false);
  const [confirming, setConfirming] = useStateS(false);
  const count = library ? library.length : 0;
  function clearAll() { setLibrary && setLibrary([]); setConfirming(false); onSaved && onSaved(); }
  return (
    <div className="opt-stack">
      <div className="opt-card">
        <div className="opt-card-title">Export your voice</div>
        <p className="opt-card-desc">A portable backup of every saved example, independent of this browser. Generated locally — nothing leaves your machine.</p>
        <ul className="spec-list">
          <li><span>Format</span><span className="mono-val">JSON · schema v1</span></li>
          <li><span>Includes</span><span className="mono-val">{count} {count === 1 ? 'example' : 'examples'}, type & source</span></li>
          <li><span>Destination</span><span className="mono-val">your downloads folder</span></li>
        </ul>
        <button className="btn primary" disabled={count === 0} onClick={() => { setDone(true); window.setTimeout(() => setDone(false), 1600); }}>
          {done ? <><window.IcCheck /> Exported {count} {count === 1 ? 'item' : 'items'}</> : <><window.IcExport /> Export as JSON</>}
        </button>
      </div>

      <div className="opt-card danger-zone">
        <div className="opt-card-title">Clear voice library</div>
        <p className="opt-card-desc">Removes all {count} saved {count === 1 ? 'example' : 'examples'} from this browser. This can’t be undone — export first if you want a copy.</p>
        {!confirming
          ? <button className="btn danger-outline" disabled={count === 0} onClick={() => setConfirming(true)}><window.IcTrash /> Clear everything</button>
          : <div className="confirm-row">
              <span className="help">Delete all {count}? This is permanent.</span>
              <span className="head-spacer" />
              <button className="btn ghost sm" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn danger-solid sm" onClick={clearAll}>Yes, clear it</button>
            </div>}
      </div>
    </div>
  );
}

Object.assign(window, { AccountSection, RulesSection, DataSection, SET_CATEGORIES });

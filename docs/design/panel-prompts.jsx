// panel-prompts.jsx — the Prompts settings section: single-open template
// accordion, a real chip editor, and a working last-prompt inspector.
const { useState: useStatePr } = React;

function PromptsSection({ onSaved }) {
  const groups = ['Generation', 'Refine', 'Repair'];
  const [openKey, setOpenKey] = useStatePr(null);
  const [templates, setTemplates] = useStatePr(() =>
    window.PROMPT_TEMPLATES.map((t) => ({ ...t, base: t.def ?? t.body })));
  const [chips, setChips] = useStatePr(() => window.CHIPS.map((c) => ({ ...c })));

  function editBody(key, body) { setTemplates((ts) => ts.map((t) => (t.key === key ? { ...t, body } : t))); onSaved && onSaved(); }
  function resetTemplate(key) { setTemplates((ts) => ts.map((t) => (t.key === key ? { ...t, body: t.base } : t))); onSaved && onSaved(); }

  function setChip(id, patch) { setChips((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c))); onSaved && onSaved(); }
  function addChip() { setChips((cs) => [...cs, { id: 'c' + Date.now(), label: '', instruction: '' }]); }
  function removeChip(id) { setChips((cs) => cs.filter((c) => c.id !== id)); onSaved && onSaved(); }
  function resetChips() { setChips(window.CHIPS.map((c) => ({ ...c }))); onSaved && onSaved(); }

  return (
    <div className="opt-stack">
      {/* Templates */}
      <div className="opt-card">
        <div className="opt-card-title">Prompt templates</div>
        <p className="opt-card-desc">The exact text sent to the model. Slots like <code>{'{{bullets}}'}</code> are filled at generation time. One open at a time.</p>
        <div className="tmpl-groups">
          {groups.map((g) => (
            <div key={g} className="tmpl-group">
              <span className="eyebrow">{g}</span>
              {templates.filter((t) => t.group === g).map((t) => (
                <TemplateRow key={t.key} tmpl={t} open={openKey === t.key}
                  onToggle={() => setOpenKey(openKey === t.key ? null : t.key)}
                  onEdit={(body) => editBody(t.key, body)} onReset={() => resetTemplate(t.key)} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Chips */}
      <div className="opt-card">
        <div className="opt-card-head">
          <div>
            <div className="opt-card-title">Refine chips</div>
            <p className="opt-card-desc">Each becomes a one-tap button under a draft. The label shows on the chip; the instruction is what the model is told.</p>
          </div>
          <button className="btn ghost sm" onClick={resetChips}>Reset to defaults</button>
        </div>
        <div className="chip-editor">
          <div className="chip-edit-head">
            <span>Label</span><span>Instruction sent to the model</span><span />
          </div>
          {chips.map((c) => (
            <div key={c.id} className="chip-edit-row">
              <input type="text" value={c.label} placeholder="Shorter" onChange={(e) => setChip(c.id, { label: e.target.value })} />
              <input type="text" value={c.instruction} placeholder="Cut it down. Keep only the sharpest line." onChange={(e) => setChip(c.id, { instruction: e.target.value })} />
              <button className="icon-btn" title="Remove chip" onClick={() => removeChip(c.id)}><window.IcTrash /></button>
            </div>
          ))}
        </div>
        <button className="btn sm" style={{ marginTop: 10 }} onClick={addChip}><window.IcPlus /> Add chip</button>
      </div>

      {/* Inspector */}
      <LastPromptInspector />
    </div>
  );
}

function TemplateRow({ tmpl, open, onToggle, onEdit, onReset }) {
  const edited = tmpl.body !== tmpl.base;
  const present = (tmpl.body.match(/\{\{(\w+)\}\}/g) || []).map((s) => s.replace(/[{}]/g, ''));
  const missing = tmpl.slots.filter((s) => !present.includes(s));
  return (
    <div className={`collapse ${open ? 'open' : ''}`}>
      <button className="collapse-head" onClick={onToggle}>
        <span>{tmpl.label}</span>
        {edited && <span className="badge warn" style={{ marginLeft: 6 }}>edited</span>}
        {missing.length > 0 && <span className="badge danger-badge" style={{ marginLeft: 6 }}>missing slot</span>}
        <window.IcChevR className="chev" />
      </button>
      {open && (
        <div className="collapse-body">
          <textarea rows={7} value={tmpl.body} onChange={(e) => onEdit(e.target.value)} />
          <div className="slot-row">
            <span className="slot-label">Slots</span>
            {tmpl.slots.map((s) => (
              <span key={s} className={`slot ${present.includes(s) ? 'ok' : 'missing'}`}>
                {present.includes(s) ? <window.IcCheck /> : <window.IcWarn />}{'{{' + s + '}}'}
              </span>
            ))}
          </div>
          {missing.length > 0 && <p className="help slot-warn">Missing {missing.map((s) => '{{' + s + '}}').join(', ')} — the model won’t receive {missing.length > 1 ? 'these' : 'this'} at generation time.</p>}
          <div className="field-row">
            <span className="tmpl-meta">{window.weighted(tmpl.body)} chars</span>
            <button className="btn sm ghost" disabled={!edited} onClick={onReset}>Reset to default</button>
          </div>
        </div>
      )}
    </div>
  );
}

function LastPromptInspector() {
  const [open, setOpen] = useStatePr(false);
  const [copied, setCopied] = useStatePr(null);
  const p = window.LAST_PROMPT;
  function copy(label, text) { setCopied(label); window.setTimeout(() => setCopied(null), 1400); }
  const blocks = [
    { label: 'System', text: p.system },
    { label: 'User', text: p.user },
    { label: 'Response', text: p.response, response: true },
  ];
  return (
    <div className="opt-card">
      <div className="opt-card-head">
        <div>
          <div className="opt-card-title">Inspect last prompt</div>
          <p className="opt-card-desc">The exact text last sent to Anthropic and what came back. Kept only for this browser session.</p>
        </div>
        <button className="btn sm" onClick={() => setOpen(!open)}>
          <window.IcSearch />{open ? 'Hide' : 'View'}
        </button>
      </div>
      {open && (
        <div className="inspector">
          <div className="insp-meta">
            <span className="badge mono">{p.model}</span>
            <span className="help">sent {p.when}</span>
          </div>
          {blocks.map((b) => (
            <div key={b.label} className={`insp-block ${b.response ? 'is-response' : ''}`}>
              <div className="insp-head">
                <span className="insp-label">{b.label}</span>
                <span className="insp-count">{window.weighted(b.text)} chars</span>
                <button className="insp-copy" onClick={() => copy(b.label, b.text)}>
                  {copied === b.label ? <><window.IcCheck /> Copied</> : <><window.IcCopy /> Copy</>}
                </button>
              </div>
              <pre className="insp-pre">{b.text}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

window.PromptsSection = PromptsSection;

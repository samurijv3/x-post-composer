import { useCallback, useEffect, useState } from 'react';
import { getSettings, setSettings } from '../../storage';
import {
  DEFAULT_SETTINGS,
  type ChipPreset,
  type PromptTemplate,
  type PromptTemplateKey,
  type Settings,
} from '../../types';
import { extractSlotNames, SYSTEM_USER_MARKER, validateTemplate } from '../../lib/prompt';
import { weightedLength } from '../../lib/counting';
import { IcChevR, IcCheck, IcPlus, IcTrash, IcWarn } from '../icons';

interface Props {
  onSaved: () => void;
}

const TEMPLATE_GROUPS: { name: string; keys: PromptTemplateKey[] }[] = [
  { name: 'Generation', keys: ['reply', 'post'] },
  { name: 'Refine', keys: ['chipRefine', 'moreLessRefine'] },
  { name: 'Repair', keys: ['repair', 'tighten'] },
];

const TEMPLATE_LABELS: Record<PromptTemplateKey, string> = {
  reply: 'Reply',
  post: 'Post',
  chipRefine: 'Chip refine',
  moreLessRefine: 'More / less refine',
  repair: 'Repair',
  tighten: 'Tighten',
};

export function PromptsSection({ onSaved }: Props) {
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [openKey, setOpenKey] = useState<PromptTemplateKey | null>(null);

  const load = useCallback(async () => {
    setSettingsState(await getSettings());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveTemplate(key: PromptTemplateKey, next: PromptTemplate): Promise<void> {
    if (!settings) return;
    const promptTemplates = { ...settings.promptTemplates, [key]: next };
    await setSettings({ promptTemplates });
    onSaved();
    await load();
  }

  async function resetTemplate(key: PromptTemplateKey): Promise<void> {
    if (!settings) return;
    await saveTemplate(key, DEFAULT_SETTINGS.promptTemplates[key]);
  }

  async function saveChips(next: ChipPreset[]): Promise<void> {
    await setSettings({ chips: next });
    onSaved();
    await load();
  }

  if (!settings) return <div className="opt-card">Loading…</div>;

  return (
    <div className="opt-stack">
      <div className="opt-card">
        <div className="opt-card-title">Prompt templates</div>
        <p className="opt-card-desc">
          The exact text sent to the model. Slots like <code>{'{{bullets}}'}</code> are filled at
          generation time. Generation templates use a <code>===USER===</code> marker — text above is
          sent as the system message, text below as the user message. One open at a time.
        </p>
        <div className="tmpl-groups">
          {TEMPLATE_GROUPS.map((g) => (
            <div key={g.name} className="tmpl-group">
              <span className="eyebrow">{g.name}</span>
              {g.keys.map((key) => (
                <TemplateRow
                  key={key}
                  templateKey={key}
                  template={settings.promptTemplates[key]}
                  defaultTemplate={DEFAULT_SETTINGS.promptTemplates[key]}
                  open={openKey === key}
                  onToggle={() => setOpenKey(openKey === key ? null : key)}
                  onSave={(next) => void saveTemplate(key, next)}
                  onReset={() => void resetTemplate(key)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <ChipEditor
        chips={settings.chips}
        defaultChips={DEFAULT_SETTINGS.chips}
        onSave={(next) => void saveChips(next)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Template row (collapsible)
// ---------------------------------------------------------------------

interface TemplateRowProps {
  templateKey: PromptTemplateKey;
  template: PromptTemplate;
  defaultTemplate: PromptTemplate;
  open: boolean;
  onToggle: () => void;
  onSave: (next: PromptTemplate) => void;
  onReset: () => void;
}

function TemplateRow({
  templateKey,
  template,
  defaultTemplate,
  open,
  onToggle,
  onSave,
  onReset,
}: TemplateRowProps) {
  const [body, setBody] = useState<string>(template.body);
  useEffect(() => {
    setBody(template.body);
  }, [template.body]);
  const edited = body !== template.body || template.body !== defaultTemplate.body;
  const live: PromptTemplate = { ...template, body };
  // The same parser the engine uses — a local regex here once disagreed
  // with it on whitespace ({{ name }}) and showed false "missing slot"
  // badges for templates that rendered fine.
  const v = validateTemplate(live);
  const present = new Set(extractSlotNames(body));
  const missing = v.declaredButUnused;
  // Generation templates use the `===USER===` marker to split the
  // prompt into a system message + a per-call user message.
  // If a user removes it, the prompt still works (sent as a single
  // user message) but loses the system framing — flag it so they're
  // not surprised.
  const isGenerationTemplate = templateKey === 'reply' || templateKey === 'post';
  const markerMissing = isGenerationTemplate && !body.includes(SYSTEM_USER_MARKER);

  function save(): void {
    if (body === template.body) return;
    onSave({ ...template, body });
  }

  return (
    <div className={`collapse ${open ? 'open' : ''}`}>
      <button type="button" className="collapse-head" onClick={onToggle}>
        <span>{TEMPLATE_LABELS[templateKey]}</span>
        {body !== defaultTemplate.body && (
          <span className="badge warn" style={{ marginLeft: 6 }}>
            edited
          </span>
        )}
        {missing.length > 0 && (
          <span className="badge danger-badge" style={{ marginLeft: 6 }}>
            missing slot
          </span>
        )}
        {markerMissing && (
          <span className="badge warn" style={{ marginLeft: 6 }}>
            no system/user split
          </span>
        )}
        <IcChevR className="chev" />
      </button>
      {open && (
        <div className="collapse-body">
          <textarea
            rows={9}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={save}
            spellCheck={false}
          />
          <div className="slot-row">
            <span className="slot-label">Slots</span>
            {template.slots.map((s) => (
              <span key={s} className={`slot ${present.has(s) ? 'ok' : 'missing'}`}>
                {present.has(s) ? <IcCheck /> : <IcWarn />}
                {'{{' + s + '}}'}
              </span>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="help slot-warn">
              Missing {missing.map((s) => '{{' + s + '}}').join(', ')} — the model won’t receive{' '}
              {missing.length > 1 ? 'these' : 'this'} at generation time.
            </p>
          )}
          {v.usedButUndeclared.length > 0 && (
            <p className="help slot-warn">
              Body uses undeclared slots: {v.usedButUndeclared.join(', ')} (they’ll render as empty
              strings).
            </p>
          )}
          {markerMissing && (
            <p className="help" style={{ color: 'var(--warn)' }}>
              <strong>Heads up:</strong> the <code>===USER===</code> marker is missing. The whole
              template will be sent as a single user message — no system framing, no prompt caching.
              Add <code>===USER===</code> on its own line to separate the stable instructions
              (above) from the per-call inputs (below).
            </p>
          )}
          <div className="field-row">
            <span className="tmpl-meta">{weightedLength(body)} chars</span>
            <button type="button" className="btn sm ghost" disabled={!edited} onClick={onReset}>
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Chip editor
// ---------------------------------------------------------------------

interface ChipEditorProps {
  chips: ChipPreset[];
  defaultChips: ChipPreset[];
  onSave: (next: ChipPreset[]) => void;
}

function ChipEditor({ chips, defaultChips, onSave }: ChipEditorProps) {
  const [working, setWorking] = useState<ChipPreset[]>(chips);
  useEffect(() => {
    setWorking(chips);
  }, [chips]);

  function patch(idx: number, p: Partial<ChipPreset>): void {
    const next = working.map((c, i) => (i === idx ? { ...c, ...p } : c));
    setWorking(next);
    onSave(next);
  }
  function remove(idx: number): void {
    const next = working.filter((_, i) => i !== idx);
    setWorking(next);
    onSave(next);
  }
  function add(): void {
    const next = [
      ...working,
      {
        id: `chip-${String(Date.now())}`,
        label: '',
        instruction: '',
      },
    ];
    setWorking(next);
    onSave(next);
  }
  function reset(): void {
    setWorking(defaultChips);
    onSave(defaultChips);
  }

  return (
    <div className="opt-card">
      <div className="opt-card-head">
        <div>
          <div className="opt-card-title">Refine chips</div>
          <p className="opt-card-desc">
            Each becomes a one-tap button under a draft. The label shows on the chip; the
            instruction is what the model is told.
          </p>
        </div>
        <button type="button" className="btn ghost sm" onClick={reset}>
          Reset to defaults
        </button>
      </div>
      <div className="chip-editor">
        <div className="chip-edit-head">
          <span>Label</span>
          <span>Instruction sent to the model</span>
          <span />
        </div>
        {working.map((c, idx) => (
          <div key={c.id} className="chip-edit-row">
            <input
              type="text"
              value={c.label}
              placeholder="Shorter"
              onChange={(e) => patch(idx, { label: e.target.value })}
            />
            <input
              type="text"
              value={c.instruction}
              placeholder="Cut it down. Keep only the sharpest line."
              onChange={(e) => patch(idx, { instruction: e.target.value })}
            />
            <button
              type="button"
              className="icon-btn"
              title="Remove chip"
              aria-label="Remove chip"
              onClick={() => remove(idx)}
            >
              <IcTrash />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={add}>
        <IcPlus /> Add chip
      </button>
    </div>
  );
}

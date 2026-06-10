import { useCallback, useEffect, useState } from 'react';
import { getSettings, setSettings } from '../../storage';
import {
  DEFAULT_SETTINGS,
  type ChipPreset,
  type PromptTemplate,
  type PromptTemplateKey,
  type Settings,
} from '../../types';
import { ChipEditor } from './prompts/ChipEditor';
import { TemplateRow } from './prompts/TemplateRow';

interface Props {
  onSaved: () => void;
}

const TEMPLATE_GROUPS: { name: string; keys: PromptTemplateKey[] }[] = [
  { name: 'Generation', keys: ['reply', 'post'] },
  { name: 'Refine', keys: ['chipRefine', 'moreLessRefine'] },
  { name: 'Repair', keys: ['repair', 'tighten'] },
];

/** Prompts section — every template and chip behind a draft, editable. */
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

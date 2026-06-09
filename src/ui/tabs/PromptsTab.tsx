import { useCallback, useEffect, useState } from 'react';
import type { ChipPreset, PromptTemplate, PromptTemplateKey, Settings } from '../../types';
import { DEFAULT_SETTINGS } from '../../types';
import { getSettings, setSettings } from '../../storage';
import { TemplateEditor } from '../TemplateEditor';
import { LastPromptInspector } from '../LastPromptInspector';
import { ChipManager } from '../ChipManager';

const GENERATION_TEMPLATES: PromptTemplateKey[] = ['reply', 'post'];
const REFINE_TEMPLATES: PromptTemplateKey[] = ['chipRefine', 'moreLessRefine'];
const REPAIR_TEMPLATES: PromptTemplateKey[] = ['repair', 'tighten'];

export function PromptsTab() {
  const [settings, setSettingsState] = useState<Settings | null>(null);

  const load = useCallback(async () => {
    const s = await getSettings();
    setSettingsState(s);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveTemplate(key: PromptTemplateKey, next: PromptTemplate): Promise<void> {
    if (!settings) return;
    const promptTemplates = { ...settings.promptTemplates, [key]: next };
    await setSettings({ promptTemplates });
    await load();
  }

  async function saveChips(next: ChipPreset[]): Promise<void> {
    await setSettings({ chips: next });
    await load();
  }

  if (!settings) return <div className="stub">Loading…</div>;

  return (
    <div className="tab-panel">
      <section>
        <h2>Generation templates</h2>
        <p className="help">
          Top-level templates the generator uses for fresh drafts. Slot drift is shown inline;
          Reset restores the bundled default.
        </p>
        {GENERATION_TEMPLATES.map((key) => (
          <TemplateEditor
            key={key}
            templateKey={key}
            template={settings.promptTemplates[key]}
            defaultTemplate={DEFAULT_SETTINGS.promptTemplates[key]}
            onSave={(next) => saveTemplate(key, next)}
          />
        ))}
      </section>

      <section>
        <h2>Refine templates</h2>
        <p className="help">
          Wrappers used by the interaction controls. The chip refine template injects whichever
          chip&apos;s instruction the user clicked; the more/less refine template injects the
          contents of the two steering fields.
        </p>
        {REFINE_TEMPLATES.map((key) => (
          <TemplateEditor
            key={key}
            templateKey={key}
            template={settings.promptTemplates[key]}
            defaultTemplate={DEFAULT_SETTINGS.promptTemplates[key]}
            onSave={(next) => saveTemplate(key, next)}
          />
        ))}
      </section>

      <section>
        <h2>Repair templates</h2>
        <p className="help">
          One-shot backstops the pipeline fires automatically. <code>repair</code> handles
          structural / do-not-say residue after auto-fix; <code>tighten</code> fires when the
          ≤280 gate is on and the draft exceeds it.
        </p>
        {REPAIR_TEMPLATES.map((key) => (
          <TemplateEditor
            key={key}
            templateKey={key}
            template={settings.promptTemplates[key]}
            defaultTemplate={DEFAULT_SETTINGS.promptTemplates[key]}
            onSave={(next) => saveTemplate(key, next)}
          />
        ))}
      </section>

      <section>
        <h2>Refine chips</h2>
        <p className="help">
          Each chip becomes a button under the draft. Clicking it injects the chip&apos;s
          instruction into the chip-refine template above. Regenerate is NOT editable as a chip
          — it&apos;s a structural reshuffle, not a prompt fragment.
        </p>
        <ChipManager chips={settings.chips} onSave={saveChips} />
      </section>

      <section>
        <h2>Inspect last prompt</h2>
        <p className="help">
          The exact text last sent to Anthropic, with the full response. Repairs and tighten
          calls are chained inline so you can see the whole conversation. Stored only for this
          browser session.
        </p>
        <LastPromptInspector />
      </section>
    </div>
  );
}

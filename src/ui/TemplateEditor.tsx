import { useEffect, useState } from 'react';
import type { PromptTemplate, PromptTemplateKey } from '../types';
import { validateTemplate } from '../lib/prompt';

interface Props {
  templateKey: PromptTemplateKey;
  template: PromptTemplate;
  defaultTemplate: PromptTemplate;
  onSave: (next: PromptTemplate) => Promise<void> | void;
}

/**
 * Editor for a single prompt template. Lets the user rewrite the body,
 * shows slot-validation drift inline, and offers a one-click reset to
 * the bundled default. Editing is local until Save.
 */
export function TemplateEditor({ templateKey, template, defaultTemplate, onSave }: Props) {
  const [body, setBody] = useState<string>(template.body);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setBody(template.body);
  }, [template.body]);

  const dirty = body !== template.body;

  // Validate based on the EDITED body so the user sees drift live.
  const live: PromptTemplate = { ...template, body };
  const v = validateTemplate(live);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await onSave({ ...template, body });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  function reset(): void {
    if (!window.confirm(`Reset the ${template.name} template to the bundled default?`)) return;
    setBody(defaultTemplate.body);
  }

  return (
    <div className="template-editor">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{template.name} template</strong>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" onClick={reset}>
            Reset to default
          </button>
          <button
            className="primary"
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <textarea
        rows={14}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        spellCheck={false}
        aria-label={`${template.name} template body`}
      />
      <div className="help">
        Slot syntax: <code>{'{{slotName}}'}</code>. Declared slots for{' '}
        <code>{templateKey}</code>: {template.slots.join(', ') || '(none)'}.
      </div>
      {v.usedButUndeclared.length > 0 && (
        <div className="status err">
          Body uses undeclared slots: {v.usedButUndeclared.join(', ')}. They will render as
          empty strings since the orchestrator does not know how to fill them.
        </div>
      )}
      {v.declaredButUnused.length > 0 && (
        <div className="status">
          Heads up: declared slots not present in the body: {v.declaredButUnused.join(', ')}.
          Their values will be ignored at assembly time.
        </div>
      )}
      {savedAt !== null && !dirty && <div className="status ok">Saved.</div>}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { PromptTemplate, PromptTemplateKey } from '../../../types';
import { extractSlotNames, validateTemplate } from '../../../lib/prompt';
import { weightedLength } from '../../../lib/counting';
import { IcCheck, IcChevR, IcWarn } from '../../icons';

const TEMPLATE_LABELS: Record<PromptTemplateKey, string> = {
  reply: 'Reply',
  post: 'Post',
  thread: 'Thread',
  refine: 'Refine',
};

interface TemplateRowProps {
  templateKey: PromptTemplateKey;
  template: PromptTemplate;
  defaultTemplate: PromptTemplate;
  open: boolean;
  onToggle: () => void;
  onSave: (next: PromptTemplate) => void;
  onReset: () => void;
}

/**
 * One collapsible template editor — a System body and a User body, each
 * its own textarea mapping one-to-one onto the message roles sent to
 * Anthropic — with slot badges and drift warnings across both bodies.
 */
export function TemplateRow({
  templateKey,
  template,
  defaultTemplate,
  open,
  onToggle,
  onSave,
  onReset,
}: TemplateRowProps) {
  const [system, setSystem] = useState<string>(template.system);
  const [user, setUser] = useState<string>(template.user);
  useEffect(() => {
    setSystem(template.system);
    setUser(template.user);
  }, [template.system, template.user]);
  const dirty = system !== template.system || user !== template.user;
  const savedEdited =
    template.system !== defaultTemplate.system || template.user !== defaultTemplate.user;
  const live: PromptTemplate = { ...template, system, user };
  // The same parser the engine uses — a local regex here once disagreed
  // with it on whitespace ({{ name }}) and showed false "missing slot"
  // badges for templates that rendered fine.
  const v = validateTemplate(live);
  const present = new Set([...extractSlotNames(system), ...extractSlotNames(user)]);
  const missing = v.declaredButUnused;

  function save(): void {
    if (!dirty) return;
    onSave({ ...template, system, user });
  }

  return (
    <div className={`collapse ${open ? 'open' : ''}`}>
      <button type="button" className="collapse-head" onClick={onToggle}>
        <span>{TEMPLATE_LABELS[templateKey]}</span>
        {(dirty || savedEdited) && (
          <span className="badge warn" style={{ marginLeft: 6 }}>
            edited
          </span>
        )}
        {missing.length > 0 && (
          <span className="badge danger-badge" style={{ marginLeft: 6 }}>
            missing slot
          </span>
        )}
        <IcChevR className="chev" />
      </button>
      {open && (
        <div className="collapse-body">
          <span className="slot-label" style={{ display: 'block', marginBottom: 4 }}>
            System — stable framing, sent as the system message
          </span>
          <textarea
            rows={8}
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            onBlur={save}
            spellCheck={false}
          />
          <span className="slot-label" style={{ display: 'block', margin: '10px 0 4px' }}>
            User — per-call content, sent as the user message
          </span>
          <textarea
            rows={8}
            value={user}
            onChange={(e) => setUser(e.target.value)}
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
          <div className="field-row">
            <span className="tmpl-meta">{weightedLength(system) + weightedLength(user)} chars</span>
            <button
              type="button"
              className="btn sm ghost"
              disabled={!dirty && !savedEdited}
              onClick={onReset}
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

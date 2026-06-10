import { useEffect, useState } from 'react';
import type { PromptTemplate, PromptTemplateKey } from '../../../types';
import { extractSlotNames, SYSTEM_USER_MARKER, validateTemplate } from '../../../lib/prompt';
import { weightedLength } from '../../../lib/counting';
import { IcCheck, IcChevR, IcWarn } from '../../icons';

const TEMPLATE_LABELS: Record<PromptTemplateKey, string> = {
  reply: 'Reply',
  post: 'Post',
  chipRefine: 'Chip refine',
  moreLessRefine: 'More / less refine',
  repair: 'Repair',
  tighten: 'Tighten',
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

/** One collapsible template editor with slot badges and drift warnings. */
export function TemplateRow({
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
              template will be sent as a single user message with no system framing. Add{' '}
              <code>===USER===</code> on its own line to separate the stable instructions (above)
              from the per-call inputs (below).
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

/**
 * Prompt template engine — pure, dead-simple {{slot}} substitution.
 *
 * A template is two editable strings — a `system` body and a `user`
 * body — plus an explicit list of required slot names. The bodies map
 * one-to-one onto the Messages API's system/user roles: the boundary is
 * structural, not a marker inside a single string. `renderTemplate`
 * substitutes both; `validateTemplate` reports drift between what the
 * bodies reference and what the author declared. Drift becomes a
 * *warning* in the Prompts tab, never a crash — the user can edit
 * prompts freely and see their mistakes.
 *
 * Slot syntax: `{{slotName}}`. Names are `[A-Za-z][A-Za-z0-9_]*`.
 * Unfilled slots render as empty strings (so an optional section like
 * `{{threadContext}}` collapses cleanly when there's no parent).
 */
import type { PromptTemplate } from '../../types';

const SLOT_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * A rendered template, ready to send: `system` goes out as the system
 * message, `user` as the user message. Either may be empty (an empty
 * system is sent as a plain single-user-message call).
 */
export interface RenderedPrompt {
  system: string;
  user: string;
}

/**
 * Substitute `{{slot}}` markers in a single body string with the values
 * provided. Unknown slots render as empty string.
 */
export function fillSlots(body: string, values: Record<string, string>): string {
  return body.replace(SLOT_RE, (_match, name: string) => values[name] ?? '');
}

/**
 * Render both template bodies with the same slot values. Each side is
 * trimmed so collapsed optional sections never leave stray blank edges.
 */
export function renderTemplate(
  template: PromptTemplate,
  values: Record<string, string>,
): RenderedPrompt {
  return {
    system: fillSlots(template.system, values).trim(),
    user: fillSlots(template.user, values).trim(),
  };
}

export interface TemplateValidation {
  /** Slot names that the template's declared `slots` lists but neither
   *  body actually references. Almost always harmless — the user
   *  probably removed a section. */
  declaredButUnused: string[];
  /** Slot names found in a body but missing from the declared
   *  `slots` list. The template will still render; this just flags
   *  drift so the user notices when they invent a slot the orchestrator
   *  doesn't know how to fill. */
  usedButUndeclared: string[];
}

/** Compare declared slots against the slots referenced across BOTH bodies. */
export function validateTemplate(template: PromptTemplate): TemplateValidation {
  const usedInBody = new Set([
    ...extractSlotNames(template.system),
    ...extractSlotNames(template.user),
  ]);
  const declared = new Set(template.slots);

  const declaredButUnused = [...declared].filter((s) => !usedInBody.has(s));
  const usedButUndeclared = [...usedInBody].filter((s) => !declared.has(s));

  return { declaredButUnused, usedButUndeclared };
}

/** All `{{slot}}` names referenced in a body, de-duplicated, in body order. */
export function extractSlotNames(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  SLOT_RE.lastIndex = 0;
  while ((m = SLOT_RE.exec(body)) !== null) {
    const name = m[1];
    if (name !== undefined && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

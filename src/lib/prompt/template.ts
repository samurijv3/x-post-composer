/**
 * Prompt template engine — pure, dead-simple {{slot}} substitution.
 *
 * Templates are an editable string (the body) plus an explicit list of
 * required slot names. `renderTemplate` substitutes; `validateTemplate`
 * reports drift between what the body references and what the author
 * declared. Drift becomes a *warning* in the Prompts tab, never a
 * crash — the user can edit prompts freely and see their mistakes.
 *
 * Slot syntax: `{{slotName}}`. Names are `[A-Za-z][A-Za-z0-9_]*`.
 * Unfilled slots render as empty strings (so an optional section like
 * `{{parentSection}}` collapses cleanly when there's no parent).
 */
import type { PromptTemplate } from '../../types';

const SLOT_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Marker that, when present in a generation template's body, splits
 * the rendered prompt into a SYSTEM portion (everything above) and a
 * USER portion (everything below). The orchestrator passes them as
 * separate fields to Anthropic — the model treats system framing
 * differently from user content. (Caching of the system portion only
 * applies above a per-model minimum prefix size; see
 * `MessagesCallRequest.system` in src/api/anthropic.ts.)
 *
 * Templates without this marker fall back to "everything is a single
 * user message" — preserving backwards compatibility with any custom
 * template a user has authored.
 */
export const SYSTEM_USER_MARKER = '===USER===';

export interface SplitPrompt {
  /** Empty string when no marker is present (caller sends as a single user message). */
  system: string;
  user: string;
}

/**
 * Split a rendered prompt body at the SYSTEM_USER_MARKER. When the
 * marker is absent, returns `{ system: '', user: <whole prompt> }`.
 */
export function splitPrompt(rendered: string): SplitPrompt {
  const idx = rendered.indexOf(SYSTEM_USER_MARKER);
  if (idx === -1) return { system: '', user: rendered };
  return {
    system: rendered.slice(0, idx).trim(),
    user: rendered.slice(idx + SYSTEM_USER_MARKER.length).trim(),
  };
}

/**
 * Substitute `{{slot}}` markers in the template body with the values
 * provided. Unknown slots in the body render as empty string.
 */
export function renderTemplate(template: PromptTemplate, values: Record<string, string>): string {
  return template.body.replace(SLOT_RE, (_match, name: string) => values[name] ?? '');
}

export interface TemplateValidation {
  /** Slot names that the template's declared `slots` lists but the body
   *  does not actually reference. Almost always harmless — the user
   *  probably removed a section. */
  declaredButUnused: string[];
  /** Slot names found in the body but missing from the declared
   *  `slots` list. The template will still render; this just flags
   *  drift so the user notices when they invent a slot the orchestrator
   *  doesn't know how to fill. */
  usedButUndeclared: string[];
}

export function validateTemplate(template: PromptTemplate): TemplateValidation {
  const usedInBody = new Set(extractSlotNames(template.body));
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

/**
 * Structural exclusion detectors. Each returns the offending spans so
 * the UI can highlight them and the orchestrator can decide whether to
 * fire a repair re-prompt.
 *
 * All three are pure functions of text only; the caller decides which
 * ones to run based on `Settings.structuralRules`.
 */
import type { Span } from './types';

/** U+2014 EM DASH. We deliberately do NOT flag the en-dash (U+2013)
 *  because users sometimes use it for ranges; staying strict here keeps
 *  the rule's name honest. */
export function detectEmDash(text: string): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '—') {
      spans.push({ start: i, end: i + 1, rule: 'emDash', matchedText: '—' });
    }
  }
  return spans;
}

const SMART_QUOTE_CHARS = new Set(['‘', '’', '“', '”']);

/** Curly single + double quotes: U+2018, U+2019, U+201C, U+201D. */
export function detectSmartQuotes(text: string): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch && SMART_QUOTE_CHARS.has(ch)) {
      spans.push({ start: i, end: i + 1, rule: 'smartQuote', matchedText: ch });
    }
  }
  return spans;
}

/**
 * Three or more consecutive sentences of ≤4 words each. Returns one
 * span covering the entire run (so the UI highlights the whole
 * staccato block rather than each short sentence individually).
 */
export function detectStaccato(text: string): Span[] {
  const sentences = segmentSentences(text);
  const isShort = sentences.map((s) => {
    const words = countWords(s.text);
    return words > 0 && words <= 4;
  });

  const spans: Span[] = [];
  let runStart = -1;
  for (let i = 0; i <= isShort.length; i++) {
    const flag = i < isShort.length && isShort[i] === true;
    if (flag) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      const runLength = i - runStart;
      if (runLength >= 3) {
        const first = sentences[runStart];
        const last = sentences[i - 1];
        if (first && last) {
          spans.push({
            start: first.start,
            end: last.end,
            rule: 'staccato',
            matchedText: text.slice(first.start, last.end),
          });
        }
      }
      runStart = -1;
    }
  }
  return spans;
}

/**
 * The AI-ish label-colon construction: a sentence that OPENS with a
 * short label fragment and a colon — "The result: it worked.",
 * "The real leverage: shipping beats polish."
 *
 * Deliberately NARROW (and default-off in settings) because colons are
 * common in legitimate writing. A colon is flagged only when ALL hold:
 *   - the fragment from the sentence start to the colon is 1–4 words of
 *     letters/apostrophes only (no digits → times and ratios can never
 *     match; no commas/quotes);
 *   - the colon is followed by horizontal whitespace then a letter on
 *     the SAME line (an end-of-line colon is a list lead-in — never
 *     flagged; `://` in URLs fails this too);
 *   - the rest of the sentence after the colon contains no comma and no
 *     further colon (an inline enumeration — "Three things: a, b, c" —
 *     is a lead-in, not the construction).
 * The span covers the fragment + colon so the highlight points at the
 * label, not the clause.
 */
export function detectAiColon(text: string): Span[] {
  const spans: Span[] = [];
  const fragmentShape = /^[A-Za-z][A-Za-z'’]*(?: [A-Za-z][A-Za-z'’]*){0,3}$/;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ':') continue;

    // Followed by horizontal whitespace, then a letter, on this line.
    let j = i + 1;
    while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
    if (j === i + 1) continue; // no gap: "https://", "3:1", trailing ":"
    const after = text[j];
    if (after === undefined || !/[A-Za-z]/.test(after)) continue;

    // Fragment = sentence start → colon.
    let s = i - 1;
    while (s >= 0) {
      const ch = text[s];
      if (ch === '.' || ch === '!' || ch === '?' || ch === '\n' || ch === ':') break;
      s--;
    }
    const fragStart = s + 1;
    const fragment = text.slice(fragStart, i);
    const trimmed = fragment.trim();
    if (!fragmentShape.test(trimmed)) continue;

    // Rest of the sentence after the colon: a comma or another colon
    // reads as an enumeration lead-in, not the construction.
    let e = j;
    while (e < text.length) {
      const ch = text[e];
      if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') break;
      e++;
    }
    const clause = text.slice(j, e);
    if (clause.includes(',') || clause.includes(':')) continue;

    const start = fragStart + (fragment.length - fragment.trimStart().length);
    spans.push({ start, end: i + 1, rule: 'aiColon', matchedText: text.slice(start, i + 1) });
  }
  return spans;
}

interface Sentence {
  text: string;
  start: number;
  end: number;
}

/**
 * Walk-based sentence segmenter. Boundary: a run of `.!?` followed by
 * whitespace OR end-of-string. Pragmatic for X-style writing; not a
 * general NLP tokenizer. Edge cases like "Dr." or "3.14" can land in
 * the wrong sentence — acceptable because the worst outcome is a
 * staccato false-positive the user shrugs off.
 */
function segmentSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let sentStart = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?') {
      let j = i + 1;
      while (j < text.length) {
        const next = text[j];
        if (next === '.' || next === '!' || next === '?') {
          j++;
        } else {
          break;
        }
      }
      const after = text[j];
      if (j >= text.length || (after !== undefined && /\s/.test(after))) {
        const sliceText = text.slice(sentStart, j);
        if (sliceText.trim().length > 0) {
          out.push({ text: sliceText, start: sentStart, end: j });
        }
        let k = j;
        while (k < text.length) {
          const w = text[k];
          if (w !== undefined && /\s/.test(w)) {
            k++;
          } else {
            break;
          }
        }
        sentStart = k;
        i = k;
        continue;
      }
      i = j;
    } else {
      i++;
    }
  }
  if (sentStart < text.length) {
    const tail = text.slice(sentStart);
    if (tail.trim().length > 0) {
      out.push({ text: tail, start: sentStart, end: text.length });
    }
  }
  return out;
}

function countWords(s: string): number {
  const trimmed = s.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

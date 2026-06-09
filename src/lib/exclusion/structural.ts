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

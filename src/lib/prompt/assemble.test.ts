import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type GenerationRequest, type LibraryItem } from '../../types';
import type { Span } from '../exclusion';
import {
  assembleInitialPrompt,
  classifyIntentShape,
  composeMoreLessInstruction,
  escalateChipInstruction,
  summarizeViolations,
} from './assemble';

function item(text: string, type: LibraryItem['type'] = 'post'): LibraryItem {
  return {
    id: text,
    text,
    type,
    source: 'manual',
    authorHandle: 'me',
    authorDisplayName: null,
    authorAvatarUrl: null,
    timestamp: '2026-01-01T00:00:00Z',
    engagement: null,
    embedding: null,
    createdAt: 0,
  };
}

function span(rule: Span['rule'], entry?: string): Span {
  return { start: 0, end: 1, rule, matchedText: 'x', ...(entry === undefined ? {} : { entry }) };
}

function postRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    mode: 'post',
    bullets: 'say something nice',
    charCap: true,
    replyContext: null,
    ...overrides,
  };
}

describe('escalateChipInstruction', () => {
  it('returns the bare instruction for the first press (and below)', () => {
    expect(escalateChipInstruction('Make it shorter.', 1)).toBe('Make it shorter.');
    expect(escalateChipInstruction('Make it shorter.', 0)).toBe('Make it shorter.');
  });

  it('always keeps the base instruction verbatim at every intensity', () => {
    for (const n of [2, 3, 4, 9]) {
      expect(escalateChipInstruction('Make it warmer.', n)).toContain('Make it warmer.');
    }
  });

  it('escalates wording at presses 2 and 3', () => {
    expect(escalateChipInstruction('x', 2)).toContain('second press');
    expect(escalateChipInstruction('x', 3)).toContain('third press');
  });

  it('numbers presses 4+ and asks for maximum intensity', () => {
    expect(escalateChipInstruction('x', 4)).toContain('press #4');
    expect(escalateChipInstruction('x', 7)).toContain('press #7');
    expect(escalateChipInstruction('x', 4)).toContain('MAXIMUM intensity');
  });
});

describe('classifyIntentShape', () => {
  it('classifies two or more non-empty lines as fragments', () => {
    expect(classifyIntentShape('ship it\nno excuses')).toBe('fragments');
    expect(classifyIntentShape('one\ntwo\nthree')).toBe('fragments');
  });

  it('ignores blank lines when counting', () => {
    expect(classifyIntentShape('ship it\n\n\nno excuses')).toBe('fragments');
    expect(classifyIntentShape('just the one thought\n\n   \n')).toBe('prose');
  });

  it('classifies a single line starting with a list marker as fragments', () => {
    expect(classifyIntentShape('- the api is the product')).toBe('fragments');
    expect(classifyIntentShape('* shorter cycles win')).toBe('fragments');
    expect(classifyIntentShape('• keep the human in the loop')).toBe('fragments');
  });

  it('classifies a single plain line as prose, even with multiple sentences', () => {
    expect(classifyIntentShape('I think the real lesson here is that shipping beats polish.')).toBe(
      'prose',
    );
    expect(classifyIntentShape('Shipping beats polish. Every time. No exceptions.')).toBe('prose');
  });

  it('treats leading whitespace before a marker as still a marker', () => {
    expect(classifyIntentShape('   - indented bullet')).toBe('fragments');
  });

  it('treats empty and whitespace-only input as prose', () => {
    expect(classifyIntentShape('')).toBe('prose');
    expect(classifyIntentShape('   \n  ')).toBe('prose');
  });
});

describe('composeMoreLessInstruction', () => {
  it('composes both sides into two labelled lines', () => {
    expect(composeMoreLessInstruction('warmth', 'hedging')).toBe(
      'More of: warmth\nLess of: hedging',
    );
  });

  it('returns a single line when only one side is filled', () => {
    expect(composeMoreLessInstruction('specifics', '')).toBe('More of: specifics');
    expect(composeMoreLessInstruction('  ', 'jargon')).toBe('Less of: jargon');
  });

  it('trims each side', () => {
    expect(composeMoreLessInstruction('  bite  ', '  filler  ')).toBe(
      'More of: bite\nLess of: filler',
    );
  });

  it('returns an empty string when both sides are blank', () => {
    expect(composeMoreLessInstruction('', '   ')).toBe('');
  });
});

describe('summarizeViolations', () => {
  it('returns an empty string for no violations', () => {
    expect(summarizeViolations([])).toBe('');
  });

  it('emits one line per structural rule, regardless of span count', () => {
    const out = summarizeViolations([span('emDash'), span('emDash'), span('smartQuote')]);
    expect(out).toBe('- em dashes (use commas)\n- curly/smart quotes (use straight quotes)');
  });

  it('names the staccato rule in plain language', () => {
    expect(summarizeViolations([span('staccato')])).toBe(
      '- 3 or more consecutive sentences of 4 words or fewer',
    );
  });

  it('dedupes banlist entries and skips empty ones', () => {
    const out = summarizeViolations([
      span('doNotSay', 'delve'),
      span('doNotSay', 'delve'),
      span('doNotSay', '  tapestry  '),
      span('doNotSay', '   '),
    ]);
    expect(out).toBe('- the following words/phrases: delve, tapestry');
  });
});

describe('assembleInitialPrompt', () => {
  it('fills every slot — no unrendered {{slot}} markers survive', () => {
    const out = assembleInitialPrompt(postRequest(), DEFAULT_SETTINGS, [item('hello')]);
    expect(out).not.toMatch(/\{\{/);
  });

  it('falls back to explicit placeholders for empty style guide and bullets', () => {
    const out = assembleInitialPrompt(postRequest({ bullets: '   ' }), DEFAULT_SETTINGS, []);
    expect(out).toContain('(no style guide set — infer voice from the examples)');
    expect(out).toContain('(no bullets given)');
  });

  it('injects the trimmed style guide and bullets when present', () => {
    const settings = { ...DEFAULT_SETTINGS, styleGuide: '  dry, lowercase  ' };
    const out = assembleInitialPrompt(postRequest({ bullets: '  ship the thing  ' }), settings, []);
    expect(out).toContain('dry, lowercase');
    expect(out).toContain('ship the thing');
    expect(out).not.toContain('  ship the thing  ');
  });

  it('renders the hard 280 constraint when charCap is on, the soft cap when off', () => {
    const capped = assembleInitialPrompt(postRequest({ charCap: true }), DEFAULT_SETTINGS, []);
    expect(capped).toContain('280');
    const soft = assembleInitialPrompt(
      postRequest({ charCap: false }),
      { ...DEFAULT_SETTINGS, softCapChars: 700 },
      [],
    );
    expect(soft).toContain('700');
  });

  it('numbers the sampled examples into the prompt', () => {
    const out = assembleInitialPrompt(postRequest(), DEFAULT_SETTINGS, [
      item('first example'),
      item('second example'),
    ]);
    expect(out).toContain('1) first example');
    expect(out).toContain('2) second example');
  });

  it('reply mode includes the target tweet and collapses the parent section when absent', () => {
    const out = assembleInitialPrompt(
      postRequest({
        mode: 'reply',
        replyContext: {
          targetText: 'the tweet being answered',
          targetAuthorHandle: null,
          targetAuthorDisplayName: null,
          targetAuthorAvatarUrl: null,
          targetTimestamp: null,
          targetStatusId: null,
          grandparentText: null,
          hadUnreadableMedia: false,
        },
      }),
      DEFAULT_SETTINGS,
      [],
    );
    expect(out).toContain('the tweet being answered');
    expect(out).not.toContain('WHICH WAS A REPLY TO');
    expect(out).not.toMatch(/\{\{/);
  });

  it('reply mode renders the grandparent under its own heading when present', () => {
    const out = assembleInitialPrompt(
      postRequest({
        mode: 'reply',
        replyContext: {
          targetText: 'target',
          targetAuthorHandle: null,
          targetAuthorDisplayName: null,
          targetAuthorAvatarUrl: null,
          targetTimestamp: null,
          targetStatusId: null,
          grandparentText: 'thread opener',
          hadUnreadableMedia: false,
        },
      }),
      DEFAULT_SETTINGS,
      [],
    );
    expect(out).toContain('WHICH WAS A REPLY TO');
    expect(out).toContain('thread opener');
  });

  it('reply mode survives a missing reply context with a placeholder', () => {
    const out = assembleInitialPrompt(
      postRequest({ mode: 'reply', replyContext: null }),
      DEFAULT_SETTINGS,
      [],
    );
    expect(out).toContain('(no target captured)');
  });
});

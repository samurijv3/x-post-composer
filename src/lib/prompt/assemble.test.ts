import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type GenerationRequest, type LibraryItem } from '../../types';
import type { Span } from '../exclusion';
import {
  assembleInitialPrompt,
  assembleRefinePrompt,
  classifyIntentShape,
  escalateChipInstruction,
  summarizeViolations,
  type ExamplePools,
} from './assemble';

function pools(voice: LibraryItem[] = [], aspirational: LibraryItem[] = []): ExamplePools {
  return { voice, aspirational };
}

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
    favorite: false,
    segments: null,
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

  it('names the label-colon construction', () => {
    expect(summarizeViolations([span('aiColon')])).toBe(
      '- the label-colon construction ("The result: \u2026") \u2014 rewrite as full sentences',
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
  it('fills every slot — no unrendered {{slot}} markers survive in either body', () => {
    const out = assembleInitialPrompt(postRequest(), DEFAULT_SETTINGS, pools([item('hello')]));
    expect(out.system).not.toMatch(/\{\{/);
    expect(out.user).not.toMatch(/\{\{/);
  });

  it('places stable framing in system and per-call content in user', () => {
    const settings = { ...DEFAULT_SETTINGS, styleGuide: 'dry, lowercase' };
    const out = assembleInitialPrompt(
      postRequest({ bullets: 'ship the thing' }),
      settings,
      pools([item('a voice example')]),
    );
    // System: role + precedence + style guide + exclusions, nothing per-call.
    expect(out.system).toContain('order of authority');
    expect(out.system).toContain('dry, lowercase');
    expect(out.system).toContain('em dashes');
    expect(out.system).not.toContain('ship the thing');
    expect(out.system).not.toContain('a voice example');
    // User: examples + length + intent, no stable framing.
    expect(out.user).toContain('a voice example');
    expect(out.user).toContain('ship the thing');
    expect(out.user).not.toContain('dry, lowercase');
    expect(out.user).not.toContain('order of authority');
  });

  it('falls back to explicit placeholders for empty style guide and bullets', () => {
    const out = assembleInitialPrompt(postRequest({ bullets: '   ' }), DEFAULT_SETTINGS, pools());
    expect(out.system).toContain('(no style guide set — infer voice from the examples)');
    expect(out.user).toContain('(no bullets given)');
  });

  it('injects the trimmed style guide and bullets when present', () => {
    const settings = { ...DEFAULT_SETTINGS, styleGuide: '  dry, lowercase  ' };
    const out = assembleInitialPrompt(
      postRequest({ bullets: '  ship the thing  ' }),
      settings,
      pools(),
    );
    expect(out.system).toContain('dry, lowercase');
    expect(out.user).toContain('ship the thing');
    expect(out.user).not.toContain('  ship the thing  ');
  });

  it('renders the hard 280 constraint when charCap is on, the soft cap when off', () => {
    const capped = assembleInitialPrompt(postRequest({ charCap: true }), DEFAULT_SETTINGS, pools());
    expect(capped.user).toContain('280');
    const soft = assembleInitialPrompt(
      postRequest({ charCap: false }),
      { ...DEFAULT_SETTINGS, softCapChars: 700 },
      pools(),
    );
    expect(soft.user).toContain('700');
  });

  it('numbers the sampled voice examples into the user body', () => {
    const out = assembleInitialPrompt(
      postRequest(),
      DEFAULT_SETTINGS,
      pools([item('first example'), item('second example')]),
    );
    expect(out.user).toContain('1) first example');
    expect(out.user).toContain('2) second example');
  });

  it('collapses the aspirational block when the pool is empty, renders it when filled', () => {
    const empty = assembleInitialPrompt(postRequest(), DEFAULT_SETTINGS, pools([item('voice')]));
    expect(empty.user).not.toContain('<aspirational_examples>');
    const filled = assembleInitialPrompt(
      postRequest(),
      DEFAULT_SETTINGS,
      pools([item('voice')], [item('my best work')]),
    );
    expect(filled.user).toContain('<aspirational_examples>');
    expect(filled.user).toContain('my best work');
  });

  it('a bulleted input forces fragments framing — the panel signal beats the heuristic', () => {
    // Single line of plain prose would classify as prose; the explicit
    // bullet-mode flag overrides.
    const out = assembleInitialPrompt(
      postRequest({ bullets: 'one developed thought written as prose.', bulletedInput: true }),
      DEFAULT_SETTINGS,
      pools(),
    );
    expect(out.user).toContain('Find the throughline');
  });

  it('chooses the intent framing from the bullet shape', () => {
    const fragments = assembleInitialPrompt(
      postRequest({ bullets: 'one thought\nanother thought' }),
      DEFAULT_SETTINGS,
      pools(),
    );
    expect(fragments.user).toContain('Find the throughline');
    const prose = assembleInitialPrompt(
      postRequest({ bullets: 'A full direction to develop, written out as a sentence.' }),
      DEFAULT_SETTINGS,
      pools(),
    );
    expect(prose.user).toContain('a direction to develop and tighten');
  });

  it('reply mode includes the target tweet and collapses thread context when absent', () => {
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
      pools(),
    );
    expect(out.user).toContain('the tweet being answered');
    expect(out.user).toContain('<reply_context>');
    expect(out.user).not.toContain('<thread_context>');
    expect(out.user).not.toMatch(/\{\{/);
  });

  it('reply mode renders the grandparent inside thread_context when present', () => {
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
      pools(),
    );
    expect(out.user).toContain('<thread_context>');
    expect(out.user).toContain('thread opener');
  });

  it('reply mode survives a missing reply context with a placeholder', () => {
    const out = assembleInitialPrompt(
      postRequest({ mode: 'reply', replyContext: null }),
      DEFAULT_SETTINGS,
      pools(),
    );
    expect(out.user).toContain('(no target captured)');
  });
});

describe('assembleRefinePrompt', () => {
  it('anchors every refinement to the voice: style guide + exclusions in system', () => {
    // Regression guard for the v1 behavior where refine/repair/tighten
    // calls carried only the draft + instruction and were voice-blind.
    const settings = { ...DEFAULT_SETTINGS, styleGuide: 'dry, lowercase' };
    const out = assembleRefinePrompt(settings, 'previous draft text', 'Make it shorter.');
    expect(out.system).toContain('dry, lowercase');
    expect(out.system).toContain('em dashes');
    expect(out.system).toContain('order of authority');
  });

  it('places the draft and instruction in the user body, nothing per-call in system', () => {
    const out = assembleRefinePrompt(DEFAULT_SETTINGS, 'previous draft text', 'Make it warmer.');
    expect(out.user).toContain('previous draft text');
    expect(out.user).toContain('Make it warmer.');
    expect(out.system).not.toContain('previous draft text');
    expect(out.system).not.toContain('Make it warmer.');
    expect(out.system).not.toMatch(/\{\{/);
    expect(out.user).not.toMatch(/\{\{/);
  });

  it('uses a refine-appropriate placeholder when no style guide is set', () => {
    const out = assembleRefinePrompt(DEFAULT_SETTINGS, 'draft', 'instruction');
    expect(out.system).toContain("preserve the draft's existing voice");
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type LibraryItem, type PromptTemplateKey } from '../../types';
import {
  buildAspirationalBlock,
  buildCharConstraintInstruction,
  buildCountNudgeLine,
  buildExclusionInstructions,
  buildRepackInstruction,
  buildRepairInstruction,
  buildThreadConstraintInstruction,
  buildThreadContextBlock,
  buildThreadExamplesBlock,
  buildTightenSegmentsInstruction,
  DEFAULT_PROMPT_TEMPLATES,
  formatExamples,
  GENERATION_PRECEDENCE,
  REFINE_PRECEDENCE,
  THREAD_FORMAT_REMINDER,
  THREAD_PRECEDENCE,
  THREAD_REFIT_INSTRUCTION,
  TIGHTEN_INSTRUCTION,
} from './defaults';
import { extractSlotNames, validateTemplate } from './template';

describe('DEFAULT_PROMPT_TEMPLATES', () => {
  const keys = Object.keys(DEFAULT_PROMPT_TEMPLATES) as PromptTemplateKey[];

  it('is the exact object DEFAULT_SETTINGS uses — no second copy', () => {
    expect(DEFAULT_SETTINGS.promptTemplates).toBe(DEFAULT_PROMPT_TEMPLATES);
  });

  it('has exactly the four template keys', () => {
    expect(keys.sort()).toEqual(['post', 'refine', 'reply', 'thread']);
  });

  it.each(keys)('"%s" has no drift between declared slots and bodies', (key) => {
    const v = validateTemplate(DEFAULT_PROMPT_TEMPLATES[key]);
    expect(v.declaredButUnused).toEqual([]);
    expect(v.usedButUndeclared).toEqual([]);
  });

  // The role boundary is the load-bearing invariant of the v2 reshape:
  // invariant framing lives in the system body, per-call content in the
  // user body. A per-call slot leaking into system would break the
  // "system block is stable between consecutive calls" property (and
  // with it, the future caching option).
  const PER_CALL_SLOTS = [
    'bullets',
    'voiceExamples',
    'aspirationalExamples',
    'threadExamples',
    'length',
    'intentFraming',
    'targetText',
    'threadContext',
    'draft',
    'instruction',
  ];
  const STABLE_SLOTS = ['precedence', 'styleGuide', 'exclusions'];

  it.each(keys)('"%s" keeps per-call slots out of the system body', (key) => {
    const systemSlots = extractSlotNames(DEFAULT_PROMPT_TEMPLATES[key].system);
    for (const slot of PER_CALL_SLOTS) {
      expect(systemSlots).not.toContain(slot);
    }
  });

  it.each(keys)('"%s" keeps stable framing slots out of the user body', (key) => {
    const userSlots = extractSlotNames(DEFAULT_PROMPT_TEMPLATES[key].user);
    for (const slot of STABLE_SLOTS) {
      expect(userSlots).not.toContain(slot);
    }
  });

  it.each(keys)('"%s" system body carries role, precedence, style guide, exclusions', (key) => {
    const system = DEFAULT_PROMPT_TEMPLATES[key].system;
    expect(system).toContain('Output ONLY');
    expect(system).toContain('<precedence>');
    expect(system).toContain('<style_guide>');
    expect(system).toContain('<exclusions>');
  });

  it('generation user bodies carry the example, length, and intent blocks', () => {
    for (const key of ['reply', 'post', 'thread'] as const) {
      const user = DEFAULT_PROMPT_TEMPLATES[key].user;
      expect(user).toContain('{{aspirationalExamples}}');
      expect(user).toContain('<voice_examples>');
      expect(user).toContain('<length>');
      expect(user).toContain('<intent>');
    }
  });

  it('reply user body carries the reply-context block and collapsible thread context', () => {
    const user = DEFAULT_PROMPT_TEMPLATES.reply.user;
    expect(user).toContain('<reply_context>');
    expect(user).toContain('{{threadContext}}');
  });

  it('refine user body carries the draft and instruction blocks', () => {
    const user = DEFAULT_PROMPT_TEMPLATES.refine.user;
    expect(user).toContain('<draft>');
    expect(user).toContain('<instruction>');
  });

  it('precedence preambles reference the tags they rank', () => {
    expect(GENERATION_PRECEDENCE).toContain('<exclusions>');
    expect(GENERATION_PRECEDENCE).toContain('<style_guide>');
    expect(GENERATION_PRECEDENCE).toContain('<aspirational_examples>');
    expect(GENERATION_PRECEDENCE).toContain('<voice_examples>');
    expect(GENERATION_PRECEDENCE).toContain('<reply_context>');
    expect(GENERATION_PRECEDENCE).toContain('<intent>');
    expect(REFINE_PRECEDENCE).toContain('<exclusions>');
    expect(REFINE_PRECEDENCE).toContain('<style_guide>');
    expect(REFINE_PRECEDENCE).toContain('<instruction>');
    expect(REFINE_PRECEDENCE).toContain('<draft>');
  });
});

function item(text: string): LibraryItem {
  return {
    id: text,
    text,
    type: 'post',
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

describe('formatExamples', () => {
  it('numbers items starting at 1', () => {
    const out = formatExamples([item('first'), item('second')]);
    expect(out).toContain('1) first');
    expect(out).toContain('2) second');
  });

  it('cold-start returns a single explanatory line', () => {
    const out = formatExamples([]);
    expect(out).toContain('none captured');
  });
});

describe('buildAspirationalBlock', () => {
  it('returns empty string for an empty pool so the section collapses', () => {
    expect(buildAspirationalBlock([])).toBe('');
  });

  it('wraps a non-empty pool in the aspirational_examples tags', () => {
    const out = buildAspirationalBlock([item('my best work')]);
    expect(out).toContain('<aspirational_examples>');
    expect(out).toContain('1) my best work');
    expect(out).toContain('</aspirational_examples>');
  });
});

describe('buildExclusionInstructions', () => {
  it('returns one line per active structural rule + a do-not-say line', () => {
    const out = buildExclusionInstructions(DEFAULT_SETTINGS);
    expect(out).toContain('em dashes');
    expect(out).toContain('curly/smart quotes');
    expect(out).toContain('consecutive sentences');
    expect(out).toContain('Do not use these words or phrases');
  });

  it('omits lines for disabled rules', () => {
    const out = buildExclusionInstructions({
      ...DEFAULT_SETTINGS,
      structuralRules: {
        noEmDash: false,
        noSmartQuotes: false,
        noStaccato: false,
        noAiColon: false,
      },
      doNotSay: [],
    });
    expect(out).toContain('(none active)');
  });

  it('omits the do-not-say line when the list is empty', () => {
    const out = buildExclusionInstructions({ ...DEFAULT_SETTINGS, doNotSay: [] });
    expect(out).not.toContain('Do not use these words or phrases');
  });
});

describe('buildCharConstraintInstruction', () => {
  it('mentions the 280-character limit when capped', () => {
    expect(buildCharConstraintInstruction({ charCap: true, softCapChars: 1000 })).toContain('280');
  });

  it('cites the soft cap when uncapped', () => {
    expect(buildCharConstraintInstruction({ charCap: false, softCapChars: 700 })).toContain('700');
  });
});

describe('buildThreadContextBlock', () => {
  it('returns empty string when there is no grandparent', () => {
    expect(buildThreadContextBlock(null)).toBe('');
    expect(buildThreadContextBlock('   ')).toBe('');
  });

  it('wraps the parent text in the thread_context tags when present', () => {
    const out = buildThreadContextBlock('thread opener');
    expect(out).toContain('<thread_context>');
    expect(out).toContain('thread opener');
    expect(out).toContain('</thread_context>');
  });
});

describe('refine instructions (code-supplied)', () => {
  it('TIGHTEN_INSTRUCTION demands the 280 limit', () => {
    expect(TIGHTEN_INSTRUCTION).toContain('280');
  });

  it('buildRepairInstruction embeds the violation summary and asks for a rewrite', () => {
    const out = buildRepairInstruction('- em dashes (use commas)');
    expect(out).toContain('- em dashes (use commas)');
    expect(out).toContain('Rewrite');
    expect(out).toContain('keeping the same voice');
  });
});

describe('thread prompt pieces (Phase 10)', () => {
  const threadItem = (id: string, segs: string[]): LibraryItem => ({
    id,
    text: segs.join('\n---\n'),
    type: 'thread',
    source: 'manual',
    authorHandle: 'me',
    authorDisplayName: null,
    authorAvatarUrl: null,
    timestamp: '2026-01-01T00:00:00Z',
    engagement: null,
    favorite: false,
    segments: segs.map((text) => ({ text, statusId: null })),
    embedding: null,
    createdAt: 0,
  });

  it('THREAD_PRECEDENCE references the tags it ranks, incl. thread_examples', () => {
    expect(THREAD_PRECEDENCE).toContain('<thread_examples>');
    expect(THREAD_PRECEDENCE).toContain('<voice_examples>');
    expect(THREAD_PRECEDENCE).toContain('<exclusions>');
    expect(THREAD_PRECEDENCE).not.toContain('<reply_context>'); // posts-only v1
  });

  it('buildThreadExamplesBlock collapses when empty', () => {
    expect(buildThreadExamplesBlock([])).toBe('');
  });

  it('renders each thread as ONE numbered example with segment markers', () => {
    const block = buildThreadExamplesBlock([threadItem('t1', ['alpha', 'beta'])]);
    expect(block).toContain('<thread_examples>');
    expect(block).toContain('1)\n1/ alpha\n\n2/ beta');
  });

  it('falls back to the joined text when segments are null (defensive)', () => {
    const weird = { ...threadItem('t2', ['solo']), segments: null };
    expect(buildThreadExamplesBlock([weird])).toContain('1/ solo');
  });

  it('buildThreadConstraintInstruction states the soft target and the per-post cap', () => {
    const capped = buildThreadConstraintInstruction({
      charCap: true,
      softCapChars: 1000,
      targetCount: 4,
    });
    expect(capped).toContain('about 4 posts');
    expect(capped).toContain('under 280 characters');
    const soft = buildThreadConstraintInstruction({
      charCap: false,
      softCapChars: 900,
      targetCount: 6,
    });
    expect(soft).toContain('about 6 posts');
    expect(soft).toContain('900 characters per post');
  });

  it('repack holds content fixed and names the target', () => {
    const repack = buildRepackInstruction(3);
    expect(repack).toContain('fixed point');
    expect(repack).toContain('about 3 posts');
  });

  it('tighten-segments names the offenders and spares the rest', () => {
    expect(buildTightenSegmentsInstruction([2])).toContain('Post 2 is over');
    const plural = buildTightenSegmentsInstruction([2, 5]);
    expect(plural).toContain('Posts 2, 5 are over');
    expect(plural).toContain('Leave the other posts unchanged');
  });

  it('count nudge states actual and target', () => {
    expect(buildCountNudgeLine(8, 5)).toContain('8 posts');
    expect(buildCountNudgeLine(8, 5)).toContain('about 5');
  });

  it('the format reminder restates the --- convention', () => {
    expect(THREAD_FORMAT_REMINDER).toContain('---');
    expect(THREAD_FORMAT_REMINDER).toContain('no numbering');
  });
});

describe('THREAD_REFIT_INSTRUCTION', () => {
  it('holds content fixed and states the per-post cap', () => {
    expect(THREAD_REFIT_INSTRUCTION).toContain('Each post');
    expect(THREAD_REFIT_INSTRUCTION).toContain('280');
    expect(THREAD_REFIT_INSTRUCTION).toContain('keep its content, voice, and intent exactly');
  });
});

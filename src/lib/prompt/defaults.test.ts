import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type LibraryItem, type PromptTemplateKey } from '../../types';
import {
  buildCharConstraintInstruction,
  buildExclusionInstructions,
  buildParentSection,
  DEFAULT_PROMPT_TEMPLATES,
  formatExamples,
} from './defaults';
import { SYSTEM_USER_MARKER, validateTemplate } from './template';

describe('DEFAULT_PROMPT_TEMPLATES', () => {
  const keys = Object.keys(DEFAULT_PROMPT_TEMPLATES) as PromptTemplateKey[];

  it('is the exact object DEFAULT_SETTINGS uses — no second copy', () => {
    expect(DEFAULT_SETTINGS.promptTemplates).toBe(DEFAULT_PROMPT_TEMPLATES);
  });

  it.each(keys)('"%s" has no drift between declared slots and body', (key) => {
    const v = validateTemplate(DEFAULT_PROMPT_TEMPLATES[key]);
    expect(v.declaredButUnused).toEqual([]);
    expect(v.usedButUndeclared).toEqual([]);
  });

  it('generation templates carry the system/user split marker', () => {
    expect(DEFAULT_PROMPT_TEMPLATES.reply.body).toContain(SYSTEM_USER_MARKER);
    expect(DEFAULT_PROMPT_TEMPLATES.post.body).toContain(SYSTEM_USER_MARKER);
  });

  it('repair/refine/tighten templates are single user messages (no marker)', () => {
    for (const key of ['repair', 'chipRefine', 'moreLessRefine', 'tighten'] as const) {
      expect(DEFAULT_PROMPT_TEMPLATES[key].body).not.toContain(SYSTEM_USER_MARKER);
    }
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
      structuralRules: { noEmDash: false, noSmartQuotes: false, noStaccato: false },
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

describe('buildParentSection', () => {
  it('returns empty string when there is no grandparent', () => {
    expect(buildParentSection(null)).toBe('');
    expect(buildParentSection('   ')).toBe('');
  });

  it('wraps the parent text in a heading when present', () => {
    expect(buildParentSection('hello')).toContain('WHICH WAS A REPLY TO');
    expect(buildParentSection('hello')).toContain('hello');
  });
});

import { describe, expect, it } from 'vitest';
import { extractSlotNames, fillSlots, renderTemplate, validateTemplate } from './template';
import type { PromptTemplate } from '../../types';

function tpl(system: string, user: string, slots: string[] = []): PromptTemplate {
  return { name: 'test', system, user, slots };
}

describe('fillSlots', () => {
  it('substitutes a single slot', () => {
    expect(fillSlots('Hello, {{name}}!', { name: 'world' })).toBe('Hello, world!');
  });

  it('substitutes multiple slots in order', () => {
    expect(fillSlots('{{a}} and {{b}}', { a: 'eggs', b: 'bacon' })).toBe('eggs and bacon');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(fillSlots('{{ name }}', { name: 'sam' })).toBe('sam');
  });

  it('renders the same slot multiple times', () => {
    expect(fillSlots('{{x}} {{x}}', { x: 'go' })).toBe('go go');
  });

  it('renders unknown slots as empty string', () => {
    expect(fillSlots('[{{missing}}]', {})).toBe('[]');
  });

  it('leaves text with no slots untouched', () => {
    expect(fillSlots('just text', { unused: 'x' })).toBe('just text');
  });
});

describe('renderTemplate', () => {
  it('renders both bodies with the same values', () => {
    const out = renderTemplate(tpl('sys: {{voice}}', 'user: {{voice}} {{ask}}'), {
      voice: 'dry',
      ask: 'reply',
    });
    expect(out.system).toBe('sys: dry');
    expect(out.user).toBe('user: dry reply');
  });

  it('trims each rendered body so collapsed sections leave no stray edges', () => {
    const out = renderTemplate(tpl('{{lead}}stable text\n', '\n{{optional}}\ncontent\n'), {
      lead: '',
      optional: '',
    });
    expect(out.system).toBe('stable text');
    expect(out.user).toBe('content');
  });

  it('returns an empty system when the system body is empty', () => {
    const out = renderTemplate(tpl('', 'hello {{x}}'), { x: 'there' });
    expect(out.system).toBe('');
    expect(out.user).toBe('hello there');
  });
});

describe('extractSlotNames', () => {
  it('returns slot names in order of first appearance, deduplicated', () => {
    expect(extractSlotNames('{{b}} {{a}} {{b}} {{c}}')).toEqual(['b', 'a', 'c']);
  });

  it('returns an empty array for slot-free bodies', () => {
    expect(extractSlotNames('hello')).toEqual([]);
  });
});

describe('validateTemplate', () => {
  it('reports no drift when declared slots match the slots used across both bodies', () => {
    const t = tpl('{{a}}', '{{b}}', ['a', 'b']);
    const v = validateTemplate(t);
    expect(v.declaredButUnused).toEqual([]);
    expect(v.usedButUndeclared).toEqual([]);
  });

  it('counts a slot as used no matter which body references it', () => {
    const systemOnly = tpl('{{a}}', 'plain', ['a']);
    expect(validateTemplate(systemOnly).declaredButUnused).toEqual([]);
    const userOnly = tpl('plain', '{{a}}', ['a']);
    expect(validateTemplate(userOnly).declaredButUnused).toEqual([]);
  });

  it('reports declaredButUnused when a slot was removed from both bodies', () => {
    const t = tpl('{{a}}', 'plain', ['a', 'b']);
    expect(validateTemplate(t).declaredButUnused).toEqual(['b']);
  });

  it('reports usedButUndeclared when either body invents a slot', () => {
    const t = tpl('{{a}} {{surprise}}', '{{alsoNew}}', ['a']);
    expect(validateTemplate(t).usedButUndeclared).toEqual(['surprise', 'alsoNew']);
  });

  it('reports both kinds of drift at once', () => {
    const t = tpl('{{a}}', '{{c}}', ['a', 'b']);
    const v = validateTemplate(t);
    expect(v.declaredButUnused).toEqual(['b']);
    expect(v.usedButUndeclared).toEqual(['c']);
  });
});

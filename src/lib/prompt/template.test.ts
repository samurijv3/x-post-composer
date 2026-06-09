import { describe, expect, it } from 'vitest';
import { extractSlotNames, renderTemplate, validateTemplate } from './template';
import type { PromptTemplate } from '../../types';

function tpl(body: string, slots: string[] = []): PromptTemplate {
  return { name: 'test', body, slots };
}

describe('renderTemplate', () => {
  it('substitutes a single slot', () => {
    expect(renderTemplate(tpl('Hello, {{name}}!'), { name: 'world' })).toBe('Hello, world!');
  });

  it('substitutes multiple slots in order', () => {
    expect(
      renderTemplate(tpl('{{a}} and {{b}}'), { a: 'eggs', b: 'bacon' }),
    ).toBe('eggs and bacon');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate(tpl('{{ name }}'), { name: 'sam' })).toBe('sam');
  });

  it('renders the same slot multiple times', () => {
    expect(renderTemplate(tpl('{{x}} {{x}}'), { x: 'go' })).toBe('go go');
  });

  it('renders unknown slots as empty string', () => {
    expect(renderTemplate(tpl('[{{missing}}]'), {})).toBe('[]');
  });

  it('leaves text with no slots untouched', () => {
    expect(renderTemplate(tpl('just text'), { unused: 'x' })).toBe('just text');
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
  it('reports no drift when declared slots match body slots exactly', () => {
    const t = tpl('{{a}} {{b}}', ['a', 'b']);
    const v = validateTemplate(t);
    expect(v.declaredButUnused).toEqual([]);
    expect(v.usedButUndeclared).toEqual([]);
  });

  it('reports declaredButUnused when a slot was removed from the body', () => {
    const t = tpl('{{a}}', ['a', 'b']);
    expect(validateTemplate(t).declaredButUnused).toEqual(['b']);
  });

  it('reports usedButUndeclared when the body invents a slot', () => {
    const t = tpl('{{a}} {{surprise}}', ['a']);
    expect(validateTemplate(t).usedButUndeclared).toEqual(['surprise']);
  });

  it('reports both kinds of drift at once', () => {
    const t = tpl('{{a}} {{c}}', ['a', 'b']);
    const v = validateTemplate(t);
    expect(v.declaredButUnused).toEqual(['b']);
    expect(v.usedButUndeclared).toEqual(['c']);
  });
});

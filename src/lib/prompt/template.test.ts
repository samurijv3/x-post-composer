import { describe, expect, it } from 'vitest';
import { extractSlotNames, renderTemplate, splitPrompt, SYSTEM_USER_MARKER, validateTemplate } from './template';
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

describe('splitPrompt', () => {
  it('returns the whole prompt as user when no marker is present', () => {
    const result = splitPrompt('hello world');
    expect(result.system).toBe('');
    expect(result.user).toBe('hello world');
  });

  it('splits at the marker, trimming whitespace from each side', () => {
    const body = `you are an assistant.\n\n${SYSTEM_USER_MARKER}\n\nthe user wants to say hi.`;
    const result = splitPrompt(body);
    expect(result.system).toBe('you are an assistant.');
    expect(result.user).toBe('the user wants to say hi.');
  });

  it('uses the FIRST marker if multiple are present', () => {
    const body = `A\n${SYSTEM_USER_MARKER}\nB\n${SYSTEM_USER_MARKER}\nC`;
    const result = splitPrompt(body);
    expect(result.system).toBe('A');
    expect(result.user).toBe(`B\n${SYSTEM_USER_MARKER}\nC`);
  });

  it('returns empty system when the marker is at the very start', () => {
    const result = splitPrompt(`${SYSTEM_USER_MARKER}\nuser content`);
    expect(result.system).toBe('');
    expect(result.user).toBe('user content');
  });

  it('returns empty user when the marker is at the very end', () => {
    const result = splitPrompt(`system content\n${SYSTEM_USER_MARKER}`);
    expect(result.system).toBe('system content');
    expect(result.user).toBe('');
  });
});

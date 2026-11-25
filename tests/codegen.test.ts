import { describe, expect, it } from 'vitest';
import { generateClientCode } from '../src/codegen.js';
import { defineMutation, defineQuery, type FunctionRegistry } from '../src/functions/index.js';
import { normalizeSchema } from '../src/schema.js';

describe('Client SDK codegen', () => {
  it('emits typed row interfaces, function callers, and SSE subscribers', () => {
    const schema = normalizeSchema({
      notes: { title: 'string', body: 'string | null', pinned: 'boolean', tags: 'string[] | null' },
    });
    const fns: FunctionRegistry = new Map([
      ['notes/list', defineQuery({ handler: () => [] })],
      ['notes/create', defineMutation({ handler: () => ({}) })],
    ]);

    const code = generateClientCode(schema, fns);
    expect(code).toContain('export interface NotesRow');
    expect(code).toContain('body: string | null;');
    expect(code).toContain('tags: string[] | null;');
    expect(code).toContain('notes: {');
    expect(code).toContain('list: <T = unknown>');
    expect(code).toContain('subscribeList: <T = unknown>');
    expect(code).toContain('create: <T = unknown>');
    expect(code).not.toContain('subscribeCreate');
  });
});

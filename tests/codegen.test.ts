import { describe, expect, it } from 'vitest';
import { generateClientCode } from '../src/services/codegen.js';
import {
  defineCommand,
  type CommandRegistry,
} from '../src/commands/index.js';
import { defineLens, defineLenses } from '../src/db/lenses.js';
import { normalizeSchema } from '../src/db/schema.js';

describe('Client SDK codegen', () => {
  it('emits typed row interfaces, command callers, and lens subscribers', () => {
    const schema = normalizeSchema({
      notes: {
        title: 'string',
        body: 'string | null',
        pinned: 'boolean',
        tags: 'string[] | null',
      },
    });
    const commands: CommandRegistry = new Map([
      ['notes/create', defineCommand({ handler: () => ({}) })],
    ]);
    const lenses = defineLenses({
      userNotes: defineLens({ table: 'notes' }),
    });

    const code = generateClientCode(schema, commands, lenses);
    expect(code).toContain('export interface NotesRow');
    expect(code).toContain('body: string | null;');
    expect(code).toContain('tags: string[] | null;');
    expect(code).toContain('notes: {');
    expect(code).toContain('create: <T = unknown>');
    expect(code).toContain('runCommand<T>("notes/create"');
    expect(code).toContain('lenses: {');
    expect(code).toContain('userNotes: {');
    expect(code).toContain('pullLens<T>("userNotes"');
    expect(code).toContain('snapshotLens<T>("userNotes"');
    expect(code).toContain('subscribeLens<T>("userNotes"');
  });
});

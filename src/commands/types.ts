export class CommandError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Domain-level rejection returned to clients so optimistic outbox intents roll back cleanly. */
export class CommandRejection extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export interface CommandAuth {
  isAdmin: boolean;
  userId?: string;
}

export interface ListOptions {
  where?: Record<string, unknown>;
  orderBy?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export interface CommandDb {
  get(table: string, id: string): Promise<Record<string, any> | null>;
  list(table: string, opts?: ListOptions): Promise<Record<string, any>[]>;
  sql<T = Record<string, any>>(query: string, params?: unknown[]): Promise<T[]>;
  insert(
    table: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, any>>;
  patch(
    table: string,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, any> | null>;
  remove(table: string, id: string): Promise<boolean>;
}

export interface EmittedOutboxEvent {
  topic: string;
  payload: unknown;
}

export interface CommandContext {
  db: CommandDb;
  auth: CommandAuth;
  /** Enqueues a domain event to be emitted after the command transaction commits. */
  emit(topic: string, payload: unknown): void;
}

export type ArgValidator<TArgs> = (raw: Record<string, unknown>) => TArgs;

export interface CommandDef<TArgs = Record<string, unknown>, TRes = unknown> {
  __kind: 'command';
  args?: ArgValidator<TArgs>;
  isolation?: 'serializable' | 'default';
  maxRetries?: number;
  handler: (ctx: CommandContext, args: TArgs) => Promise<TRes> | TRes;
}

export type CommandRegistry = Map<string, CommandDef<any, any>>;

/** Defines a transactional domain command for local-first intent execution. */
export function defineCommand<TArgs = Record<string, unknown>, TRes = unknown>(def: {
  args?: ArgValidator<TArgs>;
  isolation?: 'serializable' | 'default';
  maxRetries?: number;
  handler: (ctx: CommandContext, args: TArgs) => Promise<TRes> | TRes;
}): CommandDef<TArgs, TRes> {
  return { __kind: 'command', ...def };
}

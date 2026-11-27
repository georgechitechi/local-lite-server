export type FunctionKind = 'query' | 'mutation' | 'action';

export class FunctionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface FunctionAuth {
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

export interface DbReader {
  get(table: string, id: string): Promise<Record<string, any> | null>;
  list(table: string, opts?: ListOptions): Promise<Record<string, any>[]>;
  sql<T = Record<string, any>>(
    query: string,
    params?: unknown[],
    touchesTables?: string[],
  ): Promise<T[]>;
}

export interface DbWriter extends DbReader {
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

export interface QueryContext {
  db: DbReader;
  auth: FunctionAuth;
}

export interface MutationContext {
  db: DbWriter;
  auth: FunctionAuth;
}

export interface ActionContext {
  auth: FunctionAuth;
  runQuery<T = unknown>(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
  runMutation<T = unknown>(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
}

export type ArgValidator<TArgs> = (raw: Record<string, unknown>) => TArgs;

export interface FunctionDef<TCtx, TArgs, TRes> {
  __kind: FunctionKind;
  args?: ArgValidator<TArgs>;
  handler: (ctx: TCtx, args: TArgs) => Promise<TRes> | TRes;
}

export type FunctionRegistry = Map<string, FunctionDef<any, any, any>>;

export function defineQuery<
  TArgs = Record<string, unknown>,
  TRes = unknown,
>(def: {
  args?: ArgValidator<TArgs>;
  handler: (ctx: QueryContext, args: TArgs) => Promise<TRes> | TRes;
}): FunctionDef<QueryContext, TArgs, TRes> {
  return { __kind: 'query', ...def };
}

export function defineMutation<
  TArgs = Record<string, unknown>,
  TRes = unknown,
>(def: {
  args?: ArgValidator<TArgs>;
  handler: (ctx: MutationContext, args: TArgs) => Promise<TRes> | TRes;
}): FunctionDef<MutationContext, TArgs, TRes> {
  return { __kind: 'mutation', ...def };
}

export function defineAction<
  TArgs = Record<string, unknown>,
  TRes = unknown,
>(def: {
  args?: ArgValidator<TArgs>;
  handler: (ctx: ActionContext, args: TArgs) => Promise<TRes> | TRes;
}): FunctionDef<ActionContext, TArgs, TRes> {
  return { __kind: 'action', ...def };
}

import { quoteIdent, type SqlExecutor } from 'local-lite/server';

/** Idempotently creates an index across MySQL and Postgres. */
export async function ensureIndex(
  db: SqlExecutor,
  table: string,
  indexName: string,
  columns: string[],
): Promise<void> {
  const q = (n: string) => quoteIdent(n, db.dialect);
  const colsSql = columns.map((c) => q(c)).join(', ');
  if (db.dialect === 'postgres') {
    await db.execute(
      `CREATE INDEX IF NOT EXISTS ${q(indexName)} ON ${q(table)} (${colsSql})`,
    );
    return;
  }
  const existing = await db.query<any>(
    `SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [table, indexName],
  );
  if (!existing.length) {
    await db.execute(`CREATE INDEX ${q(indexName)} ON ${q(table)} (${colsSql})`);
  }
}

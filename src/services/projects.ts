import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { quoteIdent, type SqlExecutor } from 'local-lite/server';
import {
  buildSqlTargetSchema,
  generateSqlDiff,
  type SqlSchemaState,
} from 'local-lite/schema/migrations';
import { defineRules, type RulesDictionary } from '../db/rules.js';
import { normalizeSchema, type SchemaDictionary } from '../db/schema.js';
import { fromDbRow } from '../db/tableStorage.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;

export interface ProjectRecord {
  id: string;
  slug: string;
  name: string;
  ownerUserId: string | null;
  schema: SchemaDictionary;
  rules: RulesDictionary;
  rulesRaw: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export function projectTablePrefix(projectId: string): string {
  const short = projectId.replace(/^prj_/, '').replace(/[^a-z0-9]/gi, '').slice(0, 8);
  return `p_${short}_`;
}

export function toPhysicalTable(projectId: string | null | undefined, logicalTable: string): string {
  if (!projectId) return logicalTable;
  return `${projectTablePrefix(projectId)}${logicalTable}`;
}

export function projectScope(project?: { id: string } | null) {
  const projectId = project?.id ?? null;
  return {
    projectId,
    where: projectId ? 'project_id = ?' : 'project_id IS NULL',
    params: (projectId ? [projectId] : []) as unknown[],
    key: (name: string) => (projectId ? `${projectId}:${name}` : name),
    unkey: (raw: string) =>
      projectId && raw.startsWith(`${projectId}:`) ? raw.slice(projectId.length + 1) : raw,
  };
}

function parseJsonOr<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toProjectRecord(row: any): ProjectRecord {
  const rawSchema = parseJsonOr<SchemaDictionary>(row.schema_json, {});
  const rawRules = parseJsonOr<Record<string, any>>(row.rules_json, {});
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    ownerUserId: row.owner_user_id ?? null,
    schema: Object.keys(rawSchema).length ? normalizeSchema(rawSchema) : {},
    rules: Object.keys(rawRules).length ? defineRules(rawRules) : {},
    rulesRaw: rawRules,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function createProjectService(db: SqlExecutor, opts?: { maxProjectsPerUser?: number; uploadDir?: string }) {
  const q = (n: string) => quoteIdent(n, db.dialect);
  const cache = new Map<string, ProjectRecord>();
  const cachePut = (p: ProjectRecord) => {
    cache.set(p.id, p);
    cache.set(p.slug, p);
    return p;
  };
  const cacheEvict = (p: ProjectRecord | null | undefined) => {
    if (!p) return;
    cache.delete(p.id);
    cache.delete(p.slug);
  };

  return {
    async listProjects(ownerUserId?: string): Promise<ProjectRecord[]> {
      const rows = ownerUserId
        ? await db.query<any>(
            'SELECT * FROM _lls_projects WHERE owner_user_id = ? ORDER BY created_at DESC',
            [ownerUserId],
          )
        : await db.query<any>('SELECT * FROM _lls_projects ORDER BY created_at DESC');
      return rows.map((r) => cachePut(toProjectRecord(r)));
    },

    async getProject(idOrSlug: string): Promise<ProjectRecord | null> {
      const cached = cache.get(idOrSlug);
      if (cached) return cached;
      const rows = await db.query<any>(
        'SELECT * FROM _lls_projects WHERE id = ? OR slug = ? LIMIT 1',
        [idOrSlug, idOrSlug],
      );
      return rows[0] ? cachePut(toProjectRecord(rows[0])) : null;
    },

    async createProject(input: {
      name: string;
      slug?: string;
      ownerUserId?: string | null;
      schema?: SchemaDictionary;
      rules?: Record<string, any>;
    }): Promise<ProjectRecord> {
      const name = String(input.name ?? '').trim();
      if (!name || name.length > 128) {
        throw new Error('Project name is required (max 128 chars).');
      }
      if (input.ownerUserId && opts?.maxProjectsPerUser) {
        const owned = await this.listProjects(input.ownerUserId);
        if (owned.length >= opts.maxProjectsPerUser) {
          throw new Error(`Project limit reached (max ${opts.maxProjectsPerUser} per user).`);
        }
      }
      const slug = (
        input.slug?.trim() ||
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      ).toLowerCase();
      if (!SLUG_RE.test(slug)) {
        throw new Error('Project slug must be 2–49 lowercase letters, digits, or hyphens.');
      }

      const existing = await db.query<any>('SELECT id FROM _lls_projects WHERE slug = ? LIMIT 1', [slug]);
      if (existing[0]) {
        throw new Error(`Project slug "${slug}" is already taken.`);
      }

      const id = `prj_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const now = Date.now();
      const schema = input.schema && Object.keys(input.schema).length ? normalizeSchema(input.schema) : {};
      const rulesInput = input.rules && Object.keys(input.rules).length ? input.rules : {};
      if (Object.keys(rulesInput).length) defineRules(rulesInput);

      await db.execute(
        `INSERT INTO _lls_projects
         (id, slug, name, owner_user_id, schema_json, schema_state_json, rules_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          id,
          slug,
          name,
          input.ownerUserId ?? null,
          Object.keys(schema).length ? JSON.stringify(schema) : null,
          Object.keys(rulesInput).length ? JSON.stringify(rulesInput) : null,
          now,
          now,
        ],
      );

      if (Object.keys(schema).length) {
        await this.applyProjectSchema(id, schema, rulesInput);
      }

      return (await this.getProject(id))!;
    },

    async applyProjectSchema(
      projectId: string,
      schemaInput: SchemaDictionary,
      rulesInput?: Record<string, any>,
    ): Promise<{ applied: number; warnings: string[]; project: ProjectRecord }> {
      const rows = await db.query<any>('SELECT * FROM _lls_projects WHERE id = ? LIMIT 1', [projectId]);
      const row = rows[0];
      if (!row) throw new Error('Project not found.');

      const schema = normalizeSchema(schemaInput);
      const physicalDict: SchemaDictionary = {};
      for (const [logical, fields] of Object.entries(schema)) {
        physicalDict[toPhysicalTable(projectId, logical)] = fields;
      }

      const prev = parseJsonOr<SqlSchemaState | null>(row.schema_state_json, null);
      const next = buildSqlTargetSchema(physicalDict, [], { dialect: db.dialect });
      const diff = generateSqlDiff(prev, next, db.dialect);
      const stmts =
        db.dialect === 'mysql'
          ? diff.up.map((stmt) => {
              if (!/^\s*CREATE TABLE/i.test(stmt) || /COLLATE=/i.test(stmt)) return stmt;
              if (/CHARSET=utf8mb4/i.test(stmt)) {
                return stmt.replace(/CHARSET=utf8mb4/gi, 'CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci');
              }
              return `${stmt} ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`;
            })
          : diff.up;

      for (const stmt of stmts) await db.execute(stmt);

      let nextRulesJson = row.rules_json as string | null;
      if (rulesInput !== undefined) {
        defineRules(rulesInput);
        nextRulesJson = Object.keys(rulesInput).length ? JSON.stringify(rulesInput) : null;
      }

      await db.execute(
        'UPDATE _lls_projects SET schema_json = ?, schema_state_json = ?, rules_json = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(schema), JSON.stringify(next), nextRulesJson, Date.now(), projectId],
      );
      cacheEvict(cache.get(projectId));

      return {
        applied: stmts.length,
        warnings: diff.warnings,
        project: (await this.getProject(projectId))!,
      };
    },

    async exportProject(projectId: string): Promise<{
      project: { id: string; slug: string; name: string; schema: SchemaDictionary };
      exportedAt: number;
      tables: Record<string, unknown[]>;
    } | null> {
      const project = await this.getProject(projectId);
      if (!project) return null;
      const tables: Record<string, unknown[]> = {};
      for (const [logical, fields] of Object.entries(project.schema)) {
        const rows = await db.query<Record<string, any>>(
          `SELECT * FROM ${q(toPhysicalTable(project.id, logical))}`,
        );
        tables[logical] = rows.map((r) => ({ id: String(r.id), ...fromDbRow(fields, r) }));
      }
      return {
        project: { id: project.id, slug: project.slug, name: project.name, schema: project.schema },
        exportedAt: Date.now(),
        tables,
      };
    },

    async deleteProject(projectId: string): Promise<boolean> {
      const project = await this.getProject(projectId);
      if (!project) return false;
      cacheEvict(project);

      for (const logical of Object.keys(project.schema)) {
        const phys = toPhysicalTable(project.id, logical);
        await db.execute(`DROP TABLE IF EXISTS ${q(phys)}`);
      }
      for (const t of [
        '_local_auth_accounts',
        '_local_auth_reset_otps',
        '_lls_api_keys',
        '_lls_storage_buckets',
        '_lls_storage_files',
        '_lls_env_vars',
        '_lls_backups',
        '_lls_crons',
        '_server_changes',
      ]) {
        await db.execute(`DELETE FROM ${q(t)} WHERE project_id = ?`, [project.id]);
      }
      if (opts?.uploadDir) {
        const dir = path.join(opts.uploadDir, 'projects', project.id);
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      }
      await db.execute('DELETE FROM _lls_projects WHERE id = ?', [project.id]);
      return true;
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;

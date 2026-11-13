import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_IN_RULESETS, sanitizeRules } from '../shared/presets';
import type { RuleSet } from '../shared/types';
import { Table, type TableSnapshot } from './table';

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const TABLE_DIR = join(DATA_DIR, 'tables');
const RULES_FILE = join(DATA_DIR, 'rulesets.json');
const MAX_IDLE_MS = Number(process.env.TABLE_TTL_DAYS ?? 14) * 86400000;

mkdirSync(TABLE_DIR, { recursive: true });

function atomicWrite(file: string, data: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/* ---------------- tables ---------------- */

const pending = new Map<string, NodeJS.Timeout>();

export function saveTable(t: Table, immediate = false) {
  const write = () => {
    pending.delete(t.id);
    try {
      atomicWrite(join(TABLE_DIR, `${t.id}.json`), JSON.stringify(t.snapshot()));
    } catch (e) {
      console.error(`[store] could not save table ${t.id}:`, e);
    }
  };
  const existing = pending.get(t.id);
  if (existing) clearTimeout(existing);
  if (immediate) write();
  else pending.set(t.id, setTimeout(write, 400));
}

export function flushAll(tables: Iterable<Table>) {
  for (const t of tables) saveTable(t, true);
}

export function loadTables(): Table[] {
  const out: Table[] = [];
  for (const f of readdirSync(TABLE_DIR)) {
    if (!f.endsWith('.json')) continue;
    const file = join(TABLE_DIR, f);
    try {
      const snap = JSON.parse(readFileSync(file, 'utf8')) as TableSnapshot;
      if (Date.now() - snap.lastActive > MAX_IDLE_MS) { rmSync(file); continue; }
      out.push(Table.restore(snap));
    } catch (e) {
      console.error(`[store] skipping unreadable table file ${f}:`, e);
    }
  }
  return out;
}

export function deleteTableFile(id: string) {
  rmSync(join(TABLE_DIR, `${id}.json`), { force: true });
}

/* ---------------- rule sets ---------------- */

let custom: RuleSet[] = [];
try {
  custom = (JSON.parse(readFileSync(RULES_FILE, 'utf8')) as RuleSet[]).map((r) => sanitizeRules(r));
} catch { custom = []; }

export function listRuleSets(): RuleSet[] {
  return [...BUILT_IN_RULESETS, ...custom];
}

export function saveRuleSet(input: Partial<RuleSet>): RuleSet {
  const r = sanitizeRules(input);
  if (BUILT_IN_RULESETS.some((b) => b.id === r.id) || !r.id || r.id === 'custom') {
    r.id = `rs-${Date.now().toString(36)}`;
  }
  const i = custom.findIndex((c) => c.id === r.id);
  if (i >= 0) custom[i] = r;
  else custom.push(r);
  atomicWrite(RULES_FILE, JSON.stringify(custom, null, 2));
  return r;
}

export function deleteRuleSet(id: string) {
  custom = custom.filter((c) => c.id !== id);
  atomicWrite(RULES_FILE, JSON.stringify(custom, null, 2));
}

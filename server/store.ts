import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_IN_RULESETS, sanitizeRules } from '../shared/presets';
import { rankedResults, type SeasonNight } from '../shared/results';
import type { RuleSet } from '../shared/types';
import { Table, type TableSnapshot } from './table';

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const TABLE_DIR = join(DATA_DIR, 'tables');
const RESULTS_DIR = join(DATA_DIR, 'results');
const RULES_FILE = join(DATA_DIR, 'rulesets.json');
const MAX_IDLE_MS = Number(process.env.TABLE_TTL_DAYS ?? 14) * 86400000;

mkdirSync(TABLE_DIR, { recursive: true });
mkdirSync(RESULTS_DIR, { recursive: true });

function atomicWrite(file: string, data: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/* ---------------- season results ---------------- */

const archived = new WeakSet<Table>();

export function archiveResult(t: Table) {
  if (t.status !== 'finished' || archived.has(t)) return;
  const file = join(RESULTS_DIR, `${t.id}.json`);
  if (!existsSync(file)) {
    const view = t.view(null);
    const finishedAt = t.finishedAt ?? t.lastActive;
    const night: SeasonNight = {
      id: t.id, name: t.settings.name, finishedAt, year: new Date(finishedAt).getFullYear(),
      currency: view.results?.currency ?? null, players: rankedResults(view).map((p) => {
        const player = t.player(p.id);
        return { ...p, stats: player?.stats, rebuys: player?.rebuys ?? 0, addOn: player?.addOnTaken ?? false };
      }),
    };
    atomicWrite(file, JSON.stringify(night));
  }
  archived.add(t);
}

export function listResults(): SeasonNight[] {
  return readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8')) as SeasonNight)
    .sort((a, b) => b.finishedAt - a.finishedAt || a.id.localeCompare(b.id));
}

/* ---------------- tables ---------------- */

const pending = new Map<string, NodeJS.Timeout>();

export function saveTable(t: Table, immediate = false) {
  const write = () => {
    pending.delete(t.id);
    try {
      atomicWrite(join(TABLE_DIR, `${t.id}.json`), JSON.stringify(t.snapshot()));
      archiveResult(t);
    } catch (e) {
      console.error(`[store] could not save table ${t.id}:`, e);
    }
  };
  const existing = pending.get(t.id);
  if (existing) clearTimeout(existing);
  if (immediate || (t.status === 'finished' && !archived.has(t))) write();
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
      const expired = Date.now() - snap.lastActive > MAX_IDLE_MS;
      if (expired && snap.status !== 'finished') { rmSync(file); continue; }
      const table = Table.restore(snap);
      archiveResult(table);
      if (expired) rmSync(file);
      else out.push(table);
    } catch (e) {
      console.error(`[store] skipping unreadable table file ${f}:`, e);
    }
  }
  return out;
}

export function deleteTableFile(id: string) {
  clearTimeout(pending.get(id));
  pending.delete(id);
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

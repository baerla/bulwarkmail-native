/**
 * The headless reminder refresh runs without the app UI (CLAUDE.md): nothing
 * in its import graph may reach a screen, a component, App, or a store other
 * than settings-store and locale-store: lib/calendar-timezone reads the
 * former (the widgets' headless code loads it too), and push-background-task,
 * whose language and settings readers this reuses, already loads the latter
 * through push-notifications in every headless push run. Type-only imports
 * are erased and don't count. src/test-setup.ts mocks those modules, so an
 * impure import would not fail any other test; this one walks the graph.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../..');
const ENTRIES = ['lib/calendar-reminders-background.ts'];
const ALLOWED_STORES = new Set(['settings-store.ts', 'locale-store.ts']);
const FORBIDDEN_DIRS = ['screens', 'components', 'navigation'].map((d) => path.join(SRC, d) + path.sep);

function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:^|\n)\s*(?:import(?!\s+type\b)|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)]
    .map((m) => m[1] ?? m[2]);
}

describe('calendar reminders background import graph', () => {
  it('reaches no screen, component, navigation module or store beyond settings-store and locale-store', () => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    const queue = ENTRIES.map((e) => path.join(SRC, e));
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of importsOf(file)) {
        const target = resolve(file, spec);
        if (!target) continue;
        const inStores = target.startsWith(path.join(SRC, 'stores') + path.sep);
        if (FORBIDDEN_DIRS.some((d) => target.startsWith(d)) || (inStores && !ALLOWED_STORES.has(path.basename(target)))) {
          offenders.push(`${path.relative(SRC, file)} -> ${path.relative(SRC, target)}`);
          continue;
        }
        queue.push(target);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// qc export: one self-contained HTML playback of a run. The page folds the
// journal's fs.* events in the browser, the same as the engine does, so it
// shows the filesystem at any turn (REQ-QC-001). It never calls a model
// (REQ-QC-011).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CastFile, type Rule, resolveCast } from './cast.ts';
import type { JournalEvent } from './events.ts';
import type { Run } from './run.ts';
import { hostOf, seatsOf } from './scenario.ts';
import { describeTurn, ordOf } from './time.ts';

export interface ExportData {
  run: {
    name: string;
    scenario: string;
    description: string;
    cast: string;
    parent?: { run: string; turn: string };
  };
  turnMinutes: number;
  companies: { id: string; name: string; domain: string; host: string }[];
  seats: {
    id: string;
    name: string;
    title: string;
    role: string;
    company: string;
    host: string;
  }[];
  turns: {
    label: string;
    ord: number;
    clock: string;
    /** Actor name for each seat, in the order of `seats`. */
    actors: string[];
    events: JournalEvent[];
  }[];
  /** File content by hash, for every version that a turn wrote. */
  objects: Record<string, string>;
}

export function exportData(run: Run): ExportData {
  const cal = run.scenario.calendar;
  const seats = seatsOf(run.scenario);
  const objects: Record<string, string> = {};
  const rules: Rule[] = [];
  const turns: ExportData['turns'] = [];
  for (const label of run.turns()) {
    const ord = ordOf(label, cal);
    const events = run.readTurn(label);
    for (const e of events) {
      if (e.type === 'fs.write' && !(e.hash in objects))
        objects[e.hash] = run.objects.get(e.hash);
      if (
        (e.type === 'inject' || e.type === 'mail.send') &&
        e.hash &&
        !(e.hash in objects)
      )
        objects[e.hash] = run.objects.get(e.hash);
      if (e.type === 'cast.rule') rules.push(e.rule as Rule);
    }
    const cast: CastFile = {
      ...run.castFile,
      rules: [...run.castFile.rules, ...rules],
    };
    turns.push({
      label,
      ord,
      clock: describeTurn(label, cal),
      actors: seats.map(
        (s) =>
          resolveCast(run.models, cast, s, Math.max(ord, 1), cal).actorName,
      ),
      events,
    });
  }
  return {
    run: {
      name: run.info.name,
      scenario: run.scenario.name,
      description: run.scenario.description,
      cast: run.info.cast,
      parent: run.info.parent,
    },
    turnMinutes: run.scenario.turnMinutes,
    companies: run.scenario.companies.map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain,
      host: hostOf(c),
    })),
    seats: seats.map((s) => ({
      id: s.id,
      name: s.person.name,
      title: s.person.title,
      role: s.person.role,
      company: s.company.id,
      host: s.host,
    })),
    turns,
    objects,
  };
}

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'viewer.html');

/**
 * Render the viewer. A fragment has no doctype, html, head or body tags:
 * a host page wraps it. A full page opens straight from disk.
 */
export function exportHtml(
  run: Run,
  opts: { fragment?: boolean } = {},
): string {
  // Escape "<" so that no file content can close the data script tag.
  const json = JSON.stringify(exportData(run)).replace(/</g, '\\u003c');
  const body = readFileSync(TEMPLATE, 'utf8').replace(
    '"__QC_DATA__"',
    () => json,
  );
  if (opts.fragment) return body;
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

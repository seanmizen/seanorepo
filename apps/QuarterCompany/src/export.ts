// qc export: one self-contained HTML playback of a run. The page folds the
// journal's fs.* events in the browser, the same as the engine does, so it
// shows the filesystem at any turn (REQ-QC-001). It never calls a model
// (REQ-QC-011).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CastFile, type Rule, resolveCast } from './cast.ts';
import type { JournalEvent } from './events.ts';
import { providerOf } from './population.ts';
import type { Run } from './run.ts';
import { hostOf, seatOfMember } from './scenario.ts';
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
  orgs: { id: string; name: string; domain: string; host: string }[];
  /**
   * Populations. Their members are not staff cards: the viewer shows their
   * tool calls as one row per population and turn. See REQ-QC-023.
   */
  populations: {
    id: string;
    name: string;
    provider: string;
    domain: string;
    size: number;
  }[];
  seats: {
    id: string;
    name: string;
    title: string;
    role: string;
    org: string;
    host: string;
    /** For a consultant: the client organisation where the seat works. */
    site?: string;
    /** The ord of the turn when the person joined, and left. */
    joined: number;
    left?: number;
    /** "scenario", or the seat that placed the person. */
    via: string;
  }[];
  turns: {
    label: string;
    ord: number;
    clock: string;
    /** Actor name for each seat, in the order of `seats`. Empty when the person is not in the world. */
    actors: string[];
    events: JournalEvent[];
  }[];
  /** File content by hash, for every version that a turn wrote. */
  objects: Record<string, string>;
}

export function exportData(run: Run): ExportData {
  const cal = run.scenario.calendar;
  // Every person who was ever in the world: the scenario's people first,
  // then the people who joined, in join order (REQ-QC-020).
  const members = [...run.load().people].sort(
    ([a, x], [b, y]) => x.joined - y.joined || (a < b ? -1 : 1),
  );
  const seats = members.map(([id, m]) => ({
    seat: seatOfMember(run.scenario, id, m),
    member: m,
  }));
  const present = (m: (typeof members)[number][1], ord: number) =>
    m.joined <= ord && (m.left === undefined || m.left >= ord);
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
        (e.type === 'mail.send' || e.type === 'mail.queued') &&
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
      actors: seats.map(({ seat, member }) =>
        present(member, ord)
          ? resolveCast(run.models, cast, seat, Math.max(ord, 1), cal).actorName
          : '',
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
    populations: run.scenario.orgs
      .filter((o) => o.kind === 'population')
      .map((o) => ({
        id: o.id,
        name: o.name,
        provider: o.provider as string,
        domain: providerOf(run.scenario, o).domain,
        size: o.members?.size ?? 0,
      })),
    orgs: run.scenario.orgs
      .filter((o) => o.kind !== 'population')
      .map((c) => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        host: hostOf(c),
      })),
    seats: seats.map(({ seat: s, member: m }) => ({
      id: s.id,
      name: s.person.name,
      title: s.person.title,
      role: s.person.role,
      org: s.org.id,
      host: s.host,
      ...(m.site ? { site: m.site } : {}),
      joined: m.joined,
      ...(m.left !== undefined ? { left: m.left } : {}),
      via: m.via,
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

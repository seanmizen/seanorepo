// One seat's working session inside one turn. Brains act only through
// `call`, which checks the time budget, runs the tool and records it.
// See REQ-QC-008 and REQ-QC-009.
import type { Wake } from './events.ts';
import type { Live } from './live.ts';
import type { ObjectStore } from './objects.ts';
import { type Op, Ops } from './ops.ts';
import type { Member, People, Scenario, Seat } from './scenario.ts';
import { describeTurn } from './time.ts';
import { CASES_ROOT } from './tools/cases.ts';
import { TOOLS, type ToolDef, toolsFor } from './tools/index.ts';
import { AccessError, Directory } from './users.ts';
import { normalize, type Vfs } from './vfs.ts';

export interface OutMail {
  id: string;
  hash: string;
  from: string;
  rcpts: string[];
}

export interface ToolResult {
  ok: boolean;
  text: string;
}

const RESULT_LOG_LIMIT = 2000;

export class Session {
  ops: Ops;
  readonly user: string;
  readonly host: string;
  readonly home: string;
  outbox: OutMail[] = [];
  minutesLeft: number;
  done = false;
  note = '';
  wake: Wake = 'next_turn';
  /** A listener for `qc run --watch`. It gets each tool call (REQ-QC-035). */
  live?: Live;
  /** The people in the world, with the joins and leaves of this session. */
  people: Map<string, Member>;
  private sent = 0;
  private dirCache = new Map<string, { key: string; dir: Directory }>();

  constructor(
    readonly seat: Seat,
    readonly scenario: Scenario,
    readonly label: string,
    ord: number,
    vfs: Vfs,
    readonly objects: ObjectStore,
    /** Active system events per host, for example a full disk. */
    readonly system: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
    people: People = new Map(),
    /**
     * A buffer that other sessions share. The members of a population act
     * on one view, as one bulk session. See REQ-QC-023.
     */
    shared?: Ops,
  ) {
    this.people = new Map(people);
    this.ops = shared ?? new Ops(vfs, objects, ord, system);
    this.user = seat.person.user;
    this.host = seat.host;
    this.home = `/home/${this.user}`;
    this.minutesLeft = scenario.turnMinutes;
  }

  get vfs() {
    return this.ops.vfs;
  }

  get clock() {
    return describeTurn(this.label, this.scenario.calendar);
  }

  /** The host that holds this seat's mailbox. See REQ-QC-021. */
  get mailHost() {
    return this.seat.mailHost;
  }

  /**
   * Accounts on a host, reloaded when passwd or group changes. The default
   * is the host where the seat works.
   */
  dir(host = this.host): Directory {
    const key = `${this.vfs.get(host, '/etc/passwd')?.hash}:${this.vfs.get(host, '/etc/group')?.hash}`;
    const hit = this.dirCache.get(host);
    if (hit?.key === key) return hit.dir;
    const dir = Directory.load(this.vfs, this.objects, host);
    this.dirCache.set(host, { key, dir });
    return dir;
  }

  resolve(path: string) {
    return normalize(path, this.home);
  }

  /**
   * Tools this seat can see. Admin tools appear only for the wheel group.
   * Case tools appear only when the work host has a case system.
   */
  tools(): ToolDef[] {
    return toolsFor(
      this.dir().isAdmin(this.user),
      this.seat.org.kind,
      this.vfs.exists(this.host, CASES_ROOT),
    );
  }

  /**
   * The user to act as. With sudo, a wheel member acts as root. Anyone else
   * gets the classic refusal, and the attempt goes to /var/log/auth.log.
   */
  actingUser(sudo?: boolean): string {
    if (!sudo) return this.user;
    if (this.dir().isAdmin(this.user)) {
      this.ops.log(
        this.host,
        '/var/log/auth.log',
        `${this.label} sudo: ${this.user} : COMMAND ALLOWED`,
      );
      return 'root';
    }
    this.ops.log(
      this.host,
      '/var/log/auth.log',
      `${this.label} sudo: ${this.user} : user NOT in sudoers`,
    );
    this.ops.emit(this.seat.id, {
      type: 'security',
      seat: this.seat.id,
      message: 'sudo refused',
    });
    throw new AccessError(
      `${this.user} is not in the sudoers file. This incident will be reported.`,
    );
  }

  nextMessageId() {
    this.sent += 1;
    return `${this.label}.${this.user}.${this.sent}`;
  }

  endTurn(note: string, wake: Wake) {
    this.note = note;
    this.wake = wake;
    this.done = true;
  }

  async call(
    name: string,
    rawArgs: unknown,
    opts: { compelled?: 'scenario' | 'director'; population?: string } = {},
  ): Promise<ToolResult> {
    const { result, staged } = this.stage(name, rawArgs ?? {});
    const logged =
      result.text.length > RESULT_LOG_LIMIT
        ? `${result.text.slice(0, RESULT_LOG_LIMIT)}…`
        : result.text;
    // The call goes in the journal before its effects, so playback reads in order.
    this.ops.emit(this.seat.id, {
      type: 'tool.call',
      seat: this.seat.id,
      ...(opts.compelled ? { compelled: opts.compelled } : {}),
      ...(opts.population ? { population: opts.population } : {}),
      tool: name,
      args: rawArgs ?? {},
      ok: result.ok,
      minutes: result.minutes,
      result: logged,
    });
    for (const op of staged) this.ops.emit(op.actor, op.body);
    this.live?.({
      type: 'tool',
      seat: this.seat.id,
      tool: name,
      args: rawArgs ?? {},
      ok: result.ok,
      minutes: result.minutes,
      result: logged,
    });
    return { ok: result.ok, text: result.text };
  }

  /**
   * Journal a tool call that the brain could not read, for example arguments
   * that are not JSON. It changes nothing and costs no minutes. See REQ-QC-031.
   */
  reject(name: string, rawArgs: unknown, reason: string): ToolResult {
    const text = `The tool call is not valid. ${reason}`;
    // Text that is not JSON goes in the journal as it came.
    const args =
      typeof rawArgs === 'string' ? { raw: rawArgs } : (rawArgs ?? {});
    this.ops.emit(this.seat.id, {
      type: 'tool.call',
      seat: this.seat.id,
      tool: name,
      args,
      ok: false,
      minutes: 0,
      result: text,
    });
    this.live?.({
      type: 'tool',
      seat: this.seat.id,
      tool: name,
      args,
      ok: false,
      minutes: 0,
      result: text,
    });
    return { ok: false, text };
  }

  /**
   * Run a tool against a scratch copy of the view. A tool that fails changes
   * nothing, except the security log. See REQ-QC-008.
   */
  private stage(
    name: string,
    rawArgs: unknown,
  ): { result: ToolResult & { minutes: number }; staged: Op[] } {
    const real = this.ops;
    const people = this.people;
    this.ops = new Ops(real.vfs.clone(), this.objects, real.ord, this.system);
    this.people = new Map(people);
    let ok = false;
    try {
      const result = this.execute(name, rawArgs);
      ok = result.ok;
      const staged = result.ok
        ? this.ops.list
        : this.ops.list.filter(
            (o) => o.actor === 'syslog' || o.body.type === 'security',
          );
      return { result, staged };
    } finally {
      this.ops = real;
      if (!ok) this.people = people;
    }
  }

  private execute(
    name: string,
    rawArgs: unknown,
  ): ToolResult & { minutes: number } {
    if (this.done)
      return {
        ok: false,
        minutes: 0,
        text: 'Your turn is over. Do not call more tools.',
      };
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool || !this.tools().includes(tool))
      return { ok: false, minutes: 0, text: `Tool "${name}" does not exist.` };
    const parsed = tool.input.safeParse(rawArgs);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
        .join('; ');
      return {
        ok: false,
        minutes: 0,
        text: `The arguments are not valid. ${issues}`,
      };
    }
    const args = parsed.data;
    let minutes: number;
    try {
      minutes = tool.minutes(this, args);
    } catch {
      minutes = 1;
    }
    if (minutes > this.minutesLeft) {
      return {
        ok: false,
        minutes: 0,
        text: `This needs ${minutes} minutes. You have ${this.minutesLeft} minutes left in this turn. Do a shorter task or call end_turn.`,
      };
    }
    try {
      const text = tool.run(this, args);
      this.minutesLeft -= minutes;
      if (this.minutesLeft <= 0 && !this.done) {
        this.done = true;
        return {
          ok: true,
          minutes,
          text: `${text}\n\n[Your time for this turn is over. The turn ends now.]`,
        };
      }
      return { ok: true, minutes, text };
    } catch (err) {
      return {
        ok: false,
        minutes: 0,
        text: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

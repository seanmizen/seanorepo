// One seat's working session inside one turn. Brains act only through
// `call`, which checks the time budget, runs the tool and records it.
// See REQ-QC-008 and REQ-QC-009.
import type { Wake } from './events.ts';
import type { ObjectStore } from './objects.ts';
import { type Op, Ops } from './ops.ts';
import type { Scenario, Seat } from './scenario.ts';
import { describeTurn } from './time.ts';
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
  private sent = 0;
  private dirCache?: { key: string; dir: Directory };

  constructor(
    readonly seat: Seat,
    readonly scenario: Scenario,
    readonly label: string,
    ord: number,
    vfs: Vfs,
    readonly objects: ObjectStore,
  ) {
    this.ops = new Ops(vfs, objects, ord);
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

  /** Accounts on this host, reloaded when passwd or group changes. */
  dir(): Directory {
    const key = `${this.vfs.get(this.host, '/etc/passwd')?.hash}:${this.vfs.get(this.host, '/etc/group')?.hash}`;
    if (this.dirCache?.key !== key)
      this.dirCache = {
        key,
        dir: Directory.load(this.vfs, this.objects, this.host),
      };
    return this.dirCache.dir;
  }

  resolve(path: string) {
    return normalize(path, this.home);
  }

  /** Tools this seat can see. Admin tools appear only for the wheel group. */
  tools(): ToolDef[] {
    return toolsFor(this.dir().isAdmin(this.user));
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

  async call(name: string, rawArgs: unknown): Promise<ToolResult> {
    const { result, staged } = this.stage(name, rawArgs ?? {});
    // The call goes in the journal before its effects, so playback reads in order.
    this.ops.emit(this.seat.id, {
      type: 'tool.call',
      seat: this.seat.id,
      tool: name,
      args: rawArgs ?? {},
      ok: result.ok,
      minutes: result.minutes,
      result:
        result.text.length > RESULT_LOG_LIMIT
          ? `${result.text.slice(0, RESULT_LOG_LIMIT)}…`
          : result.text,
    });
    for (const op of staged) this.ops.emit(op.actor, op.body);
    return { ok: result.ok, text: result.text };
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
    this.ops = new Ops(real.vfs.clone(), this.objects, real.ord);
    try {
      const result = this.execute(name, rawArgs);
      const staged = result.ok
        ? this.ops.list
        : this.ops.list.filter(
            (o) => o.actor === 'syslog' || o.body.type === 'security',
          );
      return { result, staged };
    } finally {
      this.ops = real;
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

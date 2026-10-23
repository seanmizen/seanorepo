// Where: apps/action/server/chat.ts
// When: server/index.ts calls these for each "chat" message and for the
// server lines. chat.test.ts tests them (yarn workspace action test).
// Why: the checks of the chat relay. The server is the only place that
// cleans a message: it removes the control characters, cuts the message
// to chat_max_length bytes, and limits the rate of each player. The
// server cvars chat_max_length, chat_rate_messages and chat_rate_seconds
// set the limits (game/src/server_cvars.json).
//
// Teams: each player has a team number. Team 0 is no team: the player is
// a team of one, so a team message goes to the sender only. Deathmatch
// has no teams. A game mode with teams sets the team numbers, and the
// relay stays the same.

export type ChatChannel = 'all' | 'team';

/** The channel of a client message, or null for a bad one. A client
 * cannot send on the "server" channel. */
export function chatChannel(v: unknown): ChatChannel | null {
  return v === 'all' || v === 'team' ? v : null;
}

/** The longest message that the server reads before it cleans it, in
 * UTF-16 units. A longer one is cut first, so a huge message costs little.
 * It is more than any chat_max_length. */
const MAX_RAW = 4096;
// cleanChat changes line breaks and tabs to spaces. It removes the other
// control characters (Unicode Cc), the format characters (Cf: the
// bidirectional overrides, the zero-width characters) and lone surrogates
// (Cs).
const BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
const CONTROLS = /[\p{Cc}\p{Cf}\p{Cs}]/gu;
const SPACES = /\p{Zs}+/gu;
const encoder = new TextEncoder();

/** A chat message as the server relays it: no control characters, one
 * space between words, no space at the ends, and at most `maxBytes` bytes
 * of UTF-8 (cut on a code point boundary). Null when nothing is left or
 * the text is not a string. */
export function cleanChat(raw: unknown, maxBytes: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw
    .slice(0, MAX_RAW)
    .replace(BREAKS, ' ')
    .replace(CONTROLS, '')
    .replace(SPACES, ' ')
    .trim();
  let out = '';
  let bytes = 0;
  for (const ch of s) {
    const n = encoder.encode(ch).length;
    if (bytes + n > maxBytes) break;
    out += ch;
    bytes += n;
  }
  out = out.trimEnd();
  return out || null;
}

/** The rate limit of one player: at most `max` messages in `windowMs`.
 * `times` holds the send times of the recent messages, and this function
 * changes it. Returns true when the message at `now` can go. */
export function chatRateOk(
  times: number[],
  now: number,
  max: number,
  windowMs: number,
): boolean {
  while (times.length > 0 && now - times[0] >= windowMs) times.shift();
  if (times.length >= max) return false;
  times.push(now);
  return true;
}

/** The seconds until the oldest recent message leaves the window. */
export function chatWaitSeconds(
  times: number[],
  now: number,
  windowMs: number,
): number {
  if (times.length === 0) return 0;
  return Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000));
}

export interface ChatMember {
  id: number;
  /** 0: no team (a team of one). */
  team: number;
  joined: boolean;
}

/** The two players are on one team. A player with no team is on a team
 * of one. */
export function sameTeam(a: ChatMember, b: ChatMember): boolean {
  return a.id === b.id || (a.team !== 0 && a.team === b.team);
}

/** The players that get a message of `from` on `channel`: every joined
 * player, or the joined players of the team of the sender. */
export function chatRecipients<P extends ChatMember>(
  from: P,
  players: Iterable<P>,
  channel: ChatChannel,
): P[] {
  const out: P[] = [];
  for (const p of players) {
    if (!p.joined) continue;
    if (channel === 'team' && !sameTeam(from, p)) continue;
    out.push(p);
  }
  return out;
}

/** The server line at the end of a match: the winner, a draw, or no
 * kills. */
export function matchEndText(scores: { name: string; k: number }[]): string {
  const best = Math.max(0, ...scores.map((s) => s.k));
  if (best === 0) return 'The match ended. Nobody got a kill.';
  const top = scores.filter((s) => s.k === best).map((s) => s.name);
  const kills = best === 1 ? '1 kill' : `${best} kills`;
  if (top.length === 1) return `The match ended. ${top[0]} won with ${kills}.`;
  return `The match ended in a draw: ${top.join(', ')} with ${kills}.`;
}

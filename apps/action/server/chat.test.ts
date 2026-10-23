// Where: apps/action/server/chat.test.ts
// When: yarn workspace action test (bun test server).
// Why: the chat checks of the server (chat.ts): the clean text, the length
// cap, the rate limit, the team routing and the match end line.
import { describe, expect, test } from 'bun:test';
import {
  type ChatMember,
  chatChannel,
  chatRateOk,
  chatRecipients,
  chatWaitSeconds,
  cleanChat,
  matchEndText,
  sameTeam,
} from './chat';

describe('cleanChat', () => {
  test('control characters go, line breaks and tabs become spaces', () => {
    expect(cleanChat('a\u0000b\u0007c\u001bd\u007fe', 100)).toBe('abcde');
    expect(cleanChat('one\ntwo\r\nthree\tfour', 100)).toBe(
      'one two three four',
    );
    expect(cleanChat('x\u2028y\u2029z\u0085w', 100)).toBe('x y z w');
    // C1 controls.
    expect(cleanChat('a\u0080\u009fb', 100)).toBe('ab');
  });

  test('format characters go: bidirectional overrides, zero width', () => {
    expect(cleanChat('abc\u202edcba\u202c', 100)).toBe('abcdcba');
    expect(cleanChat('a\u200bb\u200dc\ufeffd\u2066e\u2069', 100)).toBe('abcde');
  });

  test('a lone surrogate goes, a full code point stays', () => {
    expect(cleanChat('a\ud800b', 100)).toBe('ab');
    expect(cleanChat('gg \u{1f600}', 100)).toBe('gg \u{1f600}');
  });

  test('runs of spaces become one, the ends are trimmed', () => {
    expect(cleanChat('   a    b\u00a0\u3000c   ', 100)).toBe('a b c');
  });

  test('the cap is in bytes of UTF-8, cut on a code point', () => {
    expect(cleanChat('abcdefgh', 5)).toBe('abcde');
    // e with an acute accent is 2 bytes: 2 + 2 + 2 > 5.
    expect(cleanChat('\u00e9\u00e9\u00e9', 5)).toBe('\u00e9\u00e9');
    // A cut before a space leaves no space at the end.
    expect(cleanChat('abcd efgh', 5)).toBe('abcd');
    // A huge message costs little and is cut.
    expect(cleanChat('x'.repeat(1_000_000), 160)).toBe('x'.repeat(160));
  });

  test('nothing left, or not a string: null', () => {
    expect(cleanChat('', 100)).toBeNull();
    expect(cleanChat(' \n\t\u200b ', 100)).toBeNull();
    expect(cleanChat(42, 100)).toBeNull();
    expect(cleanChat(undefined, 100)).toBeNull();
    expect(cleanChat({ text: 'a' }, 100)).toBeNull();
  });
});

describe('chatChannel', () => {
  test('all and team only', () => {
    expect(chatChannel('all')).toBe('all');
    expect(chatChannel('team')).toBe('team');
    expect(chatChannel('server')).toBeNull();
    expect(chatChannel(undefined)).toBeNull();
  });
});

describe('chatRateOk', () => {
  test('at most max messages in the window', () => {
    const times: number[] = [];
    expect(chatRateOk(times, 0, 3, 5000)).toBe(true);
    expect(chatRateOk(times, 100, 3, 5000)).toBe(true);
    expect(chatRateOk(times, 200, 3, 5000)).toBe(true);
    expect(chatRateOk(times, 300, 3, 5000)).toBe(false);
    // A dropped message does not count.
    expect(times).toEqual([0, 100, 200]);
    expect(chatWaitSeconds(times, 300, 5000)).toBe(5);
    // The first message leaves the window at 5000.
    expect(chatRateOk(times, 4999, 3, 5000)).toBe(false);
    expect(chatRateOk(times, 5000, 3, 5000)).toBe(true);
    expect(times).toEqual([100, 200, 5000]);
  });
});

describe('chatRecipients', () => {
  const p = (id: number, team = 0, joined = true): ChatMember => ({
    id,
    team,
    joined,
  });

  test('all: every joined player, the sender too', () => {
    const list = [p(1), p(2), p(3, 0, false)];
    expect(chatRecipients(list[0], list, 'all').map((x) => x.id)).toEqual([
      1, 2,
    ]);
  });

  test('team with no teams: the sender only', () => {
    const list = [p(1), p(2), p(3)];
    expect(chatRecipients(list[1], list, 'team').map((x) => x.id)).toEqual([2]);
  });

  test('team with teams: the joined players of the team', () => {
    const list = [p(1, 1), p(2, 2), p(3, 1), p(4, 1, false)];
    expect(chatRecipients(list[0], list, 'team').map((x) => x.id)).toEqual([
      1, 3,
    ]);
    expect(sameTeam(p(5), p(6))).toBe(false);
    expect(sameTeam(p(5, 2), p(6, 2))).toBe(true);
  });
});

describe('matchEndText', () => {
  test('a winner, a draw, no kills', () => {
    expect(
      matchEndText([
        { name: 'Ghost42', k: 7 },
        { name: 'Rook11', k: 3 },
      ]),
    ).toBe('The match ended. Ghost42 won with 7 kills.');
    expect(
      matchEndText([
        { name: 'A', k: 1 },
        { name: 'B', k: 1 },
      ]),
    ).toBe('The match ended in a draw: A, B with 1 kill.');
    expect(matchEndText([{ name: 'A', k: 0 }])).toBe(
      'The match ended. Nobody got a kill.',
    );
    expect(matchEndText([])).toBe('The match ended. Nobody got a kill.');
  });
});

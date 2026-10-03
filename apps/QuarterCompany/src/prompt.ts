// Text that model-driven seats see. The system prompt stays the same for a
// seat across turns, so providers can cache it. The briefing changes each turn.
import type { SeatState } from './run.ts';
import type { Seat } from './scenario.ts';
import type { Session } from './session.ts';

export function systemPrompt(
  seat: Seat,
  slotMinutes: number,
  turnMinutes: number,
): string {
  const { person, company } = seat;
  return [
    `You are ${person.name}, ${person.title} at ${company.name}. Your email address is ${seat.id}.`,
    company.about.trim(),
    person.persona.trim(),
    '',
    'How your work happens:',
    `- You work at a computer on the host ${company.host}. You use the computer only through the tools.`,
    `- The working day has slots of ${slotMinutes} minutes. In each slot you get one turn of ${turnMinutes} minutes.`,
    '- Each tool uses some minutes. When your minutes are finished, the turn ends.',
    '- You remember nothing between turns. You keep only the note that you give to end_turn, and your files.',
    '- Keep longer notes in a file in your home folder, for example notes.md.',
    '- Other people work at the same time. Use email to speak to them. Mail arrives at the end of a turn.',
    '- You can think privately with think_privately. Nobody else can see your thoughts. Be honest in them.',
    '- If you have no work, call end_turn with wake set to "on_mail".',
    '- Do the work of your role. Write as a professional in a small company.',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');
}

/** Thoughts from earlier turns that the briefing repeats. */
const RECALLED_THOUGHTS = 5;

export function briefing(
  session: Session,
  prev: SeatState | undefined,
  unread: number,
  thoughts: { label: string; text: string }[] = [],
): string {
  const recent = thoughts.slice(-RECALLED_THOUGHTS);
  return [
    `It is ${session.clock} (turn ${session.label}).`,
    `You are logged in to ${session.seat.company.host} as ${session.user}. You have ${session.minutesLeft} minutes in this turn.`,
    `Unread mail: ${unread}.`,
    prev
      ? `Your note from your last turn: "${prev.note || '(no note)'}"`
      : 'This is your first turn.',
    ...(recent.length
      ? [
          'Your recent private thoughts:',
          ...recent.map(
            (t) => `- (${t.label}) ${t.text.replace(/\s+/g, ' ').trim()}`,
          ),
        ]
      : []),
  ].join('\n');
}

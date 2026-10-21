import { type FC, type FormEvent, useEffect, useRef, useState } from 'react';
import styles from './leaderboard.module.css';

/** One finished run, from Game's onCrash callback. */
type Run = {
  /** Different for each run, so the same score twice is two runs. */
  id: number;
  score: number;
  durationMs: number;
  /** Birds eaten in the run. The backend permits their bonus points. */
  birds: number;
};

type ScoreRow = { name: string; score: number; createdAt: string };

/** The backend keeps the top 10 (apps/cous/cous-be). */
const TOP_N = 10;
/** NAME_MAX in cous-be/src/validation.ts. */
const NAME_MAX = 10;
const NAME_KEY = 'cous:name';

const readName = (): string => {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
};

const saveName = (name: string) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage can be blocked. The name is then not kept.
  }
};

const isTopScore = (score: number, scores: ScoreRow[]) =>
  score > 0 &&
  (scores.length < TOP_N || score > scores[scores.length - 1].score);

/**
 * A score in 5 characters, as on the game's distance meter: 00500, 10000.
 * From 100000 it is 4 digits and a unit: 0240K, 0120M. It rounds down, so
 * a short score never claims more than the real one. `zeros` is the
 * leading zeros, which draw grey.
 */
const formatScore = (
  score: number,
): { zeros: string; rest: string; short: boolean } => {
  let text: string;
  if (score < 100_000) text = String(score).padStart(5, '0');
  else if (score < 10_000_000)
    text = `${String(Math.floor(score / 1_000)).padStart(4, '0')}K`;
  else if (score < 10_000_000_000)
    text = `${String(Math.floor(score / 1_000_000)).padStart(4, '0')}M`;
  else text = `${Math.floor(score / 1_000_000_000)}B`;
  // Keep one digit out of the grey, so 0 shows as 0000 and a white 0.
  const zeros = text.match(/^0+(?=\d)/)?.[0] ?? '';
  return { zeros, rest: text.slice(zeros.length), short: score >= 100_000 };
};

// Three letters each. en-GB gives "Sept", which breaks the column.
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** A date as "Oct '26". */
const shortDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${MONTHS[date.getMonth()]} '${String(date.getFullYear()).slice(-2)}`;
};

/**
 * The score in 5 characters. For a short form (K, M), hover or focus shows
 * the exact score (CSS). A tap does the same on a touch screen.
 */
const Score: FC<{ score: number }> = ({ score }) => {
  const [exact, setExact] = useState(false);
  const { zeros, rest, short } = formatScore(score);
  const full = score.toLocaleString('en-GB');
  const digits = (
    <>
      <span className={styles.zeros}>{zeros}</span>
      {rest}
    </>
  );
  if (!short) {
    return (
      <span className={styles.score}>
        <span aria-hidden="true">{digits}</span>
        <span className={styles.srOnly}>{full}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${styles.score} ${styles.scoreButton} ${exact ? styles.exact : ''}`}
      onClick={() => setExact((v) => !v)}
      aria-label={`${full} points`}
      title={full}
    >
      <span className={styles.short} aria-hidden="true">
        {digits}
      </span>
      <span className={styles.full} aria-hidden="true">
        {full}
      </span>
    </button>
  );
};

type ModalProps = {
  run: Run;
  onSaved: (scores: ScoreRow[]) => void;
  onDiscard: () => void;
};

/**
 * Asks for a name after a top-10 run. Escape, the close button and a click
 * outside ask first, so a score is not lost by accident.
 */
const HighScoreModal: FC<ModalProps> = ({ run, onSaved, onDiscard }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** True once the player saves or discards. Then a close is expected. */
  const finished = useRef(false);
  const [name, setName] = useState(readName);
  const [leaving, setLeaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!leaving) inputRef.current?.focus();
  }, [leaving]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          score: run.score,
          durationMs: run.durationMs,
          birds: run.birds,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'The score did not save. Try again.');
        return;
      }
      saveName(trimmed);
      finished.current = true;
      dialogRef.current?.close();
      onSaved(body.scores);
    } catch {
      setError('The score did not save. Try again.');
    } finally {
      setSending(false);
    }
  };

  const discard = () => {
    finished.current = true;
    dialogRef.current?.close();
    onDiscard();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.modal}
      aria-labelledby="top-ten-title"
      // The browser must not close the modal by itself: the player is
      // asked first. `closedby` stops Escape and outside clicks in the
      // browsers that have it. Escape then comes here as a key.
      {...{ closedby: 'none' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          setLeaving(true);
        }
      }}
      // Browsers without `closedby` send a cancel event for Escape.
      onCancel={(e) => {
        e.preventDefault();
        setLeaving(true);
      }}
      // Chrome closes the modal on a second Escape, even when the page
      // prevents the cancel event. Open it again, and ask.
      onClose={() => {
        if (finished.current) return;
        dialogRef.current?.showModal();
        setLeaving(true);
      }}
      // A click on the backdrop lands on the dialog itself.
      onClick={(e) => {
        if (e.target === e.currentTarget) setLeaving(true);
      }}
    >
      <button
        type="button"
        className={styles.close}
        onClick={() => setLeaving(true)}
        aria-label="Close"
      >
        ×
      </button>
      {leaving ? (
        <div className={styles.modalBody}>
          <h2 id="top-ten-title">Leave without saving?</h2>
          <p>Your {run.score.toLocaleString('en-GB')} won't go on the board.</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => setLeaving(false)}
            >
              No, save it
            </button>
            <button type="button" onClick={discard}>
              Yes, discard
            </button>
          </div>
        </div>
      ) : (
        <form className={styles.modalBody} onSubmit={submit}>
          <h2 id="top-ten-title">You made the Top Ten Ever!</h2>
          <p>Put your high score on the board, mister.</p>
          <p className={styles.bigScore}>{run.score.toLocaleString('en-GB')}</p>
          <label className={styles.nameLabel}>
            your name
            <input
              ref={inputRef}
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              required
              autoComplete="nickname"
              enterKeyHint="send"
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.primary}
              disabled={sending || !name.trim()}
            >
              {sending ? 'Saving…' : 'Put it on the board'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
};

/**
 * The shared top 10. After a crash with a top-10 score, a modal asks for a
 * name. With no backend (`yarn workspace cous start` on its own), the board
 * shows a short message and the game works as before.
 */
const Leaderboard: FC<{ run: Run | null }> = ({ run }) => {
  const [scores, setScores] = useState<ScoreRow[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [doneRunId, setDoneRunId] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/scores')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { scores: ScoreRow[] }) => setScores(body.scores))
      .catch(() => setOffline(true));
  }, []);

  const asking =
    run !== null &&
    scores !== null &&
    doneRunId !== run.id &&
    isTopScore(run.score, scores);

  return (
    <section className={styles.board} aria-labelledby="top-ten-heading">
      <h2 id="top-ten-heading" className={styles.heading}>
        Top Ten Ever
      </h2>
      {offline && <p className={styles.message}>the board is offline.</p>}
      {!offline && scores === null && (
        <p className={styles.message}>loading…</p>
      )}
      {scores?.length === 0 && (
        <p className={styles.message}>no scores yet. be the first.</p>
      )}
      {scores && scores.length > 0 && (
        <ol className={styles.list}>
          {scores.map((s, i) => (
            <li key={`${s.createdAt}-${s.name}-${i}`} className={styles.row}>
              <span className={styles.rank}>{i + 1}</span>
              <span className={styles.name}>{s.name}</span>
              <span className={styles.date}>{shortDate(s.createdAt)}</span>
              <Score score={s.score} />
            </li>
          ))}
        </ol>
      )}
      {asking && (
        <HighScoreModal
          key={run.id}
          run={run}
          onSaved={(next) => {
            setScores(next);
            setDoneRunId(run.id);
          }}
          onDiscard={() => setDoneRunId(run.id)}
        />
      )}
    </section>
  );
};

export { Leaderboard, formatScore };
export type { Run };

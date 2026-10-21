import { type FC, type FormEvent, useEffect, useRef, useState } from 'react';
import styles from './leaderboard.module.css';

/** One finished run, from Game's onCrash callback. */
type Run = {
  /** Different for each run, so the same score twice is two runs. */
  id: number;
  score: number;
  durationMs: number;
};

type ScoreRow = { name: string; score: number; createdAt: string };

/** The backend keeps the top 10 (apps/cous/cous-be). */
const TOP_N = 10;
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
 * The shared top 10, below the game. After a crash with a top-10 score, it
 * asks for a name. With no backend (`yarn workspace cous start` on its own),
 * it shows a short message and the game works as before.
 */
const Leaderboard: FC<{ run: Run | null }> = ({ run }) => {
  const [scores, setScores] = useState<ScoreRow[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [name, setName] = useState(readName);
  const [doneRunId, setDoneRunId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/scores')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { scores: ScoreRow[] }) => setScores(body.scores))
      .catch(() => setOffline(true));
  }, []);

  // A new run clears the error of the last one.
  useEffect(() => {
    if (run) setError(null);
  }, [run]);

  const asking =
    run !== null &&
    scores !== null &&
    doneRunId !== run.id &&
    isTopScore(run.score, scores);

  // The name field takes the focus, so the next keys type the name. A key
  // in the field does not restart the game (cous.tsx ignores input keys).
  useEffect(() => {
    if (asking) inputRef.current?.focus();
  }, [asking]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!run) return;
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
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'The score did not save.');
        return;
      }
      saveName(trimmed);
      setScores(body.scores);
      setDoneRunId(run.id);
    } catch {
      setError('The score did not save.');
    } finally {
      setSending(false);
    }
  };

  const skip = () => {
    if (run) setDoneRunId(run.id);
  };

  return (
    <>
      {asking && (
        <form className={styles.form} onSubmit={submit}>
          <label>
            top 10! your name:{' '}
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') skip();
              }}
              maxLength={12}
              required
              ref={inputRef}
              autoComplete="nickname"
              enterKeyHint="send"
            />
          </label>
          <button type="submit" disabled={sending || !name.trim()}>
            save {run.score}
          </button>
          <button type="button" onClick={skip}>
            skip
          </button>
          {error && <p className={styles.error}>{error}</p>}
        </form>
      )}
      <details className={styles.leaderboard} open>
        <summary>high scores</summary>
        {offline && (
          <p className={styles.message}>the leaderboard is offline.</p>
        )}
        {!offline && scores === null && (
          <p className={styles.message}>loading…</p>
        )}
        {scores?.length === 0 && (
          <p className={styles.message}>no scores yet. be the first.</p>
        )}
        {scores && scores.length > 0 && (
          <ol className={styles.list}>
            {scores.map((s, i) => (
              <li key={`${s.createdAt}-${s.name}-${i}`}>
                <span className={styles.name}>{s.name}</span>
                <span className={styles.score}>{s.score}</span>
              </li>
            ))}
          </ol>
        )}
      </details>
    </>
  );
};

export { Leaderboard };
export type { Run };

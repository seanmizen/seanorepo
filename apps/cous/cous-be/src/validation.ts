// Validation for POST /api/scores. These values copy the game rules in
// ../src/cous/game.ts. Change both files together.

/** runnerConfig.MAX_SPEED in game.ts: px per frame. */
const MAX_SPEED = 13;
/** game.ts runs the physics at 60 frames per second. */
const FPS = 60;
/** meterConfig.COEFFICIENT in game.ts: the score is distance × 0.025. */
const COEFFICIENT = 0.025;

/** BIRD_POINTS in game.ts: points for each bird eaten. */
const BIRD_POINTS = 50;
/**
 * Birds come at most about one each second. Two each second leaves
 * room, and still stops a client that claims a flock.
 */
const MAX_BIRDS_PER_SECOND = 2;

const NAME_MAX = 10;
/** The board shows a score as 4 characters, up to 999M. */
const SCORE_MAX = 999_999_999;
/** A run longer than one day is not a real run. */
const DURATION_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * The highest score that a run of `durationMs` can get. The game never goes
 * faster than MAX_SPEED, so the distance is at most
 * MAX_SPEED × FPS / 1000 px for each ms. The +1 permits the rounding in
 * DistanceMeter.getActualDistance.
 */
const maxScoreFor = (durationMs: number, birds = 0): number =>
  Math.floor(((durationMs * MAX_SPEED * FPS) / 1000) * COEFFICIENT) +
  1 +
  birds * BIRD_POINTS;

/** The most birds that a run of `durationMs` can eat. */
const maxBirdsFor = (durationMs: number): number =>
  Math.ceil((durationMs / 1000) * MAX_BIRDS_PER_SECOND);

// Printable: no control or format characters, and no separator other than
// the plain space.
const PRINTABLE = /^(?:[^\p{C}\p{Z}]| )+$/u;

type ScoreInput = { name: string; score: number; durationMs: number };

type Validation =
  | { ok: true; value: ScoreInput }
  | { ok: false; error: string };

/** Checks the body of POST /api/scores. The name comes back trimmed. */
const validateScore = (body: unknown): Validation => {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'The body must be a JSON object.' };
  }
  const {
    name,
    score,
    durationMs,
    birds = 0,
  } = body as Record<string, unknown>;

  if (typeof name !== 'string') {
    return { ok: false, error: 'The name must be a string.' };
  }
  const trimmed = name.trim();
  const length = [...trimmed].length;
  if (length < 1 || length > NAME_MAX) {
    return {
      ok: false,
      error: `The name must have 1 to ${NAME_MAX} characters.`,
    };
  }
  if (!PRINTABLE.test(trimmed)) {
    return {
      ok: false,
      error: 'The name must have printable characters only.',
    };
  }

  if (
    typeof score !== 'number' ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > SCORE_MAX
  ) {
    return {
      ok: false,
      error: `The score must be a whole number from 0 to ${SCORE_MAX}.`,
    };
  }

  if (
    typeof durationMs !== 'number' ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    durationMs > DURATION_MAX_MS
  ) {
    return {
      ok: false,
      error: 'The duration must be a number of ms from 0 to 86400000.',
    };
  }

  if (
    typeof birds !== 'number' ||
    !Number.isInteger(birds) ||
    birds < 0 ||
    birds > maxBirdsFor(durationMs)
  ) {
    return {
      ok: false,
      error: 'The number of birds must be a whole number that the run permits.',
    };
  }

  if (score > maxScoreFor(durationMs, birds)) {
    return {
      ok: false,
      error: 'The score is too high for the duration of the run.',
    };
  }

  return { ok: true, value: { name: trimmed, score, durationMs } };
};

export { maxBirdsFor, maxScoreFor, validateScore };
export type { ScoreInput };

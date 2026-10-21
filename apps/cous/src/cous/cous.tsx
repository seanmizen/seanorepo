import { type FC, useEffect, useRef, useState } from 'react';
import styles from './cous.module.css';
import { Game } from './game';
import {
  CANVAS,
  DEFAULT_THEME_ID,
  loadTheme,
  SPRITE_THEMES,
  type SpriteThemeId,
} from './sprites';

// `?hitboxes` in the URL draws the collision boxes.
const SHOW_HITBOXES = new URLSearchParams(window.location.search).has(
  'hitboxes',
);

type CousProps = {
  /** Draws the pixel art in dark-mode colours. */
  dark: boolean;
};

const Cous: FC<CousProps> = ({ dark }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [themeId, setThemeId] = useState<SpriteThemeId>(DEFAULT_THEME_ID);
  const darkRef = useRef(dark);
  darkRef.current = dark;

  // Size the backing store to the displayed size × devicePixelRatio, and
  // scale the context so that the game logic stays in logical px
  // (CANVAS.WIDTH × CANVAS.HEIGHT).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.round(canvas.clientWidth * dpr);
      canvas.width = width;
      canvas.height = Math.round((width * CANVAS.HEIGHT) / CANVAS.WIDTH);
      const k = width / CANVAS.WIDTH;
      canvas.getContext('2d')?.setTransform(k, 0, 0, k, 0, 0);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // (Re-)instantiate the game when the theme changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const theme = SPRITE_THEMES[themeId];
    let cancelled = false;
    setReady(false);
    setError(null);
    gameRef.current?.stop();
    gameRef.current = null;

    loadTheme(theme)
      .then((loaded) => {
        if (cancelled) return;
        gameRef.current = new Game(
          canvas,
          loaded,
          {
            onInvertChange: (inverted: boolean) => {
              canvas.classList.toggle(styles.inverted, inverted);
            },
            onStart: () => setWaiting(false),
          },
          { showHitboxes: SHOW_HITBOXES },
        );
        gameRef.current.setDark(darkRef.current);
        gameRef.current.start();
        setReady(true);
        setWaiting(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      gameRef.current?.stop();
      gameRef.current = null;
    };
  }, [themeId]);

  useEffect(() => {
    gameRef.current?.setDark(dark);
  }, [dark]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const game = gameRef.current;
      if (!game) return;
      // Before the first run and after a crash, any key starts the game.
      // A held key, browser shortcuts and keys for a form control (the
      // theme picker, the toggle) do not.
      if (game.waiting || game.crashed) {
        if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
        const { target } = e;
        if (
          target instanceof Element &&
          target.closest('select, button, input, textarea')
        ) {
          return;
        }
        e.preventDefault();
        game.jump();
        return;
      }
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        game.jump();
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        game.duck(true);
      } else if (e.code === 'Enter') {
        game.jump();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const game = gameRef.current;
      if (!game) return;
      if (e.code === 'ArrowDown') game.duck(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <div className={styles.wrapper}>
      <label className={styles.themePicker}>
        theme:{' '}
        <select
          value={themeId}
          onChange={(e) => setThemeId(e.target.value as SpriteThemeId)}
        >
          {Object.entries(SPRITE_THEMES).map(([id, theme]) => (
            <option key={id} value={id}>
              {theme.label}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          onPointerDown={() => gameRef.current?.jump()}
          aria-label="cous, a chrome-dino-style runner game"
        />
        {ready && waiting && (
          <p className={styles.prompt}>press any key to get going (or tap)</p>
        )}
      </div>
      {/* Touch devices only (see cous.module.css), once the game starts. */}
      {ready && !waiting && (
        <div className={styles.touchControls}>
          <button
            type="button"
            className={styles.touchButton}
            onPointerDown={(e) => {
              e.preventDefault();
              // The button keeps the pointer, so the release always
              // arrives here, even when the finger slides off.
              e.currentTarget.setPointerCapture(e.pointerId);
              gameRef.current?.duck(true);
            }}
            onPointerUp={() => gameRef.current?.duck(false)}
            onPointerCancel={() => gameRef.current?.duck(false)}
            onLostPointerCapture={() => gameRef.current?.duck(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            duck
          </button>
          <button
            type="button"
            className={styles.touchButton}
            onPointerDown={(e) => {
              e.preventDefault();
              gameRef.current?.jump();
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            jump
          </button>
        </div>
      )}
      {!ready && !error && <p className={styles.status}>loading sprites…</p>}
      {error && <p className={styles.error}>{error}</p>}
      <p className={styles.hint}>
        space / ↑ to jump · ↓ to duck · any key to restart
      </p>
    </div>
  );
};

export { Cous };

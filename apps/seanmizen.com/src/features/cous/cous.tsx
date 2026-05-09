import { type FC, useEffect, useRef, useState } from 'react';
import styles from './cous.module.css';
import { Game } from './game';
import {
  CANVAS,
  DEFAULT_THEME_ID,
  loadSpriteSheet,
  SPRITE_THEMES,
  type SpriteThemeId,
} from './sprites';

const Cous: FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [themeId, setThemeId] = useState<SpriteThemeId>(DEFAULT_THEME_ID);

  // Set up canvas backing store once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Scale the canvas for HiDPI: render at devicePixelRatio internally
    // but keep the CSS-pixel coordinate system so all logic is in CSS px.
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = CANVAS.WIDTH * dpr;
    canvas.height = CANVAS.HEIGHT * dpr;
    canvas.style.width = `${CANVAS.WIDTH}px`;
    canvas.style.height = `${CANVAS.HEIGHT}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.imageSmoothingEnabled = false;
    }
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

    loadSpriteSheet(theme)
      .then((sheet) => {
        if (cancelled) return;
        gameRef.current = new Game(canvas, sheet, theme, {
          onInvertChange: (inverted: boolean) => {
            canvas.classList.toggle(styles.inverted, inverted);
          },
        });
        gameRef.current.start();
        setReady(true);
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
    const onKeyDown = (e: KeyboardEvent) => {
      const game = gameRef.current;
      if (!game) return;
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
        sprite sheet:{' '}
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
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={() => gameRef.current?.jump()}
        aria-label="cous, a chrome-dino-style runner game"
      />
      {!ready && !error && <p className={styles.status}>loading sprites…</p>}
      {error && <p className={styles.error}>{error}</p>}
      <p className={styles.hint}>
        space / ↑ to jump · ↓ to duck · enter to restart
      </p>
    </div>
  );
};

export { Cous };

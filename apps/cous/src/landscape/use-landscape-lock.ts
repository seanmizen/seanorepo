import { useEffect } from 'react';

// lib.dom does not type ScreenOrientation.lock: only some browsers have it.
type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
};

/**
 * On a touch device, the first tap on the game canvas requests fullscreen
 * and locks landscape. Android Chrome allows both. iPhone Safari allows
 * neither, so there it does nothing (RotateHint asks the player instead).
 *
 * A browser accepts a fullscreen request only from a user gesture. For a
 * touch, that is the `click` at the end of the tap, not the pointerdown
 * that makes the game jump.
 */
const useLandscapeLock = () => {
  useEffect(() => {
    const touch = window.matchMedia('(hover: none) and (pointer: coarse)');
    const root = document.documentElement;
    if (!touch.matches || !root.requestFullscreen) return;

    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('canvas')) return;
      document.removeEventListener('click', onClick);
      if (document.fullscreenElement) return;
      root
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() =>
          (screen.orientation as LockableOrientation).lock?.('landscape'),
        )
        .catch(() => {
          // The browser refused fullscreen or the lock. The game still works.
        });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
};

export { useLandscapeLock };

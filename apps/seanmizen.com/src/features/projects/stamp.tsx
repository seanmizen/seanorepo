import type {
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useEffect, useRef, useState } from 'react';
import styles from './stamp.module.css';

/* The last card that was moved draws over the others. */
let topZ = 10;

/* How far an arrow key moves a card, in CSS pixels. Shift moves it more. */
const NUDGE = 10;
const NUDGE_SHIFT = 40;

/* One stamp. Drag its handle, or focus the handle and press the arrow keys,
   and the card stays where you put it, open, so you can compare two. Once
   it has moved, the back button sends it home. Escape on the handle does
   the same. Either way the focus goes back to the row's link. */
const Stamp: FC<{ name: string; Thumb: FC }> = ({ name, Thumb }) => {
  const [at, setAt] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [z, setZ] = useState<number>();
  const grab = useRef({ x: 0, y: 0 });
  const handle = useRef<HTMLButtonElement>(null);
  const [resting, setResting] = useState(false);
  const placed = at.x !== 0 || at.y !== 0;

  // After a click on the back button, the pointer rests where the card
  // was, and the browser still counts the card as hovered. Hover does not
  // open the card again until the pointer moves.
  useEffect(() => {
    if (!resting) return;
    const wake = () => setResting(false);
    window.addEventListener('pointermove', wake, { once: true });
    return () => window.removeEventListener('pointermove', wake);
  }, [resting]);

  const raise = () => setZ(++topZ);

  // Home, and the focus goes back to the row's link, so the card can close.
  // After a click the link shows no focus ring, and the card closes. After
  // a key, the link shows its ring, and the card stays open where it is.
  const goHome = (fromClick = false) => {
    setAt({ x: 0, y: 0 });
    setResting(fromClick);
    handle.current
      ?.closest('li')
      ?.querySelector('a')
      ?.focus({ preventScroll: true });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { x: e.clientX - at.x, y: e.clientY - at.y };
    setDragging(true);
    raise();
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    setAt({ x: e.clientX - grab.current.x, y: e.clientY - grab.current.y });
  };
  const onPointerUp = () => setDragging(false);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? NUDGE_SHIFT : NUDGE;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (e.key === 'Escape' && placed) {
      e.preventDefault();
      goHome();
      return;
    }
    const by = move[e.key];
    if (!by) return;
    e.preventDefault();
    raise();
    setAt((a) => ({ x: a.x + by[0], y: a.y + by[1] }));
  };

  return (
    <span
      className={[
        styles.card,
        placed && styles.placed,
        dragging && styles.dragging,
        resting && styles.resting,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        translate: `${at.x}px ${at.y}px`,
        zIndex: placed ? z : undefined,
      }}
    >
      <button
        ref={handle}
        type="button"
        className={styles.handle}
        aria-label={`Move the ${name} preview. Use the arrow keys, or drag.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <span />
      </button>
      {placed && (
        <button
          type="button"
          className={styles.back}
          aria-label={`Put the ${name} preview back`}
          // detail is 0 for Enter or Space, so only a pointer click rests.
          onClick={(e) => goHome(e.detail > 0)}
        >
          ↩
        </button>
      )}
      <Thumb />
    </span>
  );
};

export { Stamp };

import type {
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
} from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import styles from './stamp.module.css';

/* The stamps on one page share a board. It knows which stamps have moved,
   and "reset all" sends every one of them home. `resets` counts the resets,
   so each stamp sees a new one. */
interface Board {
  moved: number;
  mark: (name: string, moved: boolean) => void;
  resetAll: () => void;
  resets: number;
}

const BoardContext = createContext<Board | null>(null);

const StampBoard: FC<{ children: ReactNode }> = ({ children }) => {
  const [moved, setMoved] = useState<ReadonlySet<string>>(new Set());
  const [resets, setResets] = useState(0);
  const mark = useCallback((name: string, isMoved: boolean) => {
    setMoved((now) => {
      if (now.has(name) === isMoved) return now;
      const next = new Set(now);
      if (isMoved) next.add(name);
      else next.delete(name);
      return next;
    });
  }, []);
  const resetAll = useCallback(() => setResets((n) => n + 1), []);
  const board = useMemo(
    () => ({ moved: moved.size, mark, resetAll, resets }),
    [moved, mark, resetAll, resets],
  );
  return (
    <BoardContext.Provider value={board}>{children}</BoardContext.Provider>
  );
};

/* The icons of the round buttons. They are SVG, not text, so that they sit
   in the middle of the circle. */
const BackIcon: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

const ResetIcon: FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

/* "Reset all": it shows once a stamp has moved, and sends every stamp
   home. Its name is only in its label and tooltip. The focus then goes to
   the first link of its section, as the button goes away. */
const ResetAll: FC<{ className?: string }> = ({ className }) => {
  const board = useContext(BoardContext);
  if (!board?.moved) return null;
  const label = 'Put all the previews back';
  return (
    <button
      type="button"
      className={[styles.round, styles.resetAll, className]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title={label}
      // The tight shader mask, as on the stamps: the glyphs clear only
      // just around the button.
      data-mask="tight"
      onClick={(e) => {
        e.currentTarget
          .closest('section')
          ?.querySelector('a')
          ?.focus({ preventScroll: true });
        board.resetAll();
      }}
    >
      <ResetIcon />
    </button>
  );
};

/* The card that moved last draws over the others. */
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
  const board = useContext(BoardContext);
  const mark = board?.mark;
  const resets = board?.resets ?? 0;

  useEffect(() => {
    mark?.(name, placed);
  }, [mark, name, placed]);

  // A new reset sends this stamp home. The first render sees no new one.
  const seenResets = useRef(resets);
  useEffect(() => {
    if (resets === seenResets.current) return;
    seenResets.current = resets;
    setAt({ x: 0, y: 0 });
  }, [resets]);

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
        aria-label={`Move the ${name} preview with the arrow keys or by dragging`}
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
          className={`${styles.round} ${styles.back}`}
          aria-label={`Put the ${name} preview back`}
          // detail is 0 for Enter or Space, so only a pointer click rests.
          onClick={(e) => goHome(e.detail > 0)}
        >
          <BackIcon />
        </button>
      )}
      <Thumb />
    </span>
  );
};

export { ResetAll, Stamp, StampBoard };

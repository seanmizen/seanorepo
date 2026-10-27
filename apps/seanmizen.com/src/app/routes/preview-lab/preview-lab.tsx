import type {
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Entity,
  EntityList,
  ExternalLink,
  SiteTitle,
  Subtitle,
} from '@/components';
import { cleanUrl, sections } from '@/features/projects/projects';
import listStyles from '@/features/projects/projects.module.css';
import pageStyles from '../projects/projects.module.css';
import styles from './preview-lab.module.css';
import { THUMBS } from './thumbs';

/* A lab for the project previews: the real /projects list, with five ways
   to show a preview of each project. Keys 1 to 5 change the mode. The mode
   is kept in the hash. */

type Mode = 'peek' | 'stage' | 'stamps' | 'unfold' | 'projector';

const MODES: { key: Mode; name: string; when: string }[] = [
  {
    key: 'peek',
    name: 'Peek',
    when: 'On hover. A small card comes out of the row and follows the cursor, a little behind it.',
  },
  {
    key: 'stage',
    name: 'Stage',
    when: 'On hover. A large preview fades into the free right half of the page. Moving between rows crossfades.',
  },
  {
    key: 'stamps',
    name: 'Stamps',
    when: 'Always. A tiny stamp at the end of each row. On hover or focus, it grows to the right. Drag its handle (or arrow keys) to leave it open somewhere; ↩ (or Escape) sends it back.',
  },
  {
    key: 'unfold',
    name: 'Unfold',
    when: 'After a short hover. The row opens downward and shows a wide strip. It closes when you leave.',
  },
  {
    key: 'projector',
    name: 'Projector',
    when: 'Always. The right half shows each project in turn, and the row it shows is lit. Hover takes control.',
  },
];

const readMode = (): Mode => {
  const hash = location.hash.slice(1);
  return MODES.some((m) => m.key === hash) ? (hash as Mode) : 'peek';
};

/* The projects that have a preview, in list order. */
const PREVIEWED = sections
  .flatMap((s) => s.projects)
  .filter((p) => THUMBS[p.href]);

/* Peek: a card that follows the cursor on a spring and leans with its
   speed. It moves through a ref, so React does not render each frame. */
const Peek: FC<{ href: string | null }> = ({ href }) => {
  const card = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  if (href) shown.current = href;

  useEffect(() => {
    const target = { x: 0, y: 0 };
    const at = { x: -1, y: -1 };
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      if (at.x < 0) {
        at.x = target.x;
        at.y = target.y;
      }
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = card.current;
      if (!el) return;
      const dx = target.x - at.x;
      at.x += dx * 0.18;
      at.y += (target.y - at.y) * 0.18;
      const w = el.offsetWidth;
      // Keep the card on the page: it flips to the left of the cursor near
      // the right edge.
      const flip = at.x + 28 + w > innerWidth;
      const x = flip ? at.x - 28 - w : at.x + 28;
      const y = Math.min(at.y + 18, innerHeight - el.offsetHeight - 12);
      const lean = Math.max(-8, Math.min(8, dx * 0.12));
      el.style.transform = `translate(${x}px, ${y}px) rotate(${lean}deg)`;
    };
    window.addEventListener('pointermove', onMove);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  const Thumb = shown.current ? THUMBS[shown.current] : null;
  return (
    <div ref={card} className={styles.peek} aria-hidden="true">
      <div className={`${styles.peekInner} ${href ? styles.on : ''}`}>
        {Thumb && <Thumb />}
      </div>
    </div>
  );
};

/* Stage and projector: every preview sits in the right half. Only the
   active one shows, so a change of row is a crossfade. */
const Stage: FC<{ href: string | null; cycle?: number }> = ({
  href,
  cycle,
}) => {
  const shown = PREVIEWED.find((p) => p.href === href);
  return (
    <div
      className={`${styles.stage} ${href ? styles.on : ''}`}
      aria-hidden="true"
    >
      <div className={styles.stageFrame}>
        {PREVIEWED.map((p) => {
          const Thumb = THUMBS[p.href];
          if (!Thumb) return null;
          return (
            <div
              key={p.href}
              className={`${styles.stageItem} ${p.href === href ? styles.on : ''}`}
            >
              <Thumb />
            </div>
          );
        })}
      </div>
      <div className={styles.caption}>{shown ? cleanUrl(shown.href) : ' '}</div>
      {cycle !== undefined && <div key={cycle} className={styles.progress} />}
    </div>
  );
};

/* The last card that was moved draws over the others. */
let topZ = 10;

/* How far an arrow key moves a card, in CSS pixels. Shift moves it more. */
const NUDGE = 10;
const NUDGE_SHIFT = 40;

/* One stamp. Drag its handle, or focus the handle and press the arrow keys,
   and the card stays where you put it, open, so you can compare two. Once
   it has moved, the back button sends it home. Escape on the handle does
   the same. */
const Stamp: FC<{ name: string; Thumb: FC }> = ({ name, Thumb }) => {
  const [at, setAt] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [z, setZ] = useState<number>();
  const grab = useRef({ x: 0, y: 0 });
  const handle = useRef<HTMLButtonElement>(null);
  const placed = at.x !== 0 || at.y !== 0;

  const raise = () => setZ(++topZ);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
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
      setAt({ x: 0, y: 0 });
      return;
    }
    const by = move[e.key];
    if (!by) return;
    e.preventDefault();
    raise();
    setAt((a) => ({ x: a.x + by[0], y: a.y + by[1] }));
  };

  const goHome = () => {
    setAt({ x: 0, y: 0 });
    handle.current?.focus({ preventScroll: true });
  };

  return (
    <span
      className={[
        styles.card,
        placed && styles.placed,
        dragging && styles.dragging,
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
          onClick={goHome}
        >
          ↩
        </button>
      )}
      <Thumb />
    </span>
  );
};

const PROJECTOR_STEP = 3500;

const PreviewLab: FC = () => {
  const [mode, setMode] = useState<Mode>(readMode);
  const [hovered, setHovered] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [cycle, setCycle] = useState(0);
  const leaveTimer = useRef(0);
  const openTimer = useRef(0);

  const choose = useCallback((m: Mode) => {
    setMode(m);
    history.replaceState(null, '', `#${m}`);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = MODES[Number(e.key) - 1];
      if (m && !e.metaKey && !e.ctrlKey && !e.altKey) choose(m.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose]);

  // The projector moves on by itself while no row is hovered.
  useEffect(() => {
    if (mode !== 'projector' || hovered) return;
    const id = setInterval(() => setCycle((c) => c + 1), PROJECTOR_STEP);
    return () => clearInterval(id);
  }, [mode, hovered]);

  // A short gap between rows must not hide the preview, so leaving waits.
  const enter = (href: string) => {
    clearTimeout(leaveTimer.current);
    clearTimeout(openTimer.current);
    setHovered(href);
    openTimer.current = window.setTimeout(() => setOpen(href), 250);
  };
  const leave = () => {
    clearTimeout(openTimer.current);
    leaveTimer.current = window.setTimeout(() => {
      setHovered(null);
      setOpen(null);
    }, 180);
  };

  const projected = PREVIEWED[cycle % PREVIEWED.length].href;
  const lit = mode === 'projector' ? (hovered ?? projected) : null;

  return (
    <main className="container">
      <div className={pageStyles.half}>
        <SiteTitle path="projects" />
        {sections.map(({ title, projects }) => (
          <section key={title} className={listStyles.section}>
            <Subtitle>{title}</Subtitle>
            <EntityList>
              {projects.map(({ href, blurb, description }) => {
                const Thumb = THUMBS[href];
                const hover = Thumb
                  ? { onMouseEnter: () => enter(href), onMouseLeave: leave }
                  : {};
                return (
                  <Entity
                    key={href}
                    className={[
                      listStyles.row,
                      mode === 'stamps' && styles.stampRow,
                      lit === href && styles.lit,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className={listStyles.name} {...hover}>
                      {href.startsWith('/') ? (
                        <Link to={href}>{cleanUrl(href)}</Link>
                      ) : (
                        <ExternalLink href={href}>
                          {cleanUrl(href)}
                        </ExternalLink>
                      )}
                    </span>
                    {blurb && <span className={listStyles.blurb}>{blurb}</span>}
                    {description && (
                      <p className={listStyles.description}>{description}</p>
                    )}
                    {mode === 'stamps' && (
                      <span className={styles.stamp} {...hover}>
                        {Thumb && <Stamp name={cleanUrl(href)} Thumb={Thumb} />}
                      </span>
                    )}
                    {mode === 'unfold' && Thumb && (
                      <div
                        className={`${styles.unfold} ${open === href ? styles.on : ''}`}
                      >
                        <div className={styles.unfoldInner}>
                          <Thumb />
                        </div>
                      </div>
                    )}
                  </Entity>
                );
              })}
            </EntityList>
          </section>
        ))}
      </div>

      {mode === 'peek' && <Peek href={hovered} />}
      {mode === 'stage' && <Stage href={hovered} />}
      {mode === 'projector' && (
        <Stage href={lit} cycle={hovered ? undefined : cycle} />
      )}

      <aside className={styles.panel}>
        <div className={styles.panelTitle}>preview lab</div>
        {MODES.map((m, k) => (
          <button
            key={m.key}
            type="button"
            className={`${styles.mode} ${m.key === mode ? styles.chosen : ''}`}
            onClick={() => choose(m.key)}
          >
            <b>
              {k + 1}. {m.name}
            </b>
            <span>{m.when}</span>
          </button>
        ))}
        <div className={styles.hint}>
          Keys 1 to 5. Hover the first six rows.
        </div>
      </aside>
    </main>
  );
};

export { PreviewLab };

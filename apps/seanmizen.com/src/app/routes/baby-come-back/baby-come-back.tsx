import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './baby-come-back.module.css';
import { TIMINGS, type Timing, VIDEO_ID } from './timings';

/* The parts of the YouTube IFrame Player API that this page uses. */
type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
};
type YTEvent = { data: number; target: YTPlayer };
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    options: {
      videoId: string;
      width: string;
      height: string;
      playerVars: Record<string, number>;
      events: {
        onReady: () => void;
        onStateChange: (event: YTEvent) => void;
      };
    },
  ) => YTPlayer;
};
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PLAYING = 1;

let api: Promise<YTNamespace> | null = null;
const loadApi = (): Promise<YTNamespace> => {
  api ??= new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.append(script);
  });
  return api;
};

/* iOS ignores setVolume, so two players cannot crossfade there. iPadOS
   reports itself as a Mac, so the touch points tell them apart. */
const IOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

/* The incoming player starts this many seconds early. This covers the
   time that playVideo takes to make sound. */
const LEAD = 0.12;

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

/* The hash holds the current range as start,end,blend, so a tuned loop can
   be shared as a link. */
const readHash = (): Timing | null => {
  const parts = location.hash.slice(1).split(',').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [start, end, blend] = parts;
  if (start < 0 || end <= start || blend < 0) return null;
  return { id: 'custom', label: 'custom', start, end, blend };
};

type Engine = {
  players: (YTPlayer | null)[];
  ready: boolean[];
  priming: boolean[];
  active: 0 | 1;
  fading: boolean;
  timer: number | null;
};

const fmt = (n: number) => n.toFixed(2);

const BabyComeBack: FC = () => {
  const [timing, setTiming] = useState<Timing>(() => readHash() ?? TIMINGS[0]);
  const [single, setSingle] = useState(IOS);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);

  const timingRef = useRef(timing);
  timingRef.current = timing;
  const singleRef = useRef(single);
  singleRef.current = single;

  const hosts = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const clock = useRef<HTMLSpanElement>(null);
  const engine = useRef<Engine>({
    players: [null, null],
    ready: [false, false],
    priming: [false, false],
    active: 0,
    fading: false,
    timer: null,
  });

  const lead = (t: Timing) => Math.max(0, t.start - t.blend / 2);

  const tick = () => {
    const e = engine.current;
    const t = timingRef.current;
    const a = e.players[e.active];
    const b = e.players[1 - e.active];
    if (!a || !b) return;
    const now = a.getCurrentTime();
    if (clock.current) clock.current.textContent = fmt(now);

    // Someone tapped the video itself, or seeked out of the range.
    if (!e.fading && (now < t.start - t.blend - 1 || now > t.end + 1)) {
      a.seekTo(t.start, true);
      return;
    }

    if (singleRef.current) {
      if (now >= t.end) a.seekTo(t.start, true);
      return;
    }

    const fadeStart = t.end - t.blend / 2;
    if (!e.fading && now >= fadeStart - LEAD) {
      b.unMute();
      b.setVolume(0);
      b.playVideo();
      e.fading = true;
    }
    if (!e.fading) return;

    const x =
      t.blend > 0
        ? clamp((now - fadeStart) / t.blend, 0, 1)
        : now >= t.end
          ? 1
          : 0;
    a.setVolume(Math.round(Math.cos((x * Math.PI) / 2) * 100));
    b.setVolume(Math.round(Math.sin((x * Math.PI) / 2) * 100));
    if (x < 1) return;

    e.fading = false;
    if (b.getPlayerState() !== PLAYING) {
      // The browser did not let the second player start. Fall back to a
      // hard loop on one player, so the music does not stop.
      b.pauseVideo();
      a.setVolume(100);
      a.seekTo(t.start, true);
      setSingle(true);
      return;
    }
    a.pauseVideo();
    a.setVolume(0);
    a.seekTo(lead(t), true);
    e.active = e.active === 0 ? 1 : 0;
  };

  const startTimer = () => {
    const e = engine.current;
    if (e.timer === null) e.timer = window.setInterval(tick, 20);
  };

  const stop = () => {
    const e = engine.current;
    if (e.timer !== null) window.clearInterval(e.timer);
    e.timer = null;
    e.fading = false;
    for (const p of e.players) p?.pauseVideo();
    setPlaying(false);
  };

  // Call only from a click, so the browser lets both players make sound.
  const play = (t: Timing) => {
    const e = engine.current;
    const [a, b] = e.players;
    if (!a || !b || !e.ready[0] || !e.ready[1]) return;
    timingRef.current = t;
    e.fading = false;
    e.active = 0;
    b.pauseVideo();
    a.unMute();
    a.setVolume(100);
    a.seekTo(t.start, true);
    a.playVideo();
    if (!singleRef.current) {
      // Start the second player muted inside this click, then park it at
      // the loop start. It then has permission to play later.
      e.priming[1] = true;
      b.mute();
      b.seekTo(lead(t), true);
      b.playVideo();
    }
    startTimer();
    setPlaying(true);
  };

  const choose = (t: Timing) => {
    setTiming(t);
    play(t);
  };

  const edit = (field: 'start' | 'end' | 'blend', value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    const next = { ...timing, id: 'custom', label: 'custom', [field]: n };
    if (next.end <= next.start) return;
    setTiming(next);
    // Park the waiting player at the new start.
    const e = engine.current;
    const waiting = e.players[1 - e.active];
    if (waiting && !e.fading && !e.priming[1 - e.active]) {
      waiting.seekTo(lead(next), true);
    }
  };

  useEffect(() => {
    history.replaceState(
      null,
      '',
      `#${timing.start},${timing.end},${timing.blend}`,
    );
  }, [timing]);

  useEffect(() => {
    document.title = 'baby come back';
  }, []);

  useEffect(() => {
    let cancelled = false;
    const e = engine.current;
    loadApi().then((YT) => {
      if (cancelled) return;
      hosts.forEach((host, i) => {
        if (!host.current) return;
        const el = document.createElement('div');
        host.current.replaceChildren(el);
        e.players[i] = new YT.Player(el, {
          videoId: VIDEO_ID,
          width: '100%',
          height: '100%',
          playerVars: {
            start: Math.floor(timingRef.current.start),
            playsinline: 1,
            rel: 0,
            controls: 1,
          },
          events: {
            onReady: () => {
              e.ready[i] = true;
              if (e.ready[0] && e.ready[1]) setReady(true);
            },
            onStateChange: ({ data, target }) => {
              if (data !== PLAYING) return;
              if (e.priming[i]) {
                e.priming[i] = false;
                const incoming = e.fading && e.active !== i;
                if (!incoming) {
                  target.pauseVideo();
                  target.seekTo(lead(timingRef.current), true);
                  target.setVolume(0);
                }
                target.unMute();
                return;
              }
              // A tap on the video itself starts the loop too.
              if (i === e.active) {
                startTimer();
                setPlaying(true);
              }
            },
          },
        });
      });
    });
    return () => {
      cancelled = true;
      if (e.timer !== null) window.clearInterval(e.timer);
      e.timer = null;
      for (const p of e.players) p?.destroy();
      e.players = [null, null];
      e.ready = [false, false];
      setReady(false);
    };
  }, []);

  const same = (t: Timing) =>
    t.start === timing.start &&
    t.end === timing.end &&
    t.blend === timing.blend;

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>baby come back</h1>

      <button
        type="button"
        className={styles.play}
        disabled={!ready}
        onClick={() => (playing ? stop() : play(timing))}
      >
        {!ready ? 'loading…' : playing ? '■ stop' : '▶ baby come back'}
      </button>

      <p className={styles.now}>
        {timing.label} · {fmt(timing.start)} → {fmt(timing.end)} · blend{' '}
        {timing.blend}s · at <span ref={clock}>–</span>
      </p>

      <ul className={styles.presets}>
        {TIMINGS.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className={same(t) ? styles.chosen : undefined}
              disabled={!ready}
              onClick={() => choose(t)}
            >
              <span>{t.label}</span>
              <small>
                {fmt(t.start)} → {fmt(t.end)} · {t.blend}s
              </small>
            </button>
          </li>
        ))}
      </ul>

      <fieldset className={styles.tune}>
        <legend>tune</legend>
        {(['start', 'end', 'blend'] as const).map((field) => (
          <label key={field}>
            {field}
            <input
              type="number"
              inputMode="decimal"
              step={0.01}
              min={0}
              value={timing[field]}
              onChange={(ev) => edit(field, ev.target.value)}
            />
          </label>
        ))}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={single}
            onChange={(ev) => {
              stop();
              setSingle(ev.target.checked);
            }}
          />
          one player, hard loop{IOS ? ' (iOS cannot crossfade)' : ''}
        </label>
      </fieldset>

      <div className={styles.players}>
        <div className={styles.player} ref={hosts[0]} />
        <div className={styles.player} ref={hosts[1]} hidden={single} />
      </div>

      <p className={styles.credit}>
        Player, "Baby Come Back" (1977). Played from the official PlayerVEVO
        upload. <Link to="/">seanmizen.com</Link>
      </p>
    </main>
  );
};

export { BabyComeBack };

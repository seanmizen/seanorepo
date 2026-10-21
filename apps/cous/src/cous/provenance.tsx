import type { FC } from 'react';
import cat1Url from './assets/cous/cat-1.png';
import cat2Url from './assets/cous/cat-2.png';
import cousBlinkUrl from './assets/cous/cous-blink.png';
import cousCrashUrl from './assets/cous/cous-crash.png';
import cousJumpUrl from './assets/cous/cous-jump.png';
import cousRun1Url from './assets/cous/cous-run-1.png';
import cousRun2Url from './assets/cous/cous-run-2.png';
import cousSupermanUrl from './assets/cous/cous-superman.png';
import cousTreeUrl from './assets/cous/cous-tree.png';
import cousWashingMachineUrl from './assets/cous/cous-washing-machine.png';
import shelfUrl from './assets/sources/shelf.jpg';
import shockedUrl from './assets/sources/shocked.jpg';
import supermanUrl from './assets/sources/superman.jpg';
import treeUrl from './assets/sources/tree.jpg';
import walk00Url from './assets/sources/walk-0.0s.jpg';
import walk11Url from './assets/sources/walk-1.1s.jpg';
import washingMachineUrl from './assets/sources/washing-machine.jpg';
import windowLedgeUrl from './assets/sources/window-ledge.jpg';
import styles from './provenance.module.css';

/** One source image and the sprites made from it. */
type Source = {
  /** The sprite (or sprites) that the source became. Used in alt text. */
  sprite: string;
  source: string;
  /** The images that the game draws. */
  results: string[];
};

// Add an entry here for every new source image. See the README.
const SOURCES: Source[] = [
  { sprite: 'run, frame 1', source: walk00Url, results: [cousRun1Url] },
  { sprite: 'run, frame 2', source: walk11Url, results: [cousRun2Url] },
  { sprite: 'jump', source: windowLedgeUrl, results: [cousJumpUrl] },
  // Sean made the crouch frames (first cous sheet) from this photo too.
  {
    sprite: 'superman jump and crouch',
    source: supermanUrl,
    results: [cousSupermanUrl, cat1Url, cat2Url],
  },
  { sprite: 'blink', source: shelfUrl, results: [cousBlinkUrl] },
  // The app icon (public/icons) is a square crop of the same photo.
  {
    sprite: 'crash and app icon',
    source: shockedUrl,
    results: [cousCrashUrl, '/icons/icon-192.png'],
  },
  {
    sprite: 'restart',
    source: washingMachineUrl,
    results: [cousWashingMachineUrl],
  },
  { sprite: 'tree', source: treeUrl, results: [cousTreeUrl] },
];

/**
 * The source images of the cous sprites, beside the sprites made from
 * them. It shows where every image of Cous comes from.
 */
const Provenance: FC = () => (
  <details className={styles.provenance}>
    <summary>where the sprites come from</summary>
    <p className={styles.intro}>
      Every image of Cous is a real photo or video frame. The processing is a
      subject mask (the macOS Vision framework, scripts/lift.swift) or a colour
      key on blue sky (scripts/skykey.py), crops, flips, rotations, resizing and
      the leg swing. No image is generated. The source images have no metadata.
    </p>
    <ul className={styles.items}>
      {SOURCES.map((s) => (
        <li key={s.sprite} className={styles.pair}>
          <img
            className={styles.source}
            src={s.source}
            alt={`Source for the ${s.sprite} sprite`}
            loading="lazy"
          />
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
          <div className={styles.results}>
            {s.results.map((r) => (
              <img
                key={r}
                src={r}
                alt={`The ${s.sprite} sprite`}
                loading="lazy"
              />
            ))}
          </div>
        </li>
      ))}
    </ul>
  </details>
);

export { Provenance };

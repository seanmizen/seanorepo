import type { FC } from 'react';
import cousBlinkUrl from './assets/cous/cous-blink.png';
import cousCrashUrl from './assets/cous/cous-crash.png';
import cousDuckUrl from './assets/cous/cous-duck.png';
import cousJumpUrl from './assets/cous/cous-jump.png';
import cousRun1Url from './assets/cous/cous-run-1.png';
import cousRun2Url from './assets/cous/cous-run-2.png';
import palmLarge1Url from './assets/cous/palm-large-1.png';
import palmSmall1Url from './assets/cous/palm-small-1.png';
import cousSheetUrl from './assets/cous-200-1.png';
import shelfUrl from './assets/sources/shelf.jpg';
import shockedUrl from './assets/sources/shocked.jpg';
import stretchUrl from './assets/sources/stretch.jpg';
import walk00Url from './assets/sources/walk-0.0s.jpg';
import walk11Url from './assets/sources/walk-1.1s.jpg';
import windowLedgeUrl from './assets/sources/window-ledge.jpg';
import styles from './provenance.module.css';

/** One source image and the sprites made from it. */
type Source = {
  /** The sprite (or sprites) that the source became. */
  sprite: string;
  source: string;
  /** The images that the game draws. */
  results: string[];
  /** What was done to the source, in order. */
  steps: string;
};

// Add an entry here for every new source image. See the README.
const SOURCES: Source[] = [
  {
    sprite: 'run, frame 1 (and idle)',
    source: walk00Url,
    results: [cousRun1Url],
    steps:
      'Frame at 0.0 s of a video. Subject mask, legs swung 10° (scripts/legs.py), resized.',
  },
  {
    sprite: 'run, frame 2',
    source: walk11Url,
    results: [cousRun2Url],
    steps:
      'Frame at 1.1 s of the same video. Subject mask, legs swung 10° the other way, resized.',
  },
  {
    sprite: 'jump',
    source: windowLedgeUrl,
    results: [cousJumpUrl],
    steps: 'Subject mask, flipped, resized.',
  },
  {
    sprite: 'duck',
    source: stretchUrl,
    results: [cousDuckUrl],
    steps: 'Subject mask, rotated 57°, resized.',
  },
  {
    sprite: 'blink',
    source: shelfUrl,
    results: [cousBlinkUrl],
    steps: 'Subject mask, flipped, resized.',
  },
  {
    sprite: 'crash',
    source: shockedUrl,
    results: [cousCrashUrl],
    steps: 'Subject mask, resized.',
  },
  {
    sprite: 'palm trees',
    source: cousSheetUrl,
    results: [palmSmall1Url, palmLarge1Url],
    steps:
      'Cut from the first cous sprite sheet, one palm per cell. 12 palms in total.',
  },
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
      subject mask (the macOS Vision framework, scripts/lift.swift), flips,
      rotations, resizing and the leg swing. No image is generated. The source
      images have no metadata.
    </p>
    <ul className={styles.items}>
      {SOURCES.map((s) => (
        <li key={s.sprite}>
          <figure className={styles.figure}>
            <div className={styles.pair}>
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
            </div>
            <figcaption>
              <strong>{s.sprite}</strong>: {s.steps}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  </details>
);

export { Provenance };

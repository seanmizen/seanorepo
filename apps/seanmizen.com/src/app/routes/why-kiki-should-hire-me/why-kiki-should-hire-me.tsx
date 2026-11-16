import type { FC } from 'react';
import { SiteTitle } from '@/components';
import styles from './why-kiki-should-hire-me.module.css';

/* robots.txt keeps crawlers out of /why-kiki/: the CV has a phone number. */
const CV = '/why-kiki/Sean-Mizen-Engineer-CV-2026-09-18.pdf';

/*
  Three artefacts, each with a caption, and then Sean's blurb. The blurb is
  handwritten. Keep its words as Sean wrote them.
*/
const WhyKikiShouldHireMe: FC = () => (
  <main className="container">
    <div className={styles.half}>
      <SiteTitle path="why-kiki-should-hire-me" />

      <figure className={styles.artefact}>
        <div className={styles.pair}>
          <video
            className={`${styles.media} ${styles.wide}`}
            src="/why-kiki/timelapse.mp4"
            poster="/why-kiki/timelapse.jpg"
            width={720}
            height={700}
            autoPlay
            muted
            loop
            playsInline
            controls
            preload="metadata"
          >
            <a href="/why-kiki/timelapse.mp4">The first timelapse (MP4)</a>
          </video>
          <video
            className={`${styles.media} ${styles.tall}`}
            src="/why-kiki/timelapse-2.mp4"
            poster="/why-kiki/timelapse-2.jpg"
            width={540}
            height={960}
            autoPlay
            muted
            loop
            playsInline
            controls
            preload="metadata"
          >
            <a href="/why-kiki/timelapse-2.mp4">The second timelapse (MP4)</a>
          </video>
        </div>
        <figcaption>He loves hard work and a timelapse.</figcaption>
      </figure>

      {/* The Expo timelapse app goes here when it is live. */}
      <figure className={styles.artefact}>
        <div className={styles.placeholder}>A React Native app. Soon.</div>
        <figcaption>He can ship fast.</figcaption>
      </figure>

      {/* The third artefact is not chosen yet. */}
      <figure className={styles.artefact}>
        <div className={styles.placeholder}>Another artefact. Soon.</div>
        <figcaption>He has taste.</figcaption>
      </figure>

      <section className={styles.blurb}>
        <p>
          Hi, I’m Sean, 29. 5th generation Londoner, but don’t think that makes
          me un-adventurous.
        </p>
        <p>
          The Kiki mission looks pretty cool.
          <br />
          The Team looks pretty cool.
          <br />
          And I love a bit of optimism.
        </p>
        <p>
          Thanks to AI I’m a polyglot. I use Go, Zig apps daily which I built
          from scratch. I don’t know Go or Zig! But in many ways, today, I do.
        </p>
        <p>
          I have corporate experience and startup experience. Much, much more
          keen for the startup world today. I've seen the highs and lows of
          both!
        </p>
        <p>
          I’d love you to know this blurb is handwritten. Written on a pretty
          packed District Line train on a wet Sunday.
        </p>
      </section>

      <p className={styles.cv}>
        <a href={CV} target="_blank" rel="noopener">
          My CV<span className="sr-only"> (opens in a new tab)</span>
        </a>{' '}
        (PDF, 2 pages) <span aria-hidden="true">↗</span>
      </p>
    </div>
  </main>
);

export { WhyKikiShouldHireMe };

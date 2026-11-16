import type { FC } from 'react';
import { ExternalLink, SiteTitle } from '@/components';
import styles from './why-kiki-should-hire-me.module.css';

/* robots.txt keeps crawlers out of /why-kiki/: the CV has a phone number. */
const CV = '/why-kiki/Sean-Mizen-Engineer-CV-2026-09-18.pdf';

/* The default Lisbon run of thirty. ?embed makes thirty show the map only. */
const THIRTY = 'https://thirty.seanmizen.com/?city=lisbon';

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
        <div className={styles.placeholder}>
          A React Native app I'm building right this second. You caught me
          off-guard. Check back in at 4pm-4:30 and it'll be here
        </div>
        <figcaption>He can ship fast.</figcaption>
      </figure>

      {/*
        The live thirty run. The frame takes no pointer events, so the map
        cannot catch the page scroll. The link around it opens the full page.
      */}
      <figure className={styles.artefact}>
        <a
          className={styles.map}
          href={THIRTY}
          target="_blank"
          rel="noopener noreferrer"
        >
          <iframe
            src={`${THIRTY}&embed`}
            title="thirty: the Lisbon run"
            loading="lazy"
            tabIndex={-1}
            aria-hidden="true"
          />
          <span className="sr-only">
            The Lisbon run on thirty.seanmizen.com (opens in a new tab)
          </span>
        </a>
        <figcaption>
          <p className={styles.note}>
            <ExternalLink href={THIRTY}>thirty.seanmizen.com</ExternalLink> - a
            transit network optimiser built for the web. looks very cool.
          </p>
          He has taste.
        </figcaption>
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
          from scratch. I don’t know Go or Zig! But today that does not matter.
          You choose the best tool for the job, and ask the computer to make it
          so. My role - our role - in the post-AI world is <em>discretion</em>.
          When to say <em>no</em>.
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

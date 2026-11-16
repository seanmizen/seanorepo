import type { FC } from 'react';
import { useState } from 'react';
import { ExternalLink, SiteTitle } from '@/components';
import styles from './why-kiki-should-hire-me.module.css';

/* robots.txt keeps crawlers out of /why-kiki/: the CV has a phone number. */
const CV = '/why-kiki/Sean-Mizen-Engineer-CV-2026-09-18.pdf';

/*
  The default Lisbon run of thirty. ?embed makes thirty show the map only.
  The dev build frames the local thirty (`yarn workspace thirty start`), so a
  change to thirty shows before a release.
*/
const THIRTY = 'https://thirty.seanmizen.com/?city=lisbon';
const THIRTY_EMBED = `${
  import.meta.env.DEV ? 'http://localhost:4110' : 'https://thirty.seanmizen.com'
}/?city=lisbon&embed`;

/*
  The timelapse app (apps/timelapse). The dev build frames the local Expo web
  server (`yarn workspace timelapse web`).
*/
const TIMELAPSE = 'https://timelapse.seanmizen.com';
const TIMELAPSE_FRAME = import.meta.env.DEV
  ? 'http://localhost:8081'
  : TIMELAPSE;

/*
  The app asks for the webcam as soon as it loads. So the frame loads only
  when the reader clicks, and the camera prompt never comes as a surprise.
  The frame takes the focus, because the button it replaces had it.
*/
const TimelapseApp: FC = () => {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        className={styles.launch}
        onClick={() => setOpen(true)}
      >
        Open the timelapse app here. It asks for your camera.
      </button>
    );
  return (
    <iframe
      ref={(frame) => frame?.focus()}
      className={styles.app}
      src={TIMELAPSE_FRAME}
      title="The timelapse app"
      allow="camera"
    />
  );
};

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

      <figure className={styles.artefact}>
        <TimelapseApp />
        <figcaption>
          He can ship fast.{' '}
          <span className={styles.note}>
            (
            <ExternalLink href={TIMELAPSE}>
              timelapse.seanmizen.com
            </ExternalLink>
            )
          </span>
        </figcaption>
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
            src={THIRTY_EMBED}
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
          He has taste.{' '}
          <span className={styles.note}>
            (<ExternalLink href={THIRTY}>thirty.seanmizen.com</ExternalLink> - a
            transit network optimiser built for the web. looks very cool.)
          </span>
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
          <br />I love a bit of optimism.
          <br />
          And I, too, am shocked that Robert Pattinson is the next Bond.
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
          packed District Line train on a wet Sunday. Except the Robert
          Pattinson bit, that was today, Monday
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

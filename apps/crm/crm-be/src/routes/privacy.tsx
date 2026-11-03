import type { FastifyInstance } from 'fastify';
import { PRIVACY_UPDATED, PrivacyNotice } from '../content/privacy';
import { demoLoginOn } from '../demo';
import { type PageParts, renderPage } from '../render';
import { When } from '../ui/When';

/** The line on the notice of the demo (`demo.ts`). */
export const DEMO_PRIVACY_TEXT = 'All the data in this demo is fictional.';

/**
 * The privacy notice: the date of the last change (REQ-CRM-DATE-001), then
 * each section of `content/privacy.tsx` as a box. The demo shows the same
 * notice, and one more line: all the demo data is fictional.
 */
export const privacyPage = (): PageParts => ({
  title: 'Privacy notice',
  intro: (
    <>
      Last updated <When value={PRIVACY_UPDATED} />.
    </>
  ),
  help: demoLoginOn() ? <p>{DEMO_PRIVACY_TEXT}</p> : undefined,
  boxes: <PrivacyNotice />,
});

/**
 * `GET /privacy`. Open to everyone, signed in or not (`PUBLIC_PATHS` in
 * `auth.ts`). `seanmizen.com/privacy` sends a visitor here
 * (`infra/cloudflare/seanmizen_com.tf`).
 */
export const privacyRoute = (app: FastifyInstance) => {
  app.get('/privacy', async (request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(renderPage(request, privacyPage())),
  );
};

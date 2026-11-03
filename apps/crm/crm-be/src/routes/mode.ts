import type { FastifyInstance } from 'fastify';
import { safeNext } from '../auth';
import { isMode, MODE_COOKIE } from '../render';

/** The mode cookie lasts one year. */
const MODE_SECONDS = 365 * 24 * 60 * 60;

/**
 * `POST /mode` (`mode=auto|light|dark`, `next=<path>`). The mode stepper in
 * the footer of each page sends it. It keeps the mode in a cookie, then
 * opens `next` again. `auto` clears the cookie, so the page follows the
 * system. A signed-out visitor can use it, because the sign-in pages have
 * the footer too.
 */
export const modeRoute = (app: FastifyInstance) => {
  app.post<{ Body: { mode?: string; next?: string } }>(
    '/mode',
    async (request, reply) => {
      const mode = request.body?.mode;
      if (!isMode(mode)) {
        return reply
          .code(400)
          .type('text/plain')
          .send('Bad request: mode must be auto, light or dark.');
      }
      if (mode === 'auto') {
        reply.clearCookie(MODE_COOKIE, { path: '/' });
      } else {
        reply.setCookie(MODE_COOKIE, mode, {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: MODE_SECONDS,
        });
      }
      return reply.redirect(safeNext(request.body?.next), 303);
    },
  );
};

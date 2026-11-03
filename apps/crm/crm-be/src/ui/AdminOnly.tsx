import type { FastifyRequest } from 'fastify';
import { renderPage } from '../render';
import { Panel } from './Panel';

/**
 * The 403 page of an admin route. The hook in `auth.ts` sends it when the
 * session is not the admin in a passkey session.
 */
export const AdminOnly = () => (
  <Panel label="Admin only">
    <p role="alert">
      This page is for the admin, signed in with a passkey. A sign-in with an
      email link or a code does not open it.
    </p>
    <ul>
      <li>
        <a href="/login">Sign in with a passkey</a>
      </li>
      <li>
        <a href="/account/passkeys">Your passkeys</a>
      </li>
    </ul>
  </Panel>
);

/** The full HTML of the 403 page. */
export const renderAdminOnly = (request: FastifyRequest) =>
  renderPage('Admin only', <AdminOnly />, request);

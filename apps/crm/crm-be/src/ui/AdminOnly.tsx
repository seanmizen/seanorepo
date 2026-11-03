import type { FastifyRequest } from 'fastify';
import { renderPage } from '../render';
import { Panel } from './Panel';
import { AddPasskey, PasskeySignIn } from './Passkey';

/**
 * What a session needs to open an admin route:
 * - `add-passkey`: the admin has no passkey. Adding the first one makes this
 *   session a passkey session.
 * - `passkey-sign-in`: the admin has a passkey, but this session did not
 *   start with one.
 * - `admin`: the person is not the admin.
 */
export type AdminNeed = 'add-passkey' | 'passkey-sign-in' | 'admin';

/**
 * The 403 page of an admin route. The hook in `auth.ts` sends it at the URL
 * that the person asked for, with no redirect. It tells the person why the
 * page does not open and, for the admin, holds the passkey step. After the
 * step, the passkey script opens `next` again.
 */
export const AdminOnly = ({
  need,
  next,
}: {
  need: AdminNeed;
  next: string;
}) => {
  if (need === 'add-passkey') {
    return (
      <Panel label="Passkey needed">
        <p role="alert">This page needs a passkey. Add one to this device.</p>
        <AddPasskey next={next} />
      </Panel>
    );
  }
  if (need === 'passkey-sign-in') {
    return (
      <Panel label="Passkey needed">
        <p role="alert">This page needs a passkey sign-in.</p>
        <PasskeySignIn
          next={next}
          note="Passkeys need JavaScript. Turn on JavaScript to sign in with a passkey."
        />
      </Panel>
    );
  }
  return (
    <Panel label="Admin only">
      <p role="alert">This page is for the admin only.</p>
      <p>
        <a href="/account/sessions">Sessions</a>
      </p>
    </Panel>
  );
};

/**
 * The full HTML of the 403 page. The passkey steps load the passkey script.
 * After the step, the script opens the same URL (for a GET), or `/`.
 */
export const renderAdminOnly = (request: FastifyRequest, need: AdminNeed) => {
  const next = request.method === 'GET' ? request.url : '/';
  return renderPage(
    need === 'admin' ? 'Admin only' : 'Passkey needed',
    <AdminOnly need={need} next={next} />,
    request,
    need === 'admin' ? [] : ['passkeys'],
  );
};

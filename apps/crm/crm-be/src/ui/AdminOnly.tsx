import type { FastifyRequest } from 'fastify';
import { type PageParts, renderPage } from '../render';
import { Device } from './Device';
import { Lcd } from './Lcd';
import { Module } from './Module';
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
 * that the person asked for, with no redirect. For the admin, the LCD tells
 * why the page does not open, and the device holds the passkey step. After
 * the step, the passkey script opens `next` again. Each other person gets
 * one line of text, and no device.
 */
export const adminOnlyPage = (need: AdminNeed, next: string): PageParts => {
  if (need === 'add-passkey') {
    return {
      title: 'Passkey needed',
      device: (
        <Device>
          <Lcd alert="This page needs a passkey. Add one to this device." />
          <Module label="Add a passkey">
            <AddPasskey next={next} />
          </Module>
        </Device>
      ),
      entries: ['passkeys'],
    };
  }
  if (need === 'passkey-sign-in') {
    return {
      title: 'Passkey needed',
      device: (
        <Device>
          <Lcd alert="This page needs a passkey sign-in." />
          <Module label="Passkey">
            <PasskeySignIn
              next={next}
              note="Passkeys need JavaScript. Turn on JavaScript to sign in with a passkey."
            />
          </Module>
        </Device>
      ),
      entries: ['passkeys'],
    };
  }
  return {
    title: 'Admin only',
    intro: <span role="alert">This page is for the admin only.</span>,
  };
};

/**
 * The full HTML of the 403 page. The passkey steps load the passkey script.
 * After the step, the script opens the same URL (for a GET), or `/`.
 */
export const renderAdminOnly = (request: FastifyRequest, need: AdminNeed) =>
  renderPage(
    request,
    adminOnlyPage(need, request.method === 'GET' ? request.url : '/'),
  );

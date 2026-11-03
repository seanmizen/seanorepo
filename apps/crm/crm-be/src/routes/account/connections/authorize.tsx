import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../../../auth';
import {
  AUTHORIZE_PATH,
  type AuthorizeRequest,
  checkAuthorize,
  denyUrl,
  grantCode,
} from '../../../oauth';
import { formText } from '../../../org';
import { type PageParts, renderPage } from '../../../render';
import { Box } from '../../../ui/Box';
import { Device } from '../../../ui/Device';
import { Key, Keys } from '../../../ui/Key';
import { Lcd } from '../../../ui/Lcd';
import { Module } from '../../../ui/Module';

/**
 * The host that the app returns to, as the page shows it. A loopback
 * address is an app on this computer, for example Claude Code: any program
 * on the computer can open that port, so the page says so.
 */
const returnsTo = (redirectUri: string) => {
  const { hostname } = new URL(redirectUri);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    ? `${hostname} (a program on this computer)`
    : hostname;
};

/** Why Allow and Deny cannot act when there is no request. */
const NOT_VALID = 'The app did not send a valid request.';

/**
 * The consent page of the OAuth flow (`oauth.ts`): an app, for example
 * Claude, asks to connect to the crm. The admin, in a passkey session, taps
 * Allow or Deny. The LCD shows the app and the host that it returns to.
 * The form sends the values of the request again, as hidden fields, and
 * the post checks them again. A request that is not valid shows its error
 * in the LCD, and Allow and Deny are off, with the error as their reason
 * (REQ-CRM-BUTTON-001).
 */
export const authorizePage = ({
  authorize,
  error,
}: {
  authorize?: AuthorizeRequest;
  error?: string;
}): PageParts => ({
  title: 'Connect an app',
  intro: authorize
    ? `${authorize.clientName} asks to read and change the data of the crm.`
    : undefined,
  device: (
    <Device>
      <Lcd
        alert={error}
        rows={
          authorize
            ? [
                { label: 'App', value: authorize.clientName },
                {
                  label: 'Returns to',
                  value: returnsTo(authorize.redirectUri),
                },
              ]
            : undefined
        }
      />
      <form method="post" action={AUTHORIZE_PATH}>
        {authorize &&
          Object.entries({
            response_type: 'code',
            client_id: authorize.clientId,
            redirect_uri: authorize.redirectUri,
            code_challenge: authorize.codeChallenge,
            code_challenge_method: 'S256',
            state: authorize.state,
            resource: authorize.resource,
          })
            .filter(([, value]) => value !== '')
            .map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
        <Module label="Connect">
          <Keys>
            <Key
              id="allow"
              name="decision"
              value="allow"
              off={authorize ? undefined : (error ?? NOT_VALID)}
            >
              Allow
            </Key>
            <Key
              id="deny"
              name="decision"
              value="deny"
              off={authorize ? undefined : (error ?? NOT_VALID)}
            >
              Deny
            </Key>
          </Keys>
        </Module>
      </form>
    </Device>
  ),
  boxes: authorize && (
    <Box title="Access">
      <ul>
        <li>It can read the organisations, the contacts and the activity.</li>
        <li>It can add them and change them.</li>
        <li>It cannot delete, erase or take a payment.</li>
      </ul>
      <p>
        Tap Allow only if you added this connection in the app just now. A link
        from a different person can open this page for their app.
      </p>
      <p>
        To stop it, revoke it on <a href="/account/connections">connections</a>.
      </p>
    </Box>
  ),
});

/**
 * Send the consent page. No other site can show it in a frame, so no
 * other site can put a tap on Allow under its own page.
 */
const sendConsent = (
  request: FastifyRequest,
  reply: FastifyReply,
  props: Parameters<typeof authorizePage>[0],
) =>
  reply
    .code(props.error ? 400 : 200)
    .header('x-frame-options', 'DENY')
    .header('content-security-policy', "frame-ancestors 'none'")
    .type('text/html; charset=utf-8')
    .send(renderPage(request, authorizePage(props)));

/**
 * `GET` and `POST /account/connections/authorize`: an admin route, so only
 * the admin in a passkey session opens it. A signed-out visitor signs in
 * first and comes back to the same URL (`auth.ts`).
 */
export const accountConnectionsAuthorizeRoute = (
  app: FastifyInstance,
  db: Database,
) => {
  /** Send the error page or the error redirect, or return the request. */
  const check = (
    request: FastifyRequest,
    reply: FastifyReply,
    params: unknown,
  ) => {
    const result = checkAuthorize(db, params);
    if ('redirect' in result) return reply.redirect(result.redirect, 303);
    if ('error' in result) {
      return sendConsent(request, reply, { error: result.error });
    }
    return result.ok;
  };

  app.get(
    AUTHORIZE_PATH,
    { config: { admin: true } },
    async (request, reply) => {
      const authorize = check(request, reply, request.query);
      if (!('clientId' in authorize)) return authorize;
      return sendConsent(request, reply, { authorize });
    },
  );

  app.post<{ Body: Record<string, string> }>(
    AUTHORIZE_PATH,
    { config: { admin: true } },
    async (request, reply) => {
      const authorize = check(request, reply, request.body);
      if (!('clientId' in authorize)) return authorize;
      const url =
        formText(request.body?.decision) === 'allow'
          ? grantCode(db, (request.auth as Auth).personId, authorize)
          : denyUrl(authorize);
      return reply.redirect(url, 303);
    },
  );
};

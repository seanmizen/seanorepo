import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import {
  CustomOAuthError,
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidTargetError,
  OAuthError,
  TooManyRequestsError,
  UnsupportedGrantTypeError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {
  type OAuthClientInformationFull,
  OAuthClientMetadataSchema,
  type OAuthMetadata,
  type OAuthProtectedResourceMetadata,
  type OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  audit,
  hash,
  isAdminEmail,
  later,
  newToken,
  now,
  PUBLIC_URL,
  rateLimiter,
} from './auth';
import { formText } from './org';

/**
 * The connections of the MCP server (`mcp.ts`): personal access tokens for
 * Claude Code, and OAuth 2.1 for the Claude apps (claude.ai, desktop and
 * phone). Each token that `/api/mcp` takes is a row of `connection`.
 * `/account/connections` lists them and revokes them.
 *
 * The OAuth part follows the MCP authorization spec. The crm is the
 * resource server and the authorization server:
 *
 * 1. `/api/mcp` answers a request with no valid token with 401, and its
 *    `WWW-Authenticate` header names the protected resource metadata
 *    (RFC 9728).
 * 2. The metadata names this site as the authorization server. Its own
 *    metadata (RFC 8414) names the endpoints below.
 * 3. The client registers itself (RFC 7591). Each client is public: it has
 *    no secret, and PKCE (S256) protects its code.
 * 4. The authorize page is a crm page: the admin, in a passkey session,
 *    taps Allow (`routes/account/connections/authorize.tsx`).
 * 5. The token endpoint gives an access token for 1 hour and a refresh
 *    token. Each refresh gives a new refresh token, and the old one stops.
 *
 * The SDK gives the metadata types, the client metadata schema, the error
 * classes and the resource check. Its router is for Express, so the routes
 * are here, for Fastify.
 */

/** The MCP endpoint (`routes/api/mcp.ts`). */
export const MCP_PATH = '/api/mcp';

/** The URL of the MCP server: the resource that each token is for. */
export const MCP_URL = `${PUBLIC_URL}${MCP_PATH}`;

/** The authorize page, under the connections page. */
export const AUTHORIZE_PATH = '/account/connections/authorize';

const TOKEN_PATH = '/api/oauth/token';
const REGISTER_PATH = '/api/oauth/register';

/** The protected resource metadata of MCP_URL (RFC 9728). */
const RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;

/** An access token works for this long. */
const ACCESS_SECONDS = 60 * 60;
/** A refresh token works for this long after the token endpoint gives it. */
const REFRESH_DAYS = 90;
/** An authorization code works one time, for this long. */
const CODE_MINUTES = 5;
/**
 * A registration deletes each client that has no connection and no code
 * after this long.
 */
const CLIENT_HOURS = 24;

/**
 * The redirect URI of the Claude apps. The second is the one that Claude
 * says it can change to.
 */
const CLAUDE_CALLBACKS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];

/** A URL, or null when `value` is not one. */
const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

/** True for an `http` URL on this computer: a native app such as Claude Code. */
const isLoopback = (url: URL) =>
  url.protocol === 'http:' &&
  ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

/**
 * True if the crm can send a code to `uri`: a callback of the Claude apps,
 * or a loopback URL. The crm refuses each other URL, so a code never goes
 * to a different site.
 */
const allowedRedirect = (uri: string) => {
  if (CLAUDE_CALLBACKS.includes(uri)) return true;
  const url = parseUrl(uri);
  return url !== null && isLoopback(url) && url.hash === '';
};

/**
 * True if the redirect URI of a request matches a registered one. A
 * loopback URI matches on any port, because a native app gets a free port
 * for each sign-in (RFC 8252, section 7.3).
 */
const sameRedirect = (registered: string, requested: string) => {
  if (registered === requested) return true;
  const a = parseUrl(registered);
  const b = parseUrl(requested);
  return (
    a !== null &&
    b !== null &&
    isLoopback(a) &&
    isLoopback(b) &&
    a.hostname === b.hostname &&
    a.pathname === b.pathname &&
    a.search === b.search &&
    b.hash === ''
  );
};

/** The protected resource metadata of the MCP server (RFC 9728). */
export const resourceMetadata = (): OAuthProtectedResourceMetadata => ({
  resource: MCP_URL,
  authorization_servers: [PUBLIC_URL],
  bearer_methods_supported: ['header'],
  resource_name: 'crm',
});

/** The authorization server metadata (RFC 8414). */
export const serverMetadata = (): OAuthMetadata => ({
  issuer: PUBLIC_URL,
  authorization_endpoint: `${PUBLIC_URL}${AUTHORIZE_PATH}`,
  token_endpoint: `${PUBLIC_URL}${TOKEN_PATH}`,
  registration_endpoint: `${PUBLIC_URL}${REGISTER_PATH}`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
});

/**
 * The `WWW-Authenticate` header of a 401 from `/api/mcp`. It names the
 * protected resource metadata, so a client can find the sign-in.
 */
export const wwwAuthenticate = (error?: 'invalid_token') =>
  `Bearer resource_metadata="${PUBLIC_URL}${RESOURCE_METADATA_PATH}"${
    error ? `, error="${error}"` : ''
  }`;

interface ClientRow {
  id: string;
  name: string;
  redirect_uris: string;
  created_at: string;
}

/**
 * Register a client (RFC 7591), and delete each old client that has no
 * connection and no code. Each client is public: the response always has
 * `token_endpoint_auth_method` `none`. Throws an OAuthError for metadata
 * that is not valid, or a redirect URI that is not allowed.
 */
export const registerClient = (
  db: Database,
  body: unknown,
): OAuthClientInformationFull => {
  const parsed = OAuthClientMetadataSchema.safeParse(body);
  if (!parsed.success) {
    throw new InvalidClientMetadataError(
      'The client metadata is not valid. Send redirect_uris as an array of URLs.',
    );
  }
  const metadata = parsed.data;
  if (metadata.redirect_uris.length === 0) {
    throw new InvalidClientMetadataError('Send one or more redirect_uris.');
  }
  const refused = metadata.redirect_uris.find((uri) => !allowedRedirect(uri));
  if (refused !== undefined) {
    throw new CustomOAuthError(
      'invalid_redirect_uri',
      `The crm does not send codes to ${refused}. Use the callback of a Claude app or a loopback URL.`,
    );
  }
  const grants = metadata.grant_types ?? ['authorization_code'];
  if (grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
    throw new InvalidClientMetadataError(
      'The grant_types can only be authorization_code and refresh_token.',
    );
  }
  if ((metadata.response_types ?? ['code']).some((type) => type !== 'code')) {
    throw new InvalidClientMetadataError(
      'The response_types can only be code.',
    );
  }
  const name =
    metadata.client_name?.trim().slice(0, 100) ||
    (parseUrl(metadata.redirect_uris[0])?.hostname ?? 'App');
  const id = newToken();
  db.transaction(() => {
    db.query(
      `DELETE FROM oauth_client WHERE created_at < ?
         AND id NOT IN (SELECT client_id FROM connection WHERE client_id IS NOT NULL)
         AND id NOT IN (SELECT client_id FROM oauth_code);`,
    ).run(later(-CLIENT_HOURS * 60 * 60 * 1000));
    db.query(
      'INSERT INTO oauth_client (id, name, redirect_uris) VALUES (?, ?, ?);',
    ).run(id, name, JSON.stringify(metadata.redirect_uris));
  })();
  return {
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: metadata.redirect_uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
};

/** A valid authorization request: the consent page shows it. */
export interface AuthorizeRequest {
  clientId: string;
  /** The name of the app, from its registration. */
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  /** The `state` of the client, or ''. */
  state: string;
  /** The `resource` of the request (RFC 8707), or ''. */
  resource: string;
}

/**
 * The result of a check of an authorization request:
 *
 * - `ok`: the request is valid. The consent page shows it.
 * - `error`: the client or its redirect URI is not valid. The page shows
 *   the error, and the crm sends nothing to the redirect URI (RFC 6749,
 *   section 4.1.2.1).
 * - `redirect`: a different value is not valid. The crm sends the error to
 *   the client at this URL.
 */
export type AuthorizeCheck =
  | { ok: AuthorizeRequest }
  | { error: string }
  | { redirect: string };

/** The redirect URI of `request`, with `params` and the `state` added. */
const redirectTo = (
  request: Pick<AuthorizeRequest, 'redirectUri' | 'state'>,
  params: Record<string, string>,
) => {
  const url = new URL(request.redirectUri);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  if (request.state) url.searchParams.set('state', request.state);
  return url.href;
};

/** True if `resource` is empty, or a URL on this site (RFC 8707). */
const ourResource = (resource: string) =>
  !resource ||
  (parseUrl(resource) !== null &&
    checkResourceAllowed({
      requestedResource: resource,
      configuredResource: `${PUBLIC_URL}/`,
    }));

/**
 * Check an authorization request: the query of `GET` on the authorize page,
 * or the hidden fields of its form.
 */
export const checkAuthorize = (
  db: Database,
  params: unknown,
): AuthorizeCheck => {
  const values = (params ?? {}) as Record<string, unknown>;
  const client = db
    .query<ClientRow, [string]>('SELECT * FROM oauth_client WHERE id = ?;')
    .get(formText(values.client_id));
  if (!client) {
    return {
      error:
        'The crm does not know this app. Add the connection again in the app.',
    };
  }
  const registered: string[] = JSON.parse(client.redirect_uris);
  const asked = formText(values.redirect_uri);
  const redirectUri = asked
    ? registered.some((uri) => sameRedirect(uri, asked))
      ? asked
      : null
    : registered.length === 1
      ? registered[0]
      : null;
  if (redirectUri === null) {
    return {
      error:
        'The app did not register this return address. Add the connection again in the app.',
    };
  }
  const request: AuthorizeRequest = {
    clientId: client.id,
    clientName: client.name,
    redirectUri,
    codeChallenge: formText(values.code_challenge),
    state: formText(values.state),
    resource: formText(values.resource),
  };
  const fail = (error: string, description: string) => ({
    redirect: redirectTo(request, { error, error_description: description }),
  });
  if (formText(values.response_type) !== 'code') {
    return fail(
      'unsupported_response_type',
      'The response_type can only be code.',
    );
  }
  if (
    !request.codeChallenge ||
    formText(values.code_challenge_method) !== 'S256'
  ) {
    return fail(
      'invalid_request',
      'Send a code_challenge with the code_challenge_method S256.',
    );
  }
  if (!ourResource(request.resource)) {
    return fail('invalid_target', `The resource can only be ${MCP_URL}.`);
  }
  return { ok: request };
};

/**
 * The admin allowed the request on the consent page. Make an
 * authorization code for `personId`, and return the redirect URI with the
 * code. The code works one time, for CODE_MINUTES.
 */
export const grantCode = (
  db: Database,
  personId: string,
  request: AuthorizeRequest,
) => {
  const code = newToken();
  db.query(
    `INSERT INTO oauth_code (code_hash, client_id, person_id, redirect_uri, code_challenge, expires_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
  ).run(
    hash(code),
    request.clientId,
    personId,
    request.redirectUri,
    request.codeChallenge,
    later(CODE_MINUTES * 60 * 1000),
  );
  return redirectTo(request, { code });
};

/** The admin tapped Deny: the redirect URI with the error `access_denied`. */
export const denyUrl = (request: AuthorizeRequest) =>
  redirectTo(request, {
    error: 'access_denied',
    error_description: 'The admin did not allow the connection.',
  });

/** The S256 code challenge of a PKCE code verifier (RFC 7636). */
const s256 = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');

/** A new access token and refresh token, with their hashes and end times. */
const newTokens = () => {
  const access = newToken();
  const refresh = newToken();
  return {
    response: {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_SECONDS,
      refresh_token: refresh,
    } satisfies OAuthTokens,
    tokenHash: hash(access),
    tokenExpiresAt: later(ACCESS_SECONDS * 1000),
    refreshHash: hash(refresh),
    refreshExpiresAt: later(REFRESH_DAYS * 24 * 60 * 60 * 1000),
  };
};

/**
 * Exchange an authorization code for tokens: a new OAuth connection of the
 * person who allowed it. The code works one time. Throws an OAuthError.
 */
const exchangeCode = (db: Database, body: Record<string, unknown>) => {
  const row = db
    .query<
      {
        client_id: string;
        person_id: string;
        redirect_uri: string;
        code_challenge: string;
        expires_at: string;
        client_name: string;
        email: string | null;
      },
      [string]
    >(
      `SELECT oauth_code.*, oauth_client.name AS client_name, person.email
       FROM oauth_code
       JOIN oauth_client ON oauth_client.id = oauth_code.client_id
       JOIN person ON person.id = oauth_code.person_id
       WHERE code_hash = ?;`,
    )
    .get(hash(formText(body.code)));
  if (row) {
    db.query('DELETE FROM oauth_code WHERE code_hash = ?;').run(
      hash(formText(body.code)),
    );
  }
  if (!row || row.expires_at <= now()) {
    throw new InvalidGrantError('The code is not valid, or it expired.');
  }
  if (formText(body.client_id) !== row.client_id) {
    throw new InvalidGrantError('The code is for a different client_id.');
  }
  const redirectUri = formText(body.redirect_uri);
  if (redirectUri && redirectUri !== row.redirect_uri) {
    throw new InvalidGrantError(
      'The redirect_uri is not the same as in the authorization request.',
    );
  }
  if (s256(formText(body.code_verifier)) !== row.code_challenge) {
    throw new InvalidGrantError(
      'The code_verifier does not match the code_challenge.',
    );
  }
  if (!ourResource(formText(body.resource))) {
    throw new InvalidTargetError(`The resource can only be ${MCP_URL}.`);
  }
  if (!isAdminEmail(row.email)) {
    throw new InvalidGrantError('Only the admin can connect an app.');
  }
  const tokens = newTokens();
  const id = crypto.randomUUID();
  db.transaction(() => {
    // An OAuth connection with an expired refresh token is not in the list,
    // and nothing can use it.
    db.query(
      "DELETE FROM connection WHERE kind = 'oauth' AND refresh_expires_at <= ?;",
    ).run(now());
    db.query(
      `INSERT INTO connection (id, person_id, kind, name, client_id, token_hash,
         token_expires_at, refresh_hash, refresh_expires_at)
       VALUES (?, ?, 'oauth', ?, ?, ?, ?, ?, ?);`,
    ).run(
      id,
      row.person_id,
      row.client_name,
      row.client_id,
      tokens.tokenHash,
      tokens.tokenExpiresAt,
      tokens.refreshHash,
      tokens.refreshExpiresAt,
    );
    audit(db, row.person_id, 'connection_add', 'connection', id, {
      kind: 'oauth',
      name: row.client_name,
    });
  })();
  return tokens.response;
};

/**
 * Exchange a refresh token for new tokens. The connection gets a new access
 * token and a new refresh token, and the old ones stop. Throws an
 * OAuthError.
 */
const refresh = (db: Database, body: Record<string, unknown>) => {
  const row = db
    .query<{ id: string; client_id: string }, [string, string]>(
      `SELECT id, client_id FROM connection
       WHERE kind = 'oauth' AND refresh_hash = ? AND refresh_expires_at > ?;`,
    )
    .get(hash(formText(body.refresh_token)), now());
  const clientId = formText(body.client_id);
  if (!row || (clientId && clientId !== row.client_id)) {
    throw new InvalidGrantError(
      'The refresh token is not valid, or it expired. Connect the app again.',
    );
  }
  const tokens = newTokens();
  db.query(
    `UPDATE connection SET token_hash = ?, token_expires_at = ?,
       refresh_hash = ?, refresh_expires_at = ? WHERE id = ?;`,
  ).run(
    tokens.tokenHash,
    tokens.tokenExpiresAt,
    tokens.refreshHash,
    tokens.refreshExpiresAt,
    row.id,
  );
  return tokens.response;
};

/** The token endpoint: a code or a refresh token, for tokens. */
export const tokenGrant = (db: Database, body: unknown): OAuthTokens => {
  const values = (body ?? {}) as Record<string, unknown>;
  switch (formText(values.grant_type)) {
    case 'authorization_code':
      return exchangeCode(db, values);
    case 'refresh_token':
      return refresh(db, values);
    case '':
      throw new InvalidRequestError('Send a grant_type.');
    default:
      throw new UnsupportedGrantTypeError(
        'The grant_type can only be authorization_code or refresh_token.',
      );
  }
};

/** The connection of a request to `/api/mcp`. */
export interface McpAuth {
  connectionId: string;
  /** The name of the connection. The audit actor is `mcp:<name>`. */
  name: string;
  personId: string;
  /** True if the person is the admin (CRM_ADMIN_EMAIL) now. */
  admin: boolean;
}

/**
 * The connection of the bearer token in an `Authorization` header, or
 * null: a personal access token, or an OAuth access token that has not
 * expired. Marks the connection as used now.
 */
export const findConnection = (
  db: Database,
  header: string | undefined,
): McpAuth | null => {
  const token = /^Bearer +(\S+)$/i.exec(header ?? '')?.[1];
  if (!token) return null;
  const row = db
    .query<
      {
        connectionId: string;
        name: string;
        personId: string;
        email: string | null;
      },
      [string, string]
    >(
      `SELECT connection.id AS connectionId, connection.name, person.id AS personId, person.email
       FROM connection JOIN person ON person.id = connection.person_id
       WHERE connection.token_hash = ?
         AND (connection.token_expires_at IS NULL OR connection.token_expires_at > ?);`,
    )
    .get(hash(token), now());
  if (!row) return null;
  db.query('UPDATE connection SET last_used_at = ? WHERE id = ?;').run(
    now(),
    row.connectionId,
  );
  const { email, ...auth } = row;
  return { ...auth, admin: isAdminEmail(email) };
};

/** One row of the connections list. */
export interface ConnectionRow {
  id: string;
  kind: 'token' | 'oauth';
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/**
 * The connections of a person, newest first: each personal access token,
 * and each OAuth connection with a refresh token that works.
 */
export const listConnections = (db: Database, personId: string) =>
  db
    .query<ConnectionRow, [string, string]>(
      `SELECT id, kind, name, created_at, last_used_at FROM connection
       WHERE person_id = ? AND (kind = 'token' OR refresh_expires_at > ?)
       ORDER BY created_at DESC, rowid DESC;`,
    )
    .all(personId, now());

/**
 * Add a personal access token with `name` for `personId`. The database
 * keeps only its hash, so this is the one time that the token shows.
 * Returns the token.
 */
export const addToken = (db: Database, personId: string, name: string) => {
  const token = `crm_${newToken()}`;
  const id = crypto.randomUUID();
  db.query(
    `INSERT INTO connection (id, person_id, kind, name, token_hash)
     VALUES (?, ?, 'token', ?, ?);`,
  ).run(id, personId, name, hash(token));
  audit(db, personId, 'connection_add', 'connection', id, {
    kind: 'token',
    name,
  });
  return token;
};

/**
 * Revoke a connection of `personId`: delete its row, so its tokens stop.
 * A connection of a different person is never touched.
 */
export const revokeConnection = (
  db: Database,
  personId: string,
  id: string,
) => {
  const row = db
    .query<{ id: string; kind: string; name: string }, [string, string]>(
      'DELETE FROM connection WHERE id = ? AND person_id = ? RETURNING id, kind, name;',
    )
    .get(id, personId);
  if (row) {
    audit(db, personId, 'connection_revoke', 'connection', row.id, {
      kind: row.kind,
      name: row.name,
    });
  }
};

/** Send an OAuth error as JSON, with its status (RFC 6749, section 5.2). */
const sendOAuthError = (reply: FastifyReply, error: unknown) => {
  if (!(error instanceof OAuthError)) throw error;
  const status =
    error instanceof TooManyRequestsError
      ? 429
      : error.errorCode === 'invalid_client'
        ? 401
        : 400;
  return reply
    .code(status)
    .header('cache-control', 'no-store')
    .send(error.toResponseObject());
};

/**
 * The OAuth routes with no page: the two metadata documents, the client
 * registration and the token endpoint. The authorize page is
 * `routes/account/connections/authorize.tsx`. The auth hook lets each one
 * through with no session (`COOKIELESS_PATHS` in `auth.ts`).
 */
export const oauthRoutes = (app: FastifyInstance, db: Database) => {
  // An open registration endpoint could fill the database, so each address
  // can register 20 clients in an hour.
  const registerLimit = rateLimiter(20, 60 * 60 * 1000);

  // A client looks for the resource metadata at the path of the resource
  // first, then at the root (RFC 9728, section 3.1).
  for (const path of [
    RESOURCE_METADATA_PATH,
    '/.well-known/oauth-protected-resource',
  ]) {
    app.get(path, async (_request, reply) => reply.send(resourceMetadata()));
  }
  app.get('/.well-known/oauth-authorization-server', async (_request, reply) =>
    reply.send(serverMetadata()),
  );

  app.post(REGISTER_PATH, async (request, reply) => {
    try {
      if (!registerLimit(request.ip)) {
        throw new TooManyRequestsError(
          'This address registered too many clients. Try again in 1 hour.',
        );
      }
      return reply
        .code(201)
        .header('cache-control', 'no-store')
        .send(registerClient(db, request.body));
    } catch (error) {
      return sendOAuthError(reply, error);
    }
  });

  app.post(TOKEN_PATH, async (request, reply) => {
    try {
      return reply
        .header('cache-control', 'no-store')
        .send(tokenGrant(db, request.body));
    } catch (error) {
      return sendOAuthError(reply, error);
    }
  });
};

import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  type OAuthClientProvider,
  UnauthorizedError,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { PUBLIC_URL } from './auth';
import type { buildApp } from './index';
import { addToken, MCP_URL } from './oauth';
import {
  addPerson,
  callTool,
  injectFetch,
  mcpClient,
  postForm,
  signIn,
  signInAdmin,
  TEST_ADMIN_EMAIL,
  testApp,
} from './test-helpers';

let app: ReturnType<typeof buildApp>;
let db: Database;
let close: () => Promise<void>;
let cookie: string;

beforeEach(() => {
  ({ app, db, close } = testApp());
  cookie = signInAdmin(app);
});

afterEach(async () => {
  await close();
});

/**
 * The OAuth side of a test client, in memory: what a client such as
 * claude.ai keeps. It registers with a loopback redirect URI with no port,
 * and asks with a port, as Claude Code does.
 */
class TestProvider implements OAuthClientProvider {
  authorizeUrls: URL[] = [];
  client?: OAuthClientInformationMixed;
  saved?: OAuthTokens;
  verifier = '';
  get redirectUrl() {
    return 'http://127.0.0.1:33418/callback';
  }
  get clientMetadata() {
    return {
      client_name: 'Test client',
      redirect_uris: ['http://127.0.0.1/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  clientInformation() {
    return this.client;
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    this.client = client;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authorizeUrls.push(url);
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
}

/** A client of the SDK with `provider`, and its transport. */
const oauthClient = (provider: TestProvider) => ({
  client: new Client({ name: 'crm-test', version: '1.0.0' }),
  transport: new StreamableHTTPClientTransport(new URL(MCP_URL), {
    authProvider: provider,
    fetch: injectFetch(app),
  }),
});

/** The path and the query of a URL on this site. */
const local = (url: URL | string) => {
  const parsed = new URL(String(url));
  return `${parsed.pathname}${parsed.search}`;
};

/** The hidden fields of the consent form in `html`. */
const hiddenFields = (html: string) =>
  Object.fromEntries(
    [
      ...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g),
    ].map(([, name, value]) => [name, value.replaceAll('&amp;', '&')]),
  );

/** POST `fields` to the token endpoint. */
const tokenRequest = (fields: Record<string, string>) =>
  postForm(app, '/api/oauth/token', fields);

/** Register a public client with `redirect_uris`. Returns the response. */
const register = (redirect_uris: string[]) =>
  app.inject({
    method: 'POST',
    url: '/api/oauth/register',
    payload: { client_name: 'Claude', redirect_uris },
  });

/** A valid authorize URL for a new client of claude.ai. */
const authorizeUrl = async (extra: Record<string, string> = {}) => {
  const client = (await register([CLAUDE])).json();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: CLAUDE,
    code_challenge: createHash('sha256').update(VERIFIER).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: MCP_URL,
    ...extra,
  });
  return { client, url: `/account/connections/authorize?${params}` };
};

const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'a-verifier-of-43-characters-or-more-for-pkce-s256';

describe('OAuth for the Claude apps', () => {
  test('a test client signs in end to end: 401, discovery, registration, consent, code, token, then a tool call', async () => {
    const provider = new TestProvider();
    const first = oauthClient(provider);
    // 1. No token: the 401 starts the sign-in, and the client registers
    //    and goes to the authorize page.
    await expect(first.client.connect(first.transport)).rejects.toThrow(
      UnauthorizedError,
    );
    expect(provider.client?.client_id).toBeString();
    const authorize = provider.authorizeUrls[0];
    expect(authorize.origin + authorize.pathname).toBe(
      `${PUBLIC_URL}/account/connections/authorize`,
    );
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('resource')).toBe(MCP_URL);

    // 2. The admin, in a passkey session, sees the consent page.
    const page = await app.inject({
      method: 'GET',
      url: local(authorize),
      headers: { cookie },
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Test client');
    expect(page.body).toContain('127.0.0.1 (a program on this computer)');
    expect(page.body).toContain('>Allow</button>');
    // No other site can show the page in a frame.
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.headers['content-security-policy']).toBe(
      "frame-ancestors 'none'",
    );

    // 3. Allow: the redirect URI gets a code and the state.
    const allowed = await postForm(
      app,
      '/account/connections/authorize',
      { ...hiddenFields(page.body), decision: 'allow' },
      cookie,
    );
    expect(allowed.statusCode).toBe(303);
    const callback = new URL(String(allowed.headers.location));
    expect(`${callback.origin}${callback.pathname}`).toBe(
      'http://127.0.0.1:33418/callback',
    );
    expect(callback.searchParams.get('state')).toBe(
      authorize.searchParams.get('state'),
    );
    const code = callback.searchParams.get('code') ?? '';

    // 4. The client exchanges the code for tokens.
    await first.transport.finishAuth(code);
    expect(provider.saved?.access_token).toBeString();
    expect(provider.saved?.refresh_token).toBeString();
    expect(provider.saved?.token_type).toBe('Bearer');

    // 5. The client connects with the token and calls a tool.
    const second = oauthClient(provider);
    await second.client.connect(second.transport);
    const tools = await second.client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('get_organisation');
    const created = await callTool(second.client, 'create_lead', {
      organisation: { name: 'OAuth Bakery' },
    });
    expect(created.slug).toBe('oauth-bakery');
    await second.client.close();

    // The write has the name of the connection as its actor.
    expect(
      db
        .query(
          "SELECT actor FROM audit_log WHERE action = 'create' AND entity = 'organisation';",
        )
        .get(),
    ).toEqual({ actor: 'mcp:Test client' });
    // The connection is in the list, as an app sign-in, and its tokens are
    // stored as hashes only.
    const list = await app.inject({
      method: 'GET',
      url: '/account/connections',
      headers: { cookie },
    });
    expect(list.body).toContain('Test client');
    expect(list.body).toContain('App sign-in');
    const stored = JSON.stringify(db.query('SELECT * FROM connection;').all());
    expect(stored).not.toContain(provider.saved?.access_token ?? '-');
    expect(stored).not.toContain(provider.saved?.refresh_token ?? '-');
  });

  test('a refresh gives new tokens, and the old refresh token and access token stop', async () => {
    const { client, url } = await authorizeUrl();
    const page = await app.inject({ method: 'GET', url, headers: { cookie } });
    const allowed = await postForm(
      app,
      '/account/connections/authorize',
      { ...hiddenFields(page.body), decision: 'allow' },
      cookie,
    );
    const code = new URL(String(allowed.headers.location)).searchParams.get(
      'code',
    );
    const exchange = await tokenRequest({
      grant_type: 'authorization_code',
      code: code ?? '',
      client_id: client.client_id,
      redirect_uri: CLAUDE,
      code_verifier: VERIFIER,
      resource: MCP_URL,
    });
    expect(exchange.statusCode).toBe(200);
    expect(exchange.headers['cache-control']).toBe('no-store');
    const first = exchange.json();
    expect(first.expires_in).toBe(3600);

    // The code works one time.
    const again = await tokenRequest({
      grant_type: 'authorization_code',
      code: code ?? '',
      client_id: client.client_id,
      redirect_uri: CLAUDE,
      code_verifier: VERIFIER,
    });
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toBe('invalid_grant');

    const refreshed = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
      client_id: client.client_id,
    });
    expect(refreshed.statusCode).toBe(200);
    const second = refreshed.json();
    expect(second.refresh_token).not.toBe(first.refresh_token);

    const reuse = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
      client_id: client.client_id,
    });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json().error).toBe('invalid_grant');

    const old = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { authorization: `Bearer ${first.access_token}` },
      payload: {},
    });
    expect(old.statusCode).toBe(401);
    const mcp = await mcpClient(app, second.access_token);
    expect((await mcp.listTools()).tools.length).toBeGreaterThan(0);
    await mcp.close();
  });

  test('the metadata names the resource, the authorization server and its endpoints', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource/api/mcp',
      '/.well-known/oauth-protected-resource',
    ]) {
      const response = await app.inject({ method: 'GET', url: path });
      expect(response.json<Record<string, unknown>>()).toEqual({
        resource: MCP_URL,
        authorization_servers: [PUBLIC_URL],
        bearer_methods_supported: ['header'],
        resource_name: 'crm',
      });
    }
    const server = (
      await app.inject({
        method: 'GET',
        url: '/.well-known/oauth-authorization-server',
      })
    ).json();
    expect(server).toMatchObject({
      issuer: PUBLIC_URL,
      authorization_endpoint: `${PUBLIC_URL}/account/connections/authorize`,
      token_endpoint: `${PUBLIC_URL}/api/oauth/token`,
      registration_endpoint: `${PUBLIC_URL}/api/oauth/register`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
    // An unknown path under /.well-known/ is a 404, not the sign-in page.
    const unknown = await app.inject({
      method: 'GET',
      url: '/.well-known/openid-configuration',
    });
    expect(unknown.statusCode).toBe(404);
  });

  test('registration takes only the callbacks of the Claude apps and loopback URLs', async () => {
    const claude = await register([CLAUDE]);
    expect(claude.statusCode).toBe(201);
    expect(claude.json()).toMatchObject({
      client_name: 'Claude',
      redirect_uris: [CLAUDE],
      token_endpoint_auth_method: 'none',
    });
    expect(claude.json().client_secret).toBeUndefined();
    expect((await register(['http://localhost/callback'])).statusCode).toBe(
      201,
    );
    const evil = await register(['https://evil.example/callback']);
    expect(evil.statusCode).toBe(400);
    expect(evil.json().error).toBe('invalid_redirect_uri');
    expect((await register([])).statusCode).toBe(400);
  });

  test('the authorize page refuses an unknown client and a redirect URI that is not registered, with no redirect', async () => {
    const unknown = await app.inject({
      method: 'GET',
      url: `/account/connections/authorize?response_type=code&client_id=nobody&redirect_uri=${encodeURIComponent(CLAUDE)}`,
      headers: { cookie },
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body).toContain('The crm does not know this app.');
    const { url } = await authorizeUrl({
      redirect_uri: 'http://localhost:9999/callback',
    });
    const wrong = await app.inject({
      method: 'GET',
      url,
      headers: { cookie },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.body).not.toContain('>Allow</button>');
  });

  test('the authorize page sends a request with no PKCE, or for another resource, back with an error', async () => {
    for (const [extra, error] of [
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ resource: 'https://evil.example/mcp' }, 'invalid_target'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
    ] as const) {
      const { url } = await authorizeUrl(extra);
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(303);
      const location = new URL(String(response.headers.location));
      expect(location.searchParams.get('error')).toBe(error);
      expect(location.searchParams.get('state')).toBe('xyz');
    }
  });

  test('Deny sends access_denied, and a wrong code_verifier gets no token', async () => {
    const { client, url } = await authorizeUrl();
    const page = await app.inject({ method: 'GET', url, headers: { cookie } });
    const denied = await postForm(
      app,
      '/account/connections/authorize',
      { ...hiddenFields(page.body), decision: 'deny' },
      cookie,
    );
    const location = new URL(String(denied.headers.location));
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('code')).toBeNull();

    const allowed = await postForm(
      app,
      '/account/connections/authorize',
      { ...hiddenFields(page.body), decision: 'allow' },
      cookie,
    );
    const code = new URL(String(allowed.headers.location)).searchParams.get(
      'code',
    );
    const response = await tokenRequest({
      grant_type: 'authorization_code',
      code: code ?? '',
      client_id: client.client_id,
      redirect_uri: CLAUDE,
      code_verifier: 'a-different-verifier-of-43-characters-or-more',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_grant');
  });

  test('a signed-out visitor of the authorize page signs in first, and only the admin in a passkey session sees it', async () => {
    const { url } = await authorizeUrl();
    const signedOut = await app.inject({ method: 'GET', url });
    expect(signedOut.statusCode).toBe(303);
    expect(signedOut.headers.location).toBe(
      `/login?next=${encodeURIComponent(url)}`,
    );
    const emailSession = await signIn(app, db, TEST_ADMIN_EMAIL);
    const admin = await app.inject({
      method: 'GET',
      url,
      headers: { cookie: emailSession },
    });
    expect(admin.statusCode).toBe(403);
    const other = await signIn(app, db, 'client@example.com');
    const client = await app.inject({
      method: 'GET',
      url,
      headers: { cookie: other },
    });
    expect(client.statusCode).toBe(403);
    expect(client.body).not.toContain('>Allow</button>');
  });
});

describe('/api/mcp', () => {
  test('refuses a call with no token, with the header that starts the OAuth sign-in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe(
      `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource/api/mcp"`,
    );
    // The session cookie of the admin is not a token.
    const withCookie = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { cookie },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(withCookie.statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { authorization: 'Bearer crm_not-a-token' },
      payload: {},
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.headers['www-authenticate']).toContain(
      'error="invalid_token"',
    );
  });

  test('refuses a call with the token of a person who is not the admin', async () => {
    const personId = addPerson(db, 'staff@example.com');
    const token = addToken(db, personId, 'Not the admin');
    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(response.statusCode).toBe(403);
    // A token of the admin stops when the admin changes.
    const adminToken = addToken(
      db,
      (
        db
          .query('SELECT id FROM person WHERE email = ?;')
          .get(TEST_ADMIN_EMAIL) as { id: string }
      ).id,
      'Admin',
    );
    process.env.CRM_ADMIN_EMAIL = 'someone-else@example.com';
    try {
      const changed = await app.inject({
        method: 'POST',
        url: '/api/mcp',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });
      expect(changed.statusCode).toBe(403);
    } finally {
      process.env.CRM_ADMIN_EMAIL = TEST_ADMIN_EMAIL;
    }
  });

  test('a GET gets 405: the server is stateless and takes only POST', async () => {
    const token = await newToken('Claude Code');
    const response = await app.inject({
      method: 'GET',
      url: '/api/mcp',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe('POST');
  });
});

/** Add a token on /account/connections, as the admin. Returns the token. */
const newToken = async (name: string) => {
  const response = await postForm(
    app,
    '/account/connections',
    { name },
    cookie,
  );
  expect(response.statusCode).toBe(200);
  const token = response.body.match(/<code>(crm_[\w-]+)<\/code>/)?.[1];
  if (!token) throw new Error('The page shows no token.');
  return token;
};

describe('/account/connections', () => {
  test('adds a named token, shows it one time with the claude mcp add command, and stores only its hash', async () => {
    const response = await postForm(
      app,
      '/account/connections',
      { name: 'Claude Code on my laptop' },
      cookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const token = response.body.match(/<code>(crm_[\w-]+)<\/code>/)?.[1] ?? '';
    expect(token).not.toBe('');
    expect(response.body).toContain(
      `claude mcp add --transport http crm ${MCP_URL} --header &quot;Authorization: Bearer ${token}&quot;`,
    );
    expect(
      JSON.stringify(db.query('SELECT * FROM connection;').all()),
    ).not.toContain(token);
    const list = await app.inject({
      method: 'GET',
      url: '/account/connections',
      headers: { cookie },
    });
    expect(list.body).not.toContain(token);
    expect(list.body).toContain('Claude Code on my laptop');
    expect(list.body).toContain('Never');

    // A call with the token works, and the list shows when it was used.
    const client = await mcpClient(app, token);
    await callTool(client, 'list_due');
    await client.close();
    const used = await app.inject({
      method: 'GET',
      url: '/account/connections',
      headers: { cookie },
    });
    expect(used.body).not.toContain('Never');
  });

  test('revokes a connection: its token stops, and the audit log has the add and the revoke', async () => {
    const token = await newToken('Claude Code');
    const { id } = db.query('SELECT id FROM connection;').get() as {
      id: string;
    };
    const revoked = await postForm(
      app,
      '/account/connections',
      { revoke: id },
      cookie,
    );
    expect(revoked.statusCode).toBe(303);
    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(
      db
        .query<{ action: string }, []>(
          "SELECT action FROM audit_log WHERE entity = 'connection' ORDER BY rowid;",
        )
        .all()
        .map((row) => row.action),
    ).toEqual(['connection_add', 'connection_revoke']);
  });

  test('a token needs a name', async () => {
    const response = await postForm(
      app,
      '/account/connections',
      { name: ' ' },
      cookie,
    );
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Type a name for the token.');
  });

  test('is an admin page, and the account page links it only for the admin', async () => {
    const other = await signIn(app, db, 'client@example.com');
    const page = await app.inject({
      method: 'GET',
      url: '/account/connections',
      headers: { cookie: other },
    });
    expect(page.statusCode).toBe(403);
    const post = await postForm(
      app,
      '/account/connections',
      { name: 'Mine' },
      other,
    );
    expect(post.statusCode).toBe(403);
    expect(db.query('SELECT count(*) AS n FROM connection;').get()).toEqual({
      n: 0,
    });
    const account = await app.inject({
      method: 'GET',
      url: '/account',
      headers: { cookie: other },
    });
    expect(account.body).not.toContain('/account/connections');
    const adminAccount = await app.inject({
      method: 'GET',
      url: '/account',
      headers: { cookie },
    });
    expect(adminAccount.body).toContain('href="/account/connections"');
  });

  test('works as raw HTML (REQ-CRM-BARE-001)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/account/connections?theme=bare',
      headers: { cookie },
    });
    expect(response.body).not.toContain('<script');
    expect(response.body).toContain(
      '<form action="/account/connections" method="post">',
    );
  });
});

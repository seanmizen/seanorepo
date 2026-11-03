import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { SESSION_COOKIE } from './auth';
import type { buildApp } from './index';
import { RP_ID, RP_ORIGIN } from './passkeys';

/**
 * A software passkey for tests, and helpers that use the real WebAuthn
 * routes with it. Tests have no browser and no WebAuthn.
 */

type App = ReturnType<typeof buildApp>;

const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest();

const b64url = (data: Uint8Array) => Buffer.from(data).toString('base64url');

const uint = (value: number, bytes: 2 | 4) => {
  const buffer = Buffer.alloc(bytes);
  if (bytes === 2) buffer.writeUInt16BE(value);
  else buffer.writeUInt32BE(value);
  return buffer;
};

/**
 * One P-256 key and one credential id. It makes the same responses as
 * `startRegistration()` and `startAuthentication()` in a browser, with
 * 'none' attestation and user verification.
 */
export class TestAuthenticator {
  private keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  readonly id = b64url(randomBytes(16));
  private counter = 0;

  constructor(private origin = RP_ORIGIN) {}

  /** The response to the options from `/api/passkeys/register-options`. */
  register(options: { challenge: string }): RegistrationResponseJSON {
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    const cosePublicKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, new Uint8Array(Buffer.from(jwk.x ?? '', 'base64url'))],
        [-3, new Uint8Array(Buffer.from(jwk.y ?? '', 'base64url'))],
      ]),
    );
    const credentialId = Buffer.from(this.id, 'base64url');
    // Flags: user present (0x01), user verified (0x04), credential data (0x40).
    const authData = Buffer.concat([
      sha256(RP_ID),
      Buffer.from([0x45]),
      uint(this.counter, 4),
      Buffer.alloc(16),
      uint(credentialId.length, 2),
      credentialId,
      cosePublicKey,
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, number>>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', new Uint8Array(authData)],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: this.clientData('webauthn.create', options.challenge),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    };
  }

  /** The response to the options from `/api/passkeys/sign-in-options`. */
  signIn(options: { challenge: string }): AuthenticationResponseJSON {
    this.counter += 1;
    // Flags: user present (0x01), user verified (0x04).
    const authData = Buffer.concat([
      sha256(RP_ID),
      Buffer.from([0x05]),
      uint(this.counter, 4),
    ]);
    const clientDataJSON = this.clientData('webauthn.get', options.challenge);
    const signature = sign(
      'sha256',
      Buffer.concat([
        authData,
        sha256(Buffer.from(clientDataJSON, 'base64url')),
      ]),
      this.keys.privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON,
        authenticatorData: b64url(authData),
        signature: b64url(signature),
      },
      clientExtensionResults: {},
    };
  }

  private clientData(type: string, challenge: string) {
    return b64url(
      Buffer.from(JSON.stringify({ type, challenge, origin: this.origin })),
    );
  }
}

/** POST `body` as JSON to `url`, as `crm-fe/src/passkeys.ts` does. */
export const postJson = (
  app: App,
  url: string,
  body: object,
  cookie?: string,
) =>
  app.inject({
    method: 'POST',
    url,
    headers: cookie ? { cookie } : {},
    payload: body as Record<string, unknown>,
  });

/**
 * Add a passkey with `name` for the session in `cookie`, through the real
 * WebAuthn routes. Returns the last response: 200, or the error.
 */
export const addTestPasskey = async (
  app: App,
  cookie: string,
  authenticator: TestAuthenticator,
  name = 'Test key',
) => {
  const options = await postJson(
    app,
    '/api/passkeys/register-options',
    {},
    cookie,
  );
  if (options.statusCode !== 200) return options;
  return postJson(
    app,
    '/api/passkeys/register',
    { name, response: authenticator.register(options.json()) },
    cookie,
  );
};

/**
 * Sign in with `authenticator` through the real WebAuthn routes. Returns the
 * last response and the `cookie` header value (empty when the sign-in
 * failed).
 */
export const signInWithPasskey = async (
  app: App,
  authenticator: TestAuthenticator,
  next?: string,
) => {
  const options = await postJson(app, '/api/passkeys/sign-in-options', {});
  const response = await postJson(app, '/api/passkeys/sign-in', {
    response: authenticator.signIn(options.json()),
    next,
  });
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  return {
    response,
    cookie: cookie ? `${SESSION_COOKIE}=${cookie.value}` : '',
  };
};

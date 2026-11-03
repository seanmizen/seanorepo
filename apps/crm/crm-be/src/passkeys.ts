import type { Database } from 'bun:sqlite';
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { type Auth, audit, hasPasskey, isAdmin, now, PUBLIC_URL } from './auth';

/**
 * Passkeys (WebAuthn, with SimpleWebAuthn): the relying party, the challenge
 * store, and the two ceremonies (add a passkey, sign in with a passkey). The
 * routes are `routes/account/passkeys.tsx` and `routes/api/passkeys/*`. The
 * browser part is `crm-fe/src/passkeys.ts`.
 */

/** A challenge works one time, for this long. */
export const CHALLENGE_MINUTES = 5;

/** The relying party comes from CRM_PUBLIC_URL, never from the Host header. */
const publicUrl = new URL(PUBLIC_URL);
export const RP_ID = publicUrl.hostname;
export const RP_ORIGIN = publicUrl.origin;
const RP_NAME = 'crm';

/** The longest passkey name. */
export const NAME_MAX = 60;

interface PasskeyRow {
  id: string;
  person_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
}

/**
 * True if this session can add or delete passkeys. A client can always. The
 * admin needs a passkey session, except to add the first passkey: then an
 * email session or a recovery session can.
 */
export const canChangePasskeys = (db: Database, auth: Auth) =>
  !isAdmin(auth) || auth.method === 'passkey' || !hasPasskey(db, auth.personId);

/** Keep a new challenge. Delete the expired ones first. */
const saveChallenge = (
  db: Database,
  challenge: string,
  purpose: 'register' | 'sign_in',
  personId: string | null,
) => {
  db.query('DELETE FROM webauthn_challenge WHERE expires_at <= ?;').run(now());
  db.query(
    'INSERT INTO webauthn_challenge (challenge, purpose, person_id, expires_at) VALUES (?, ?, ?, ?);',
  ).run(
    challenge,
    purpose,
    personId,
    new Date(Date.now() + CHALLENGE_MINUTES * 60 * 1000).toISOString(),
  );
};

/**
 * A check for SimpleWebAuthn's `expectedChallenge`. It deletes the matching
 * challenge row and returns true, or returns false when no unexpired row
 * matches. So each challenge works one time.
 */
const spendChallenge =
  (db: Database, purpose: 'register' | 'sign_in', personId: string | null) =>
  (challenge: string) =>
    db
      .query(
        `DELETE FROM webauthn_challenge
         WHERE challenge = ? AND purpose = ? AND person_id IS ? AND expires_at > ?
         RETURNING challenge;`,
      )
      .get(challenge, purpose, personId, now()) !== null;

/** The options for `navigator.credentials.create()`, to add a passkey. */
export const registrationOptions = async (db: Database, auth: Auth) => {
  const existing = db
    .query<{ id: string; transports: string | null }, [string]>(
      'SELECT id, transports FROM passkey WHERE person_id = ?;',
    )
    .all(auth.personId);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: auth.email,
    userID: new TextEncoder().encode(auth.personId),
    attestationType: 'none',
    excludeCredentials: existing.map((row) => ({
      id: row.id,
      transports: row.transports ? JSON.parse(row.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    timeout: CHALLENGE_MINUTES * 60 * 1000,
  });
  saveChallenge(db, options.challenge, 'register', auth.personId);
  return options;
};

/**
 * Verify the browser's response to `registrationOptions`, and keep the new
 * passkey with `name`. Throws when the response does not verify.
 */
export const addPasskey = async (
  db: Database,
  auth: Auth,
  name: string,
  response: RegistrationResponseJSON,
) => {
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: spendChallenge(db, 'register', auth.personId),
    expectedOrigin: RP_ORIGIN,
    expectedRPID: RP_ID,
  });
  if (!result.verified) throw new Error('The passkey did not verify.');
  const { credential } = result.registrationInfo;
  db.query(
    'INSERT INTO passkey (id, person_id, name, public_key, counter, transports) VALUES (?, ?, ?, ?, ?, ?);',
  ).run(
    credential.id,
    auth.personId,
    name,
    credential.publicKey,
    credential.counter,
    credential.transports ? JSON.stringify(credential.transports) : null,
  );
  audit(db, auth.personId, 'passkey_add', 'passkey', credential.id, {
    name,
    session: auth.sessionId,
  });
};

/**
 * The options for `navigator.credentials.get()`, to sign in. They name no
 * person and no credential: the browser offers the passkeys it has for this
 * site.
 */
export const signInOptions = async (db: Database) => {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    timeout: CHALLENGE_MINUTES * 60 * 1000,
  });
  saveChallenge(db, options.challenge, 'sign_in', null);
  return options;
};

/**
 * Verify the browser's response to `signInOptions`. Updates the counter and
 * the last-used time of the passkey. Returns the person id. Throws when the
 * passkey is unknown or the response does not verify.
 */
export const verifySignIn = async (
  db: Database,
  response: AuthenticationResponseJSON,
) => {
  const passkey = db
    .query<PasskeyRow, [string]>(
      'SELECT id, person_id, public_key, counter, transports FROM passkey WHERE id = ?;',
    )
    .get(response.id);
  if (!passkey) throw new Error('This passkey is not known to crm.');
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: spendChallenge(db, 'sign_in', null),
    expectedOrigin: RP_ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: passkey.id,
      publicKey: new Uint8Array(passkey.public_key),
      counter: passkey.counter,
      transports: passkey.transports
        ? (JSON.parse(passkey.transports) as AuthenticatorTransportFuture[])
        : undefined,
    },
  });
  if (!result.verified) throw new Error('The passkey did not verify.');
  db.query(
    'UPDATE passkey SET counter = ?, last_used_at = ? WHERE id = ?;',
  ).run(result.authenticationInfo.newCounter, now(), passkey.id);
  return passkey.person_id;
};

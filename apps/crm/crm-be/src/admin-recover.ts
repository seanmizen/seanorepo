/**
 * Where: `bun run admin:recover <email>` in crm-be (on the box, through SSH).
 * When: a person (normally the admin) lost each passkey.
 * Why: SSH access to the box is the root of trust. There is no recovery by
 * email (docs/001-guiding-design.md, "Lockout recovery").
 *
 * The command does these steps for the person with `<email>`:
 * 1. It deletes each passkey of the person.
 * 2. It revokes each session of the person.
 * 3. It prints a single-use enrolment link. The link expires after
 *    RECOVERY_MINUTES. It opens `/login/recover`, which starts a recovery
 *    session that can only add a passkey.
 */
import type { Database } from 'bun:sqlite';
import {
  audit,
  hash,
  newToken,
  normalizeEmail,
  PUBLIC_URL,
  RECOVERY_MINUTES,
} from './auth';
import { DB_PATH, openDatabase } from './db';

/**
 * Do the recovery for `email`. Returns the enrolment link. Throws when no
 * person has this email.
 */
export const recover = (db: Database, email: string) => {
  const person = db
    .query<{ id: string }, [string]>(
      'SELECT id FROM person WHERE lower(email) = ?;',
    )
    .get(normalizeEmail(email));
  if (!person) throw new Error(`No person has the email "${email}".`);
  const token = newToken();
  db.transaction(() => {
    const passkeys = db
      .query<{ id: string }, [string]>(
        'DELETE FROM passkey WHERE person_id = ? RETURNING id;',
      )
      .all(person.id);
    const sessions = db
      .query<{ id: string }, [string]>(
        'DELETE FROM session WHERE person_id = ? RETURNING id;',
      )
      .all(person.id);
    db.query(
      'INSERT INTO recovery_token (id, person_id, token_hash, expires_at) VALUES (?, ?, ?, ?);',
    ).run(
      crypto.randomUUID(),
      person.id,
      hash(token),
      new Date(Date.now() + RECOVERY_MINUTES * 60 * 1000).toISOString(),
    );
    audit(db, 'admin:recover', 'recover', 'person', person.id, {
      passkeys_deleted: passkeys.map((row) => row.id),
      sessions_revoked: sessions.map((row) => row.id),
    });
  })();
  return `${PUBLIC_URL}/login/recover?${new URLSearchParams({ token })}`;
};

if (import.meta.main) {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: bun run admin:recover <email>');
    process.exit(1);
  }
  const db = openDatabase(DB_PATH);
  try {
    const link = recover(db, email);
    console.log(
      `Deleted the passkeys and revoked the sessions of ${normalizeEmail(email)}.`,
    );
    console.log(
      `Open this link one time, in the next ${RECOVERY_MINUTES} minutes, to add a passkey:`,
    );
    console.log(link);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

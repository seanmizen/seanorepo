import { Field } from './Field';
import { Key } from './Key';

/**
 * The two passkey controls. `crm-fe/src/passkeys.ts` runs them. WebAuthn
 * needs JavaScript, so the server renders each control `hidden`, with a note
 * that says passkeys need JavaScript. The script shows the control and
 * removes the note. This is the one exception to REQ-CRM-BARE-001.
 *
 * Put each control in a `<section>` (a `Panel`). The script finds the note
 * and the error line in the same section. After a success, the script opens
 * `next`.
 */

/** The longest passkey name. `POST /api/passkeys/register` checks it too. */
export const NAME_MAX = 60;

/** The form that adds a passkey to this device. */
export const AddPasskey = ({ next }: { next: string }) => (
  <>
    <p data-passkey-note="">
      Passkeys need JavaScript. Turn on JavaScript to add a passkey.
    </p>
    <form hidden data-passkey="register" data-next={next}>
      <p>
        <Field label="Name">
          <input
            name="name"
            required
            maxLength={NAME_MAX}
            placeholder="iPhone"
          />
        </Field>
      </p>
      <p role="alert" hidden data-passkey-error="" />
      <p>
        <Key>Add a passkey</Key>
      </p>
    </form>
  </>
);

/**
 * The "Sign in with a passkey" key. `note` is the text to show when the
 * browser runs no JavaScript.
 */
export const PasskeySignIn = ({
  next,
  note,
}: {
  next: string;
  note: string;
}) => (
  <>
    <p data-passkey-note="">{note}</p>
    <p role="alert" hidden data-passkey-error="" />
    <p>
      <Key type="button" hidden data-passkey="sign-in" data-next={next}>
        Sign in with a passkey
      </Key>
    </p>
  </>
);

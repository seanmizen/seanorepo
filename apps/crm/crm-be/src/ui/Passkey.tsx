import { Field } from './Field';
import { Key } from './Key';

/**
 * The two passkey controls. `crm-fe/src/passkeys.ts` runs them. WebAuthn
 * needs JavaScript, so the server renders each control off, with a note
 * that says passkeys need JavaScript. The note is the reason of the key
 * (REQ-CRM-BUTTON-001). The script turns the control on and removes the
 * note. This is the one exception to REQ-CRM-BARE-001.
 *
 * Put each control in a `Module` (a `<section>`). The script finds the note
 * and the error line in the same section. After a success, the script opens
 * `next`.
 */

/** The longest passkey name. `POST /api/passkeys/register` checks it too. */
export const NAME_MAX = 60;

/** The id of the note that says passkeys need JavaScript. */
const NOTE_ID = 'passkey-note';

/**
 * The form that adds a passkey to this device. With `off` (the reason that
 * this session cannot add a passkey), the form stays in its place, off, and
 * the script does not turn it on.
 */
export const AddPasskey = ({ next, off }: { next: string; off?: string }) => {
  const note = 'Passkeys need JavaScript. Turn on JavaScript to add a passkey.';
  const field = (
    <Field label="Name">
      <input
        name="name"
        required
        maxLength={NAME_MAX}
        placeholder="iPhone"
        disabled
      />
    </Field>
  );
  if (off !== undefined) {
    return (
      <form>
        {field}
        <Key id="passkey-add" off={off}>
          Add a passkey
        </Key>
      </form>
    );
  }
  return (
    <>
      <p id={NOTE_ID} data-passkey-note="">
        {note}
      </p>
      <form data-passkey="register" data-next={next}>
        {field}
        <p role="alert" hidden data-passkey-error="" />
        <Key id="passkey-add" off={note} aria-describedby={NOTE_ID}>
          Add a passkey
        </Key>
      </form>
    </>
  );
};

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
    <p id={NOTE_ID} data-passkey-note="">
      {note}
    </p>
    <p role="alert" hidden data-passkey-error="" />
    <Key
      type="button"
      id="passkey-sign-in"
      off={note}
      aria-describedby={NOTE_ID}
      data-passkey="sign-in"
      data-next={next}
    >
      Sign in with a passkey
    </Key>
  </>
);

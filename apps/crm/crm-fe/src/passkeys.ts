// The passkey buttons on /login and /account/passkeys. WebAuthn has no HTML
// form, so this is the one script that a page needs (the exception in
// REQ-CRM-BARE-001). The server renders each passkey control `hidden`, with a
// note that says passkeys need JavaScript. This script shows the control and
// removes the note.
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import type { ApiError, PasskeySignInResponse } from '../../shared/types';

/** POST `body` as JSON to `url`. Throws the server's error text on a failure. */
const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      (data as Partial<ApiError>).error ?? `HTTP ${response.status}`,
    );
  }
  return data as T;
};

/** Show `error` in the `[data-passkey-error]` element of `root`. */
const showError = (root: ParentNode, error: unknown) => {
  const alert = root.querySelector<HTMLElement>('[data-passkey-error]');
  if (!alert) return;
  alert.textContent =
    error instanceof Error && error.name === 'NotAllowedError'
      ? 'The passkey request was cancelled or timed out.'
      : error instanceof Error
        ? error.message
        : String(error);
  alert.hidden = false;
};

/** Show the note in place of the control when the browser has no WebAuthn. */
const ready = (root: ParentNode, control: HTMLElement) => {
  const note = root.querySelector<HTMLElement>('[data-passkey-note]');
  if (!browserSupportsWebAuthn()) {
    if (note) note.textContent = 'This browser cannot use passkeys.';
    return false;
  }
  note?.remove();
  control.hidden = false;
  return true;
};

const signIn = document.querySelector<HTMLButtonElement>(
  '[data-passkey="sign-in"]',
);
if (signIn) {
  const root = signIn.closest('section') ?? document;
  if (ready(root, signIn)) {
    signIn.addEventListener('click', async () => {
      signIn.disabled = true;
      try {
        const optionsJSON = await postJson<
          Parameters<typeof startAuthentication>[0]['optionsJSON']
        >('/api/passkeys/sign-in-options', {});
        const response = await startAuthentication({ optionsJSON });
        const { next } = await postJson<PasskeySignInResponse>(
          '/api/passkeys/sign-in',
          { response, next: signIn.dataset.next ?? '/' },
        );
        location.assign(next);
      } catch (error) {
        showError(root, error);
        signIn.disabled = false;
      }
    });
  }
}

const register = document.querySelector<HTMLFormElement>(
  'form[data-passkey="register"]',
);
if (register) {
  const root = register.closest('section') ?? document;
  if (ready(root, register)) {
    register.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = register.querySelector('button');
      if (button) button.disabled = true;
      try {
        const name = new FormData(register).get('name');
        const optionsJSON = await postJson<
          Parameters<typeof startRegistration>[0]['optionsJSON']
        >('/api/passkeys/register-options', {});
        const response = await startRegistration({ optionsJSON });
        await postJson('/api/passkeys/register', { name, response });
        location.assign('/account/passkeys');
      } catch (error) {
        showError(root, error);
        if (button) button.disabled = false;
      }
    });
  }
}

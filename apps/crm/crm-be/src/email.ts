/**
 * Email sending. This is the only module that sends email.
 *
 * Env vars (the README lists them too):
 * - EMAIL_API_KEY: the provider key. Unset means dev mode: the email goes to
 *   stdout (or into `devOutbox` in tests), and nothing leaves the machine.
 * - EMAIL_PROVIDER: `resend` or `postmark`. Necessary when EMAIL_API_KEY has a value.
 * - EMAIL_FROM: the sender address. Necessary when EMAIL_API_KEY has a value.
 */

export interface Email {
  to: string;
  subject: string;
  text: string;
}

const PROVIDERS = ['resend', 'postmark'] as const;
type Provider = (typeof PROVIDERS)[number];

/**
 * In dev mode under `bun test` (NODE_ENV=test), each email goes into this list
 * in place of stdout, so that a test can read the link and the code.
 */
export const devOutbox: Email[] = [];

/** Read the email env vars. Throws when the key has a value but the rest is wrong. */
const config = () => {
  const apiKey = process.env.EMAIL_API_KEY;
  if (!apiKey) return null;
  const provider = process.env.EMAIL_PROVIDER as Provider;
  const from = process.env.EMAIL_FROM;
  if (!PROVIDERS.includes(provider)) {
    throw new Error(
      `EMAIL_PROVIDER must be one of: ${PROVIDERS.join(', ')}. EMAIL_API_KEY has a value.`,
    );
  }
  if (!from) {
    throw new Error('EMAIL_FROM must be set. EMAIL_API_KEY has a value.');
  }
  return { apiKey, provider, from };
};

/** Call at boot, so that a bad email config stops the server now. */
export const checkEmailConfig = () => {
  config();
};

/** The request for each provider. Each one is a JSON POST with a key. */
const request = (
  provider: Provider,
  apiKey: string,
  from: string,
  email: Email,
): { url: string; headers: Record<string, string>; body: object } => {
  if (provider === 'resend') {
    return {
      url: 'https://api.resend.com/emails',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: { from, to: email.to, subject: email.subject, text: email.text },
    };
  }
  return {
    url: 'https://api.postmarkapp.com/email',
    headers: { 'X-Postmark-Server-Token': apiKey },
    body: {
      From: from,
      To: email.to,
      Subject: email.subject,
      TextBody: email.text,
    },
  };
};

/** Send one plain-text email. Throws when the provider refuses it. */
export const sendEmail = async (email: Email): Promise<void> => {
  const settings = config();
  if (!settings) {
    if (process.env.NODE_ENV === 'test') {
      devOutbox.push(email);
    } else {
      console.log(
        `\n--- email (dev mode, not sent) ---\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n---\n`,
      );
    }
    return;
  }
  const { url, headers, body } = request(
    settings.provider,
    settings.apiKey,
    settings.from,
    email,
  );
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${settings.provider} refused the email (HTTP ${response.status}): ${await response.text()}`,
    );
  }
};

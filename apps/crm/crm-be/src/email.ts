/**
 * Email sending. This is the only module that sends email. It sends over
 * SMTP with nodemailer, as caroline-be does, through the shared Gmail sender.
 *
 * Env vars (the README lists them too):
 * - SMTP_PASS: the SMTP password. Unset means dev mode: the email goes to
 *   stdout (or into `devOutbox` in tests), and nothing leaves the machine.
 * - SMTP_USER: the SMTP user and the sender address. Necessary when
 *   SMTP_PASS has a value.
 * - SMTP_HOST: default `smtp.gmail.com`.
 * - SMTP_PORT: default `587`. Port 465 uses TLS from the start.
 * - EMAIL_FROM_NAME: the display name of the sender. Default
 *   `seanmizen.com Administrator`.
 */

import nodemailer, { type SentMessageInfo, type Transporter } from 'nodemailer';

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * In dev mode under `bun test` (NODE_ENV=test), each email goes into this list
 * in place of stdout, so that a test can read the link and the code.
 */
export const devOutbox: Email[] = [];

/** Read the SMTP env vars. Throws when the password has a value and the user has none. */
const config = () => {
  const pass = process.env.SMTP_PASS;
  if (!pass) return null;
  const user = process.env.SMTP_USER;
  if (!user) {
    throw new Error('SMTP_USER must be set. SMTP_PASS has a value.');
  }
  const port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('SMTP_PORT must be a port number.');
  }
  return {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    user,
    pass,
    fromName: process.env.EMAIL_FROM_NAME || 'seanmizen.com Administrator',
  };
};

type Settings = NonNullable<ReturnType<typeof config>>;

/** Call at boot, so that a bad email config stops the server now. */
export const checkEmailConfig = () => {
  config();
};

let smtp: Transporter | null = null;

/** The SMTP transport. crm-be makes it one time, at the first send. */
const smtpTransport = (settings: Settings) => {
  smtp ??= nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    auth: { user: settings.user, pass: settings.pass },
  });
  return smtp;
};

/**
 * Send one plain-text email. The From header is
 * `"<EMAIL_FROM_NAME>" <SMTP_USER>`. A send failure goes to the log with no
 * secret, and the promise does not reject, so the caller's response does not
 * change. Tests give a JSON transport in `transport`.
 */
export const sendEmail = async (
  email: Email,
  transport?: Transporter,
): Promise<SentMessageInfo | null> => {
  const settings = config();
  if (!settings) {
    if (process.env.NODE_ENV === 'test') {
      devOutbox.push(email);
    } else {
      console.log(
        `\n--- email (dev mode, not sent) ---\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n---\n`,
      );
    }
    return null;
  }
  try {
    return await (transport ?? smtpTransport(settings)).sendMail({
      from: { name: settings.fromName, address: settings.user },
      to: email.to,
      subject: email.subject,
      text: email.text,
    });
  } catch (error) {
    // Log only the error code and the SMTP status. The message can echo the
    // SMTP dialogue, so it does not go to the log.
    const { code, responseCode } = (error ?? {}) as {
      code?: string;
      responseCode?: number;
    };
    console.error(
      `The email was not sent. SMTP ${settings.host}:${settings.port}, code ${code ?? 'unknown'}, status ${responseCode ?? 'none'}.`,
    );
    return null;
  }
};

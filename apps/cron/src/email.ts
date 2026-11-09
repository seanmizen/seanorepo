/**
 * Email for the jobs. This is the only module that sends email. It sends over
 * SMTP with nodemailer, through the shared Gmail sender, as crm-be does.
 *
 * Env vars (the README lists them too):
 * - SMTP_PASS: the SMTP password. Unset: email is off. Each email goes to
 *   stdout, and nothing leaves the machine.
 * - SMTP_USER: the SMTP user and the sender address. Necessary when
 *   SMTP_PASS has a value.
 * - SMTP_HOST: default `smtp.gmail.com`.
 * - SMTP_PORT: default `587`. Port 465 uses TLS from the start.
 * - EMAIL_FROM_NAME: the display name of the sender. Default `seanmizen.com cron`.
 * - CRON_EMAIL_TO: the address that gets each email. Necessary when
 *   SMTP_PASS has a value.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailResult } from './job';
import { log } from './log';

export interface Email {
  subject: string;
  text: string;
}

/** Under `bun test`, email that is off goes here in place of stdout. */
export const devOutbox: Email[] = [];

/** Read the env vars. Throws when SMTP_PASS has a value and a value it needs has none. */
const config = () => {
  const pass = process.env.SMTP_PASS;
  if (!pass) return null;
  const user = process.env.SMTP_USER;
  if (!user) throw new Error('SMTP_USER must be set. SMTP_PASS has a value.');
  const to = process.env.CRON_EMAIL_TO;
  if (!to) throw new Error('CRON_EMAIL_TO must be set. SMTP_PASS has a value.');
  const port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('SMTP_PORT must be a port number.');
  }
  return {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    user,
    pass,
    to,
    fromName: process.env.EMAIL_FROM_NAME || 'seanmizen.com cron',
  };
};

/** Call at startup, so that a bad email config stops the service now. */
export const checkEmailConfig = () => config() !== null;

let smtp: Transporter | null = null;

/** Send one plain-text email to CRON_EMAIL_TO. It never throws. */
export const sendEmail = async (email: Email): Promise<EmailResult> => {
  const settings = config();
  if (!settings) {
    if (process.env.NODE_ENV === 'test') devOutbox.push(email);
    else
      log.info(
        `email is off, not sent: ${email.subject}\n${email.text.replace(/^/gm, '  ')}`,
      );
    return 'off';
  }
  smtp ??= nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    auth: { user: settings.user, pass: settings.pass },
  });
  try {
    await smtp.sendMail({
      from: { name: settings.fromName, address: settings.user },
      to: settings.to,
      subject: email.subject,
      text: email.text,
    });
    log.info(`email sent: ${email.subject}`);
    return 'sent';
  } catch (error) {
    // Log only the error code and the SMTP status. The message can echo the
    // SMTP dialogue, so it does not go to the log.
    const { code, responseCode } = (error ?? {}) as {
      code?: string;
      responseCode?: number;
    };
    log.error(
      `email not sent: ${email.subject}. SMTP ${settings.host}:${settings.port}, code ${code ?? 'unknown'}, status ${responseCode ?? 'none'}.`,
    );
    return 'failed';
  }
};

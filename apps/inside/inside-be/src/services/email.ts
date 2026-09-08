import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

/**
 * Whether SMTP is configured well enough to attempt a send.
 *
 * A host alone is not enough — the default .env.example ships a host with
 * blank credentials, which fails at send time with a 502 and leaves a
 * developer unable to sign in at all.
 */
export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
  );
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
  }
  return transporter;
}

/** Escaped before interpolation — a display value must never become markup. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export async function sendMagicLinkEmail(
  email: string,
  link: string,
): Promise<void> {
  const siteName = process.env.SITE_NAME ?? 'inside.space';
  const safeLink = escapeHtml(link);

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: email,
    subject: `Sign in to ${siteName}`,
    text: `Sign in to ${siteName}:\n\n${link}\n\nThis link expires in 15 minutes and can only be used once. If you didn't request it, ignore this email.`,
    html: `<p>Sign in to ${escapeHtml(siteName)}:</p>
<p><a href="${safeLink}">Sign in</a></p>
<p>This link expires in 15 minutes and can only be used once. If you didn't request it, ignore this email.</p>`,
  });
}

export interface ReviewDecisionEmail {
  decision: 'approve' | 'reject';
  studioName: string;
  slug: string;
  note: string | null;
}

/**
 * Tell a designer the outcome of their review.
 *
 * Everything interpolated is escaped: a studio name and a review note are both
 * free text, and a note is written by an admin about a profile whose content
 * the designer controls.
 */
export async function sendReviewDecisionEmail(
  email: string,
  { decision, studioName, slug, note }: ReviewDecisionEmail,
): Promise<void> {
  const siteName = process.env.SITE_NAME ?? 'inside.space';
  const frontend = process.env.FRONTEND_URL ?? 'http://localhost:4060';
  const approved = decision === 'approve';

  const subject = approved
    ? `${studioName} is now listed on ${siteName}`
    : `About your ${siteName} profile`;

  const body = approved
    ? `Your profile is approved and now visible at ${frontend}/designers/${slug}.`
    : `Your profile has not been approved yet.\n\n${note ?? ''}\n\nYou can edit it and submit again at ${frontend}/me/profile.`;

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: email,
    subject,
    text: body,
    html: `<p>${escapeHtml(body).replace(/\n/g, '<br />')}</p>`,
  });
}

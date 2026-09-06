import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

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
  const siteName = process.env.SITE_NAME ?? 'inside';
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

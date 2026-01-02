import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number.parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4020';

// Create transporter
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true for 465, false for other ports
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

export interface MagicLinkEmailOptions {
  to: string;
  token: string;
}

/**
 * Send a magic link email for passwordless login
 */
export async function sendMagicLinkEmail({
  to,
  token,
}: MagicLinkEmailOptions): Promise<void> {
  const magicLink = `${FRONTEND_URL}/admin/verify?token=${token}`;

  const subject = 'Your login link for carolinemizen.art';
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Lato', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Caroline Mizen Art</h1>
          </div>
          <div class="content">
            <h2>Your login link is ready</h2>
            <p>Click the button below to securely log in to your admin panel:</p>
            <p style="text-align: center;">
              <a href="${magicLink}" class="button">Log In</a>
            </p>
            <p style="font-size: 12px; color: #666;">
              This link will expire in 15 minutes.<br>
              If you didn't request this email, you can safely ignore it.
            </p>
            <p style="font-size: 12px; color: #999; margin-top: 30px;">
              Or copy and paste this URL into your browser:<br>
              <span style="word-break: break-all;">${magicLink}</span>
            </p>
          </div>
          <div class="footer">
            carolinemizen.art &copy; ${new Date().getFullYear()}
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `
Your login link for carolinemizen.art

Click the link below to log in:
${magicLink}

This link will expire in 15 minutes.
If you didn't request this email, you can safely ignore it.
  `.trim();

  await transporter.sendMail({
    from: `"Caroline Mizen Art" <${SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });
}

/**
 * Send order confirmation email to customer
 */
export interface OrderConfirmationEmailOptions {
  to: string;
  orderNumber: string;
  artworkTitle: string;
  amountPounds: string;
  shippingAddress: string;
}

export async function sendOrderConfirmationEmail({
  to,
  orderNumber,
  artworkTitle,
  amountPounds,
  shippingAddress,
}: OrderConfirmationEmailOptions): Promise<void> {
  const subject = `Order Confirmation - ${orderNumber}`;
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Lato', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
          .order-details { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
          .order-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Thank You for Your Purchase!</h1>
          </div>
          <div class="content">
            <p>Your order has been confirmed and will be carefully packaged and shipped to you soon.</p>

            <div class="order-details">
              <h3>Order Details</h3>
              <div class="order-row">
                <span>Order Number:</span>
                <strong>${orderNumber}</strong>
              </div>
              <div class="order-row">
                <span>Artwork:</span>
                <strong>${artworkTitle}</strong>
              </div>
              <div class="order-row">
                <span>Total Paid:</span>
                <strong>£${amountPounds}</strong>
              </div>
            </div>

            <div class="order-details">
              <h3>Shipping Address</h3>
              <p>${shippingAddress.replace(/\n/g, '<br>')}</p>
            </div>

            <p>You will receive another email with tracking information once your artwork has been shipped.</p>
          </div>
          <div class="footer">
            Questions? Contact us at ${SMTP_USER}<br>
            carolinemizen.art &copy; ${new Date().getFullYear()}
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `
Thank You for Your Purchase!

Your order has been confirmed and will be shipped soon.

Order Details:
Order Number: ${orderNumber}
Artwork: ${artworkTitle}
Total Paid: £${amountPounds}

Shipping Address:
${shippingAddress}

You will receive tracking information once your artwork has been shipped.
Questions? Contact us at ${SMTP_USER}
  `.trim();

  await transporter.sendMail({
    from: `"Caroline Mizen Art" <${SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });
}

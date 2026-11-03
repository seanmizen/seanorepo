import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import nodemailer from 'nodemailer';
import { checkEmailConfig, sendEmail } from './email';

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

const email = {
  to: 'a@example.com',
  subject: 'Your crm sign-in code: 123456',
  text: 'Open this link: https://crm.example.com/login/verify?token=t\nCode: 123456',
};

const useSmtp = () => {
  process.env.SMTP_USER = 'sender@example.com';
  process.env.SMTP_PASS = 'app-password';
  delete process.env.EMAIL_FROM_NAME;
};

describe('sendEmail', () => {
  test('with no SMTP_PASS, it prints the email to stdout', async () => {
    delete process.env.SMTP_PASS;
    process.env.NODE_ENV = 'development';
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const sendSpy = spyOn(transport, 'sendMail');
    expect(await sendEmail(email, transport)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain('To: a@example.com');
    expect(String(log.mock.calls[0][0])).toContain('Code: 123456');
    expect(sendSpy).not.toHaveBeenCalled();
    log.mockRestore();
  });

  test('with SMTP_PASS, it sends from the display name, with the link and the code', async () => {
    useSmtp();
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const info = await sendEmail(email, transport);
    const message = JSON.parse(info.message);
    expect(message.from).toEqual({
      name: 'seanmizen.com Administrator',
      address: 'sender@example.com',
    });
    expect(message.to).toEqual([{ name: '', address: 'a@example.com' }]);
    expect(message.subject).toBe(email.subject);
    expect(message.text).toContain(
      'https://crm.example.com/login/verify?token=t',
    );
    expect(message.text).toContain('123456');
  });

  test('the From header is "<EMAIL_FROM_NAME>" <SMTP_USER>', async () => {
    useSmtp();
    process.env.EMAIL_FROM_NAME = 'Test Sender';
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });
    const info = await sendEmail(email, transport);
    const raw = String(info.message);
    expect(raw).toContain('From: Test Sender <sender@example.com>');
    expect(raw).toContain('123456');
  });

  test('a send failure goes to the log with no secret, and does not reject', async () => {
    useSmtp();
    const transport = nodemailer.createTransport({ jsonTransport: true });
    spyOn(transport, 'sendMail').mockRejectedValue(
      Object.assign(new Error('Invalid login: app-password'), {
        code: 'EAUTH',
        responseCode: 535,
      }),
    );
    const error = spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendEmail(email, transport)).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0][0]);
    expect(line).toContain('EAUTH');
    expect(line).toContain('535');
    expect(line).not.toContain('app-password');
    error.mockRestore();
  });

  test('SMTP_PASS with no SMTP_USER stops the boot', () => {
    process.env.SMTP_PASS = 'app-password';
    delete process.env.SMTP_USER;
    expect(() => checkEmailConfig()).toThrow(/SMTP_USER/);
    process.env.SMTP_USER = 'sender@example.com';
    expect(() => checkEmailConfig()).not.toThrow();
  });
});

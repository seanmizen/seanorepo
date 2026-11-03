import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { checkEmailConfig, sendEmail } from './email';

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe('sendEmail', () => {
  test('with no EMAIL_API_KEY, it prints the email to stdout', async () => {
    delete process.env.EMAIL_API_KEY;
    process.env.NODE_ENV = 'development';
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = spyOn(globalThis, 'fetch');
    await sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'Body' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain('To: a@example.com');
    expect(fetchSpy).not.toHaveBeenCalled();
    log.mockRestore();
    fetchSpy.mockRestore();
  });

  test('with a key, it POSTs the email to the provider', async () => {
    process.env.EMAIL_API_KEY = 'key';
    process.env.EMAIL_PROVIDER = 'postmark';
    process.env.EMAIL_FROM = 'crm@example.com';
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    await sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'Body' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect(JSON.parse(String(init.body))).toEqual({
      From: 'crm@example.com',
      To: 'a@example.com',
      Subject: 'Hi',
      TextBody: 'Body',
    });
    fetchSpy.mockRestore();
  });

  test('a key with no valid provider or sender stops the boot', () => {
    process.env.EMAIL_API_KEY = 'key';
    process.env.EMAIL_PROVIDER = 'nope';
    process.env.EMAIL_FROM = 'crm@example.com';
    expect(() => checkEmailConfig()).toThrow(/EMAIL_PROVIDER/);
    process.env.EMAIL_PROVIDER = 'resend';
    delete process.env.EMAIL_FROM;
    expect(() => checkEmailConfig()).toThrow(/EMAIL_FROM/);
  });
});

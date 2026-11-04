/** The development default of each signing secret. The repo shows both. */
export const DEV_SECRETS = {
  JWT_SECRET: 'dev-secret-change-in-production',
  COOKIE_SECRET: 'dev-cookie-secret-change-in-production',
} as const;

export type SecretName = keyof typeof DEV_SECRETS;

/**
 * Reads a signing secret. With NODE_ENV=production, an unset value or the
 * development default stops the server: anybody can read the default in the
 * repo and sign a session with it. inside-be has the same check. Outside
 * production, an unset value gives the development default.
 */
export const requireSecret = (
  name: SecretName,
  env: Record<string, string | undefined> = process.env,
): string => {
  const value = env[name];
  if (
    env.NODE_ENV === 'production' &&
    (!value || value === DEV_SECRETS[name])
  ) {
    throw new Error(
      `${name} must be set to a non-default value when NODE_ENV=production. Generate one: openssl rand -base64 32`,
    );
  }
  return value || DEV_SECRETS[name];
};

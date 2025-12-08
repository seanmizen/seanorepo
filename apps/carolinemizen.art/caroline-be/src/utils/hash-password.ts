import { pbkdf2Sync, randomBytes } from 'crypto';

export const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString('hex');
  const iterations = Math.floor(Math.random() * 10000);
  const hash = pbkdf2Sync(password, salt, iterations, 64, `sha512`).toString(
    `hex`,
  );
  return {
    hash,
    salt,
    iterations,
  };
};

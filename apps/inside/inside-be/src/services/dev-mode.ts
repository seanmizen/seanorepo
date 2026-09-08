/**
 * The one place that decides whether this process may hand out a sign-in link
 * without sending an email.
 *
 * Exposing that link is a COMPLETE AUTHENTICATION BYPASS: anyone who can call
 * the endpoint gets a valid session for any address they name. It is only
 * tolerable because it is impossible in production, so the whole decision
 * lives here as pure functions with no I/O, and its tests cover the full
 * truth table rather than the one path we happen to run locally.
 *
 * The frontend never synthesises a link — it renders only what the server
 * chose to send — so this predicate is the entire security boundary.
 */

export interface DevModeInputs {
  /** process.env.NODE_ENV */
  nodeEnv: string | undefined;
  /** process.env.DANGEROUS_BYPASS_EMAIL_MAGIC_LINK === 'true' */
  bypassFlag: boolean;
  /** Whether SMTP is actually configured well enough to send. */
  emailConfigured: boolean;
}

/**
 * We treat anything that is not explicitly production as production-unsafe
 * only in the permissive direction: we require an explicit non-production
 * marker before relaxing anything. `undefined` counts as development, which
 * matches how we run the app locally (`bun src/index.ts` with no NODE_ENV),
 * but never reaches a deployed container — every Dockerfile sets NODE_ENV
 * explicitly, and production additionally refuses to boot without real
 * secrets.
 */
export const isProduction = (nodeEnv: string | undefined): boolean =>
  nodeEnv === 'production';

/**
 * May this process return a usable sign-in link in the HTTP response?
 *
 * Production short-circuits FIRST and unconditionally — no flag, no missing
 * SMTP config, and no combination of the two can reach the permissive branch.
 *
 * Outside production the app allows it when either:
 *   - the operator explicitly asked for it, or
 *   - email is not configured, so the alternative is a 502 and a developer who
 *     cannot sign in at all.
 */
export function shouldExposeDevLink({
  nodeEnv,
  bypassFlag,
  emailConfigured,
}: DevModeInputs): boolean {
  if (isProduction(nodeEnv)) return false;
  return bypassFlag || !emailConfigured;
}

/**
 * Whether to advertise dev mode to the client (drives the "dev" chip).
 *
 * Cosmetic only. Even if somebody tricked a client into believing this, no link
 * exists to render — the link comes from the response body, not from a flag.
 */
export const isDevMode = (nodeEnv: string | undefined): boolean =>
  !isProduction(nodeEnv);

export class InsecureConfigurationError extends Error {}

/**
 * Refuse to start a production process that has the bypass switched on.
 *
 * Silently ignoring the flag would be safe for this request but leaves a box
 * running that its operator believes has an auth bypass — and the next person
 * to change this file might honour it. Crashing makes the misconfiguration
 * impossible to miss, matching how the app handles missing JWT/COOKIE secrets.
 */
export function assertBypassNotProduction(inputs: {
  nodeEnv: string | undefined;
  bypassFlag: boolean;
}): void {
  if (isProduction(inputs.nodeEnv) && inputs.bypassFlag) {
    throw new InsecureConfigurationError(
      'DANGEROUS_BYPASS_EMAIL_MAGIC_LINK must not be set when NODE_ENV=production — it disables authentication.',
    );
  }
}

/** Reads the live environment. Kept apart so the logic above stays pure. */
export const currentDevModeInputs = (
  emailConfigured: boolean,
): DevModeInputs => ({
  nodeEnv: process.env.NODE_ENV,
  bypassFlag: process.env.DANGEROUS_BYPASS_EMAIL_MAGIC_LINK === 'true',
  emailConfigured,
});

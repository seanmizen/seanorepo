/**
 * The demo switch: `CRM_UNSAFE_DEMO_LOGIN`. The demo site
 * (demo-crm.seanmizen.com) runs the same image and the same code as the
 * live site. Only its env is different. When the switch is `true`:
 *
 * 1. `/login` has the `Enter as admin (demo)` button
 *    (`routes/login/demo.tsx`). It starts an admin passkey session with no
 *    check.
 * 2. Every page shows DEMO_TEXT at the top (`ui/DemoBanner.tsx`).
 * 3. `/account` has the `Reset demo data` button
 *    (`routes/account/reset-demo.ts`). It runs the demo seed
 *    (`demo-seed.ts`).
 *
 * Unset means off. index.ts stops crm-be at boot when `demoConfigError`
 * gives a reason, for example the switch on for the live host.
 */

/** The host of the live site. The demo switch must never be on for it. */
export const LIVE_HOST = 'crm.seanmizen.com';

/** The line at the top of every page while the demo switch is on. */
export const DEMO_TEXT =
  'Demo. Anyone can sign in as the admin. Do not enter real data.';

/** The env var of the demo switch. */
const SWITCH = 'CRM_UNSAFE_DEMO_LOGIN';

/**
 * True when `CRM_UNSAFE_DEMO_LOGIN` is `true`. It reads the env on each
 * call, so a test can change it.
 */
export const demoLoginOn = (env: NodeJS.ProcessEnv = process.env) =>
  env[SWITCH] === 'true';

/** True when the host of `publicUrl` is the live host. */
export const isLiveHost = (publicUrl: string | undefined) => {
  try {
    const host = new URL(publicUrl || 'http://localhost:4100').hostname;
    return host.toLowerCase().replace(/\.+$/, '') === LIVE_HOST;
  } catch {
    return false;
  }
};

/**
 * Return the reason why crm-be must not boot with this demo config, or
 * undefined when the config is safe. index.ts calls it at boot.
 *
 * - The switch is `true`, `false` or unset. Each other value is an error,
 *   so a typing error does not leave the reader unsure.
 * - The switch is on and the host of `CRM_PUBLIC_URL` is the live host.
 * - The switch is on and `CRM_ADMIN_EMAIL` is unset: there is no admin to
 *   sign in as.
 */
export const demoConfigError = (env: NodeJS.ProcessEnv = process.env) => {
  const value = env[SWITCH];
  if (
    value !== undefined &&
    value !== '' &&
    !['true', 'false'].includes(value)
  ) {
    return `${SWITCH} must be true, false or unset.`;
  }
  if (!demoLoginOn(env)) return undefined;
  if (isLiveHost(env.CRM_PUBLIC_URL)) {
    return `${SWITCH} is true and the host of CRM_PUBLIC_URL is ${LIVE_HOST}. Remove ${SWITCH} from the env of the live site.`;
  }
  if (!env.CRM_ADMIN_EMAIL?.trim()) {
    return `${SWITCH} is true and CRM_ADMIN_EMAIL is not set. Set CRM_ADMIN_EMAIL.`;
  }
  return undefined;
};

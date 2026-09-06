/**
 * CLI entry point: `yarn workspace inside seed`.
 *
 * Kept thin — everything that matters lives in services/seed.ts, so the
 * behaviour is testable without spawning a process.
 */
import { RefusedInProductionError, seed } from './services/seed';

try {
  const result = await seed();
  console.log(
    `[Seed] ${result.designers} designers, ${result.portfolioProjects} portfolio projects, ` +
      `${result.buyers} buyers, ${result.briefs} briefs, ${result.bids} bids`,
  );
  if (result.skipped) {
    console.log(
      '[Seed] Some records already existed and were left alone. Seeding is idempotent.',
    );
  }
  console.log(
    '[Seed] Sign in as any @inside.test address; the dev link appears on /login.',
  );
} catch (error) {
  if (error instanceof RefusedInProductionError) {
    console.error(`[Seed] ${error.message}`);
    process.exit(1);
  }
  throw error;
}

import { seedDatabase } from './services/db';

console.info('Seeding database...');
await seedDatabase();
console.info('Database seeded successfully!');
process.exit(0);

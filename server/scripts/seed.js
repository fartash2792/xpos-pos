// Creates the demo business + admin user (admin@xpos.local / admin123) if missing.
import { db } from '../src/db.js';
import { seedDemo } from '../src/seed.js';
await db.migrate.latest();
if (await seedDemo()) console.log('Seeded demo business. Login: admin@xpos.local / admin123 (POS PIN 1234)');
else console.log('Seed already applied (admin@xpos.local exists)');
await db.destroy();

// Demo business seeding, shared by `npm run seed` and server startup.
import { db } from './db.js';
import { signup } from './auth.js';

export const DEMO_EMAIL = 'admin@xpos.local';

export async function seedDemo() {
  if (await db('users').where({ email: DEMO_EMAIL }).first()) return false;
  await signup({ name: 'Admin', email: DEMO_EMAIL, password: 'admin123', demo: true,
    business: { name: 'XPOS Demo Store', category: 'retail', phone: '0300-0000000', address: 'Multan, Pakistan', opening_balance: 50000 } });
  return true;
}

// Seed the demo business only when the database has no users at all (fresh deploy).
export async function seedDemoIfEmpty() {
  const row = await db('users').count({ n: '*' }).first();
  if (Number(row?.n || 0) > 0) return false;
  return seedDemo();
}

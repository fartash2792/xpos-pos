import { db } from '../src/db.js';
const [batch, log] = await db.migrate.latest();
console.log(log.length ? `Migrated batch ${batch}: ${log.join(', ')}` : 'Database already up to date');
await db.destroy();

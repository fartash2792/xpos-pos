import { ENTITIES } from '../../shared/entities.js';

export async function up(knex) {
  await knex.schema.createTable('businesses', t => {
    t.string('id', 64).primary();
    t.string('name', 191);
    t.string('category', 64);
    t.bigInteger('created_at');
  });
  await knex.schema.createTable('users', t => {
    t.string('id', 64).primary();
    t.string('business_id', 64).index();
    t.string('name', 191);
    t.string('email', 191).unique();
    t.string('password_hash', 191);
    t.string('pin_hash', 191);
    t.string('role', 32).defaultTo('cashier');
    t.boolean('active').defaultTo(true);
    t.bigInteger('updated_at');
    t.boolean('deleted').defaultTo(false);
    t.bigInteger('seq').index();
  });
  await knex.schema.createTable('sync_state', t => {
    t.integer('id').primary();
    t.bigInteger('seq').defaultTo(0);
  });
  await knex('sync_state').insert({ id: 1, seq: 0 });
  await knex.schema.createTable('counters', t => {
    t.string('business_id', 64);
    t.string('name', 64);
    t.bigInteger('value').defaultTo(0);
    t.primary(['business_id', 'name']);
  });
  for (const e of ENTITIES) {
    if (e === 'users') continue;
    await knex.schema.createTable(e, t => {
      t.string('id', 64).primary();
      t.string('business_id', 64).notNullable();
      t.text('data', 'mediumtext');
      t.bigInteger('updated_at');
      t.boolean('deleted').defaultTo(false);
      t.bigInteger('seq');
      t.string('device_id', 64);
      t.index(['business_id', 'seq']);
    });
  }
}

export async function down(knex) {
  for (const e of ENTITIES) if (e !== 'users') await knex.schema.dropTableIfExists(e);
  for (const t of ['counters', 'sync_state', 'users', 'businesses']) await knex.schema.dropTableIfExists(t);
}

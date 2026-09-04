#!/usr/bin/env node
/**
 * Remove all test data created by seed-test-users.mjs
 * Deletes: testuser001-100 + testpt001-005 and all their related data.
 * Does NOT touch admin or other users.
 *
 * Run: node scripts/cleanup-test-users.mjs
 *      npm run seed:cleanup
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const dotenv = require('dotenv');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../.env') });

const PG_BASE = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5433', 10),
  user: process.env.POSTGRES_USER || 'gymcoach',
  password: process.env.POSTGRES_PASSWORD || 'gymcoach_password',
  ssl: false,
};

const pools = {
  auth:    new Pool({ ...PG_BASE, database: 'gymcoach_auth' }),
  user:    new Pool({ ...PG_BASE, database: 'gymcoach_user' }),
  fitness: new Pool({ ...PG_BASE, database: 'gymcoach_fitness' }),
  ai:      new Pool({ ...PG_BASE, database: 'gymcoach_ai' }),
  chat:    new Pool({ ...PG_BASE, database: 'gymcoach_chat' }),
};

async function main() {
  console.log('🗑️  Cleaning up test data...\n');

  // Get test user IDs from auth DB
  const authConn = await pools.auth.connect();
  const testUsers = await authConn.query(
    `SELECT id FROM users WHERE email ~ '^test(user|pt)[0-9]+@example\\.com$'`
  );
  const ids = testUsers.rows.map(r => r.id);
  console.log(`Found ${ids.length} test users to remove`);

  if (ids.length === 0) {
    console.log('Nothing to clean up.');
    authConn.release();
    await Promise.all(Object.values(pools).map(p => p.end()));
    return;
  }

  const idList = ids.map((_, i) => `$${i + 1}`).join(',');

  // gymcoach_user — cascade handles sessions, reviews, notifications
  const userConn = await pools.user.connect();
  const c1 = await userConn.query(`DELETE FROM contracts WHERE "client_user_id" = ANY($1)`, [ids]);
  const c2 = await userConn.query(`DELETE FROM contracts WHERE "pt_user_id" = ANY($1)`, [ids]);
  const c3 = await userConn.query(`DELETE FROM user_profiles WHERE "userId" = ANY($1)`, [ids]);
  const c4 = await userConn.query(`DELETE FROM inbody_entries WHERE "user_id" = ANY($1)`, [ids]);
  const c5 = await userConn.query(`DELETE FROM notifications WHERE "user_id" = ANY($1)`, [ids]);
  const c6 = await userConn.query(`DELETE FROM pt_availability WHERE "pt_user_id" = ANY($1)`, [ids]);
  console.log(`gymcoach_user: ${c1.rowCount + c2.rowCount} contracts, ${c3.rowCount} profiles, ${c4.rowCount} inbody, ${c5.rowCount} notifications, ${c6.rowCount} availability`);
  userConn.release();

  // gymcoach_fitness
  const fitConn = await pools.fitness.connect();
  const f1 = await fitConn.query(`DELETE FROM workouts WHERE "user_id" = ANY($1)`, [ids]);
  const f2 = await fitConn.query(`DELETE FROM nutrition_logs WHERE "user_id" = ANY($1)`, [ids]);
  const f3 = await fitConn.query(`DELETE FROM body_metrics WHERE "user_id" = ANY($1)`, [ids]);
  const f4 = await fitConn.query(`DELETE FROM workout_programs WHERE "user_id" = ANY($1)`, [ids]);
  const f5 = await fitConn.query(`DELETE FROM workout_schedules WHERE "user_id" = ANY($1)`, [ids]);
  console.log(`gymcoach_fitness: ${f1.rowCount} workouts, ${f2.rowCount} nutrition, ${f3.rowCount} metrics, ${f4.rowCount} programs, ${f5.rowCount} schedules`);
  fitConn.release();

  // gymcoach_ai
  const aiConn = await pools.ai.connect();
  const a1 = await aiConn.query(`DELETE FROM conversations WHERE "user_id" = ANY($1)`, [ids]);
  const a2 = await aiConn.query(`DELETE FROM workout_plans WHERE "user_id" = ANY($1)`, [ids]);
  console.log(`gymcoach_ai: ${a1.rowCount} conversations, ${a2.rowCount} workout_plans`);
  aiConn.release();

  // gymcoach_chat — find conversation IDs where participant is a test user
  const chatConn = await pools.chat.connect();
  const chatConvs = await chatConn.query(
    `SELECT DISTINCT "conversationId" FROM conversation_participants WHERE "userId" = ANY($1)`, [ids]
  );
  const chatConvIds = chatConvs.rows.map(r => r.conversationId);
  let chatDeleted = 0;
  if (chatConvIds.length > 0) {
    const res = await chatConn.query(`DELETE FROM conversations WHERE id = ANY($1)`, [chatConvIds]);
    chatDeleted = res.rowCount;
  }
  console.log(`gymcoach_chat: ${chatDeleted} conversations`);
  chatConn.release();

  // gymcoach_auth — audit_logs cascade via FK
  const del = await authConn.query(
    `DELETE FROM users WHERE email ~ '^test(user|pt)[0-9]+@example\\.com$'`
  );
  console.log(`gymcoach_auth: ${del.rowCount} users removed`);
  authConn.release();

  await Promise.all(Object.values(pools).map(p => p.end()));
  console.log('\n✅ Cleanup complete.');
}

main().catch(err => {
  console.error('❌ Cleanup failed:', err.message);
  process.exit(1);
});

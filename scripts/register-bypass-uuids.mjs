#!/usr/bin/env node
// =============================================================================
// file_id: SOM-SCR-0050-v0.0.1
// name: register-bypass-uuids.mjs
// description: Reads ~/.openclaw.bypass-manifest (project + envKey bookkeeping;
//              no token values) and registers one GYST UUIDv8 per project in
//              uuid_registry, marked type_code=BEARER_SECRET, domain=0xA (REG).
//              Agents reference these UUIDs in heartbeat payloads for audit
//              trail without ever writing token values to the ledger.
// category: SCR
// tags: [gyst, uuid, vercel, audit, secrets]
// created: 2026-04-22
// version: 0.0.1
// =============================================================================
//
// Usage:
//   node register-bypass-uuids.mjs                   # register all from manifest
//   node register-bypass-uuids.mjs --list            # list existing bypass UUIDs
//   node register-bypass-uuids.mjs --revoke <uuid>   # mark revoked (no delete)
//
// Type codes used (add to codebook.ts type registry):
//   0x40A  BEARER_SECRET_VERCEL_BYPASS
//
// Required env (from ~/.openclaw.env):
//   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
// =============================================================================
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// --- env autoload ------------------------------------------------------------
const envCandidates = [
  process.env.APPLY_MIGRATION_ENV_FILE,
  `${homedir()}/.openclaw.env`,
  'D:/somacosf/outputs/somacosf-platform/.env.local',
].filter(Boolean);
for (const f of envCandidates) if (f && existsSync(f)) {
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  break;
}

// --- libsql resolver ---------------------------------------------------------
const pkgCandidates = [
  `${homedir()}/openclaw/package.json`,
  'D:/somacosf/outputs/somacosf-platform/package.json',
].filter(p => existsSync(p));
if (pkgCandidates.length === 0) { console.error('no @libsql/client package.json'); process.exit(2); }
const require = createRequire(path.resolve(pkgCandidates[0]));
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// --- GYST UUIDv8 mint for bearer secret --------------------------------------
// Bit layout (128 bits):
//   type(12) + namespace(12) + timestamp(24) + version(4=0x8) + depth(4)
//   + domain(4) + generation(4) + variant(2) + random(62)
//
// We mint with: type=0x40A (BEARER_SECRET_VERCEL_BYPASS), domain=0xA (REG),
// namespace=fnv12(project), random=62 bits.
function fnv12(s) {
  let h = 0x811c9dc5n;
  for (const c of s) { h ^= BigInt(c.charCodeAt(0)); h = (h * 0x01000193n) & 0xFFFFFFFFn; }
  return Number(h & 0xFFFn);
}
function mintGystUuid({ typeCode, domain, namespace }) {
  const ts = Math.floor(Date.now() / 1000) & 0xFFFFFF; // 24 bits
  const rnd = randomBytes(8);
  const r62hi = rnd.readUInt32BE(0) & 0x3FFFFFFF;       // top 30 random bits
  const r62lo = rnd.readUInt32BE(4);                    // bottom 32 random bits
  const variant = 0b10;                                 // RFC4122-ish
  // Pack into 16 bytes
  const b = Buffer.alloc(16);
  // bytes 0..2 = type(12) + namespace(12) split across 3 bytes (24 bits)
  const top24 = ((typeCode & 0xFFF) << 12) | (namespace & 0xFFF);
  b[0] = (top24 >> 16) & 0xFF;
  b[1] = (top24 >> 8) & 0xFF;
  b[2] = top24 & 0xFF;
  // bytes 3..5 = timestamp 24
  b[3] = (ts >> 16) & 0xFF;
  b[4] = (ts >> 8) & 0xFF;
  b[5] = ts & 0xFF;
  // byte 6 = version(4=8) + depth(4=0)
  b[6] = (0x8 << 4) | 0x0;
  // byte 7 = domain(4) + generation(4)
  b[7] = ((domain & 0xF) << 4) | (1 & 0xF);
  // byte 8 = variant(2) + top 6 of random
  b[8] = (variant << 6) | ((r62hi >> 24) & 0x3F);
  // bytes 9..15 = remaining 56 bits of random
  b[9]  = (r62hi >> 16) & 0xFF;
  b[10] = (r62hi >> 8) & 0xFF;
  b[11] = r62hi & 0xFF;
  b[12] = (r62lo >> 24) & 0xFF;
  b[13] = (r62lo >> 16) & 0xFF;
  b[14] = (r62lo >> 8) & 0xFF;
  b[15] = r62lo & 0xFF;
  const hex = b.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// --- main --------------------------------------------------------------------
async function ensureTable() {
  await db.execute(`CREATE TABLE IF NOT EXISTS uuid_registry (
    uuid TEXT PRIMARY KEY,
    type_code INTEGER NOT NULL,
    namespace INTEGER,
    domain INTEGER,
    provenance INTEGER,
    signal REAL,
    metadata TEXT,
    created_at INTEGER,
    revoked_at INTEGER
  )`);
}

async function registerManifest() {
  const manifestPath = `${homedir()}/.openclaw.bypass-manifest`;
  if (!existsSync(manifestPath)) {
    console.error(`no manifest at ${manifestPath} — run mint-bypass-tokens.sh first`);
    process.exit(2);
  }
  const lines = readFileSync(manifestPath, 'utf8').trim().split('\n').filter(Boolean);
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  for (const e of entries) {
    // Skip if we already registered this envKey (one UUID per active key).
    const existing = await db.execute({
      sql: `SELECT uuid FROM uuid_registry WHERE type_code = 0x40A
              AND metadata LIKE ? AND revoked_at IS NULL`,
      args: [`%"envKey":"${e.envKey}"%`],
    });
    if (existing.rows.length > 0) {
      console.log(`  skip  ${e.envKey}  already=${existing.rows[0].uuid}`);
      continue;
    }
    const uuid = mintGystUuid({ typeCode: 0x40A, domain: 0xA, namespace: fnv12(e.project) });
    const meta = JSON.stringify({
      project: e.project,
      envKey: e.envKey,
      note: e.note,
      rotation_due: e.rotation_due,
      // NOTE: token value is NEVER stored. Agents load from process.env[envKey].
    });
    await db.execute({
      sql: `INSERT INTO uuid_registry(uuid, type_code, namespace, domain, metadata, created_at)
            VALUES (?, 0x40A, ?, 0xA, ?, strftime('%s','now'))`,
      args: [uuid, fnv12(e.project), meta],
    });
    console.log(`  mint  ${e.envKey}  ${uuid}  project=${e.project}`);
  }
}

async function listBypassUuids() {
  const r = await db.execute(`
    SELECT uuid, metadata, created_at, revoked_at
      FROM uuid_registry WHERE type_code = 0x40A
     ORDER BY created_at DESC`);
  for (const row of r.rows) {
    const m = JSON.parse(String(row.metadata ?? '{}'));
    const status = row.revoked_at ? 'REVOKED' : 'ACTIVE';
    console.log(`  ${status.padEnd(8)} ${row.uuid}  ${m.project ?? '?'}  ${m.envKey ?? '?'}`);
  }
}

async function revoke(uuid) {
  await db.execute({
    sql: `UPDATE uuid_registry SET revoked_at = strftime('%s','now') WHERE uuid = ?`,
    args: [uuid],
  });
  console.log(`revoked ${uuid}`);
}

async function main() {
  await ensureTable();
  const argv = process.argv.slice(2);
  if (argv[0] === '--list') return listBypassUuids();
  if (argv[0] === '--revoke') return revoke(argv[1]);
  return registerManifest();
}

main().catch(e => { console.error(`fatal: ${e.stack ?? e.message}`); process.exit(1); });

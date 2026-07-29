#!/usr/bin/env node
// =============================================================================
// file_id: SOM-SCR-0045-v0.0.1
// name: vault-scaffold.mjs
// description: Materializes ~/vaults/<name>/ for Vertex, Voxel, or vector_NN.
//              Idempotent. Writes birth.md frontmatter from agent row. Cross-
//              links child vaults into the parent's agents/ folder. Stamps a
//              .obsidian/ config so each vault opens clean.
// category: SCR
// tags: [colloquy, vault, obsidian, vertex, voxel, vector]
// created: 2026-04-22
// version: 0.0.1
// =============================================================================
//
// Usage:
//   node vault-scaffold.mjs --agent-uuid <uuid>
//   node vault-scaffold.mjs --allocate-vector   # prints next vector_NN name
//   node vault-scaffold.mjs --list              # show all vault dirs + status
// =============================================================================
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

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

const pkgCandidates = [
  `${homedir()}/openclaw/package.json`,
  'D:/somacosf/outputs/somacosf-platform/package.json',
].filter(p => existsSync(p));
if (pkgCandidates.length === 0) { console.error('no @libsql/client package.json'); process.exit(2); }
const require = createRequire(path.resolve(pkgCandidates[0]));
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const VAULTS_ROOT = process.env.VAULTS_ROOT ?? `${homedir()}/vaults`;

// ---------- Obsidian config stamp ---------------------------------------------
const OBSIDIAN_CONFIG = {
  'app.json': JSON.stringify({ legacyEditor: false, showUnsupportedFiles: false }, null, 2),
  'appearance.json': JSON.stringify({ theme: 'obsidian' }, null, 2),
  'core-plugins.json': JSON.stringify([
    'file-explorer', 'global-search', 'switcher', 'graph', 'backlink',
    'tag-pane', 'properties', 'page-preview', 'daily-notes', 'templates',
    'outline', 'word-count', 'file-recovery',
  ], null, 2),
};

function stampObsidian(vaultDir) {
  const obDir = path.join(vaultDir, '.obsidian');
  if (!existsSync(obDir)) mkdirSync(obDir, { recursive: true });
  for (const [f, content] of Object.entries(OBSIDIAN_CONFIG)) {
    const p = path.join(obDir, f);
    if (!existsSync(p)) writeFileSync(p, content);
  }
}

// ---------- per-persona vault shape -------------------------------------------
function shapeFor(codebookName) {
  if (codebookName === 'persona-vertex-v1') {
    return { name: 'vertex', subdirs: ['daily', 'agents', 'projects', 'contracts', 'colloquies'] };
  }
  if (codebookName === 'persona-voxel-v1' || codebookName === 'persona-hermes-v1') {
    return { name: 'voxel', subdirs: ['daily', 'hops', 'peers', 'colloquies'] };
  }
  if (codebookName === 'persona-openclaw-v1') {
    return { name: 'openclaw', subdirs: ['daily', 'spawns', 'witness-ledger'] };
  }
  if (codebookName === 'persona-vector-v1') {
    // caller sets the numeric suffix via {instanceName}
    return { name: null /* resolved by caller */, subdirs: ['colloquies'] };
  }
  // generic fallback
  return { name: codebookName.replace(/^persona-/, '').replace(/-v\d+$/, ''), subdirs: ['daily'] };
}

async function allocateVectorNumber(host) {
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM agents a
            JOIN codebook_personas cp ON cp.codebook_uuid = a.codebook_uuid
           WHERE cp.name = 'persona-vector-v1' AND a.host = ?`,
    args: [host],
  });
  const next = Number(r.rows[0].n) + 1;
  return `vector_${String(next).padStart(2, '0')}`;
}

async function loadAgent(agent_uuid) {
  const r = await db.execute({
    sql: `SELECT a.*, cp.name AS codebook_name, cp.domain AS cb_domain, cp.witness_policy AS cb_witness
            FROM agents a
            JOIN codebook_personas cp ON cp.codebook_uuid = a.codebook_uuid
           WHERE a.agent_uuid = ?`,
    args: [agent_uuid],
  });
  if (r.rows.length === 0) throw new Error(`agent ${agent_uuid} not found`);
  return r.rows[0];
}

function birthFrontmatter(agent, vaultName) {
  return `---
vault_name: ${vaultName}
agent_uuid: ${agent.agent_uuid}
parent_agent_uuid: ${agent.parent_agent_uuid ?? 'null'}
codebook_uuid: ${agent.codebook_uuid}
codebook_name: ${agent.codebook_name}
host: ${agent.host ?? 'unknown'}
spawn_depth: ${agent.spawn_depth ?? 0}
sandbox_tier: ${agent.sandbox_tier ?? 'null'}
sandbox_vm_id: ${agent.sandbox_vm_id ?? 'null'}
witness_policy: ${agent.cb_witness}
domain: 0x${Number(agent.cb_domain).toString(16)}
birth_heartbeat_uuid: ${agent.birth_heartbeat_uuid ?? 'null'}
birth_iso: ${new Date().toISOString()}
file_id: SOM-VLT-birth-${String(agent.agent_uuid).slice(0, 8)}
category: VLT
tags: [birth, ${agent.codebook_name}]
---

# ${vaultName} — birth

Vault for agent \`${agent.agent_uuid}\` (codebook \`${agent.codebook_name}\`).
Parent: \`${agent.parent_agent_uuid ?? '(root)'}\`.
Host: \`${agent.host ?? 'unknown'}\`.
Sandbox: tier ${agent.sandbox_tier ?? 'none'}, vm_id=\`${agent.sandbox_vm_id ?? 'none'}\`.

## Lineage

See \`~/vaults/vertex/agents/${vaultName}.md\` for the cross-link back into Vertex's record, and follow \`parent_agent_uuid\` for the full chain.

## Directive

Written to \`task.md\` by the spawning parent. See that file for the live directive.
`;
}

async function scaffoldFor(agent_uuid) {
  const agent = await loadAgent(agent_uuid);
  const shape = shapeFor(String(agent.codebook_name));
  let vaultName = shape.name;
  if (!vaultName && String(agent.codebook_name) === 'persona-vector-v1') {
    // vector_NN — count is fixed at birth; payload.number if present, else current count
    const existing = readdirSync(VAULTS_ROOT, { withFileTypes: true }).filter(d => d.isDirectory() && /^vector_\d+$/.test(d.name));
    vaultName = `vector_${String(existing.length + 1).padStart(2, '0')}`;
  }
  if (!vaultName) throw new Error(`cannot resolve vault name for codebook ${agent.codebook_name}`);

  const vaultDir = path.join(VAULTS_ROOT, vaultName);
  mkdirSync(vaultDir, { recursive: true });
  for (const sub of shape.subdirs) mkdirSync(path.join(vaultDir, sub), { recursive: true });

  stampObsidian(vaultDir);

  const birthPath = path.join(vaultDir, 'birth.md');
  if (!existsSync(birthPath)) writeFileSync(birthPath, birthFrontmatter(agent, vaultName));

  // Cross-link into Vertex's agents/ folder (if Vertex vault exists)
  const vertexAgentsDir = path.join(VAULTS_ROOT, 'vertex', 'agents');
  if (existsSync(vertexAgentsDir)) {
    const linkPath = path.join(vertexAgentsDir, `${vaultName}.md`);
    if (!existsSync(linkPath)) {
      writeFileSync(linkPath,
        `---
crosslink: true
target_vault: ${vaultName}
agent_uuid: ${agent.agent_uuid}
codebook_name: ${agent.codebook_name}
indexed_iso: ${new Date().toISOString()}
---

# ${vaultName}

See [[../../${vaultName}/birth|${vaultName}/birth]] for the source of truth.

\`${agent.agent_uuid}\`
`);
    }
  }

  return { vaultName, vaultDir, created: true };
}

// ---------- main --------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--allocate-vector')) {
    const host = argv[argv.indexOf('--allocate-vector') + 1] ?? process.env.HOST ?? 'unknown';
    console.log(await allocateVectorNumber(host));
    process.exit(0);
  }
  if (argv.includes('--list')) {
    if (!existsSync(VAULTS_ROOT)) { console.log(`${VAULTS_ROOT} does not exist`); process.exit(0); }
    const dirs = readdirSync(VAULTS_ROOT, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const d of dirs) {
      const birthPath = path.join(VAULTS_ROOT, d.name, 'birth.md');
      const has = existsSync(birthPath) ? 'OK' : 'no-birth';
      console.log(`  ${d.name.padEnd(16)}  ${has}`);
    }
    process.exit(0);
  }
  const uuidIdx = argv.indexOf('--agent-uuid');
  if (uuidIdx < 0) { console.error('usage: vault-scaffold.mjs --agent-uuid <uuid> | --allocate-vector <host> | --list'); process.exit(2); }
  const agent_uuid = argv[uuidIdx + 1];
  const r = await scaffoldFor(agent_uuid);
  console.log(JSON.stringify(r, null, 2));
}

main().catch(e => { console.error('fatal:', e.stack ?? e.message); process.exit(1); });

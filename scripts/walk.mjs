#!/usr/bin/env node
// =============================================================================
// file_id: SOM-SCR-0022-v0.1.0
// name: walk.mjs
// description: CLI: walk a colloquy's decision tree. Supports text,
//              mermaid, and json output formats. Directly queries
//              Turso via libsql client.
// category: SCR
// tags: [colloquy, walk, tree, mermaid, cli]
// created: 2026-04-22
// version: 0.1.0
// usage: node scripts/walk.mjs <colloquy_uuid> [--format text|mermaid|json]
// =============================================================================

import { createClient } from '@libsql/client';

function shortId(uuid) {
  return uuid.split('-')[0];
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      flags[key] = val;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv);
  const [colloquy_uuid] = positional;
  const format = flags.format || 'text';

  if (!colloquy_uuid) {
    console.error('Usage: walk.mjs <colloquy_uuid> [--format text|mermaid|json]');
    process.exit(1);
  }

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.error('TURSO_DATABASE_URL not set.');
    process.exit(1);
  }

  const db = createClient({ url, authToken });

  const cres = await db.execute({
    sql: 'SELECT * FROM colloquies WHERE colloquy_uuid = ?',
    args: [colloquy_uuid],
  });
  if (!cres.rows.length) {
    console.error('colloquy not found');
    process.exit(1);
  }
  const colloquy = cres.rows[0];

  const hres = await db.execute({
    sql: `SELECT heartbeat_uuid, parent_heartbeat_uuid, turn_uuid, sequence_in_turn,
                 event_kind, event_label, signal, tokens_accumulated, payload_json
          FROM heartbeats
          WHERE colloquy_uuid = ?
          ORDER BY emitted_at ASC`,
    args: [colloquy_uuid],
  });
  const heartbeats = hres.rows;

  if (format === 'json') {
    console.log(JSON.stringify({ colloquy, heartbeats }, null, 2));
    return;
  }

  if (format === 'mermaid') {
    const lines = ['```mermaid', 'graph TD'];
    lines.push(`  ROOT[colloquy ${shortId(colloquy_uuid)}<br/>${colloquy.skill_name ?? '(no skill)'}]`);
    for (const h of heartbeats) {
      const id = shortId(h.heartbeat_uuid);
      const label = `${h.event_kind}<br/>${(h.event_label ?? '').slice(0, 40)}`;
      lines.push(`  ${id}["${label}"]`);
      const parent = h.parent_heartbeat_uuid ? shortId(h.parent_heartbeat_uuid) : 'ROOT';
      lines.push(`  ${parent} --> ${id}`);
      if (h.event_kind === 'retraction') {
        lines.push(`  class ${id} retract`);
      } else if (h.event_kind === 'assertion') {
        lines.push(`  class ${id} assert`);
      } else if (h.event_kind === 'keepalive') {
        lines.push(`  class ${id} dim`);
      }
    }
    lines.push('  classDef retract fill:#f88,stroke:#800');
    lines.push('  classDef assert fill:#8f8,stroke:#080');
    lines.push('  classDef dim fill:#ddd,stroke:#888');
    lines.push('```');
    console.log(lines.join('\n'));
    return;
  }

  // text (default)
  console.log(`\nColloquy ${colloquy_uuid}`);
  console.log(`  skill: ${colloquy.skill_name ?? '(none)'}`);
  console.log(`  mode:  ${colloquy.invocation_mode}`);
  console.log(`  turns: ${colloquy.turn_count}  tokens: in=${colloquy.total_input_tokens} out=${colloquy.total_output_tokens}  cache_hit: ${colloquy.cache_hit_ratio?.toFixed(3)}`);
  console.log(`  heartbeats: ${heartbeats.length}\n`);

  // Build parent→children index
  const children = new Map();
  for (const h of heartbeats) {
    const p = h.parent_heartbeat_uuid ?? 'ROOT';
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(h);
  }

  function render(uuid, depth) {
    const kids = children.get(uuid) ?? [];
    for (const h of kids) {
      const conf = h.signal != null ? `conf=${(h.signal / 65535).toFixed(2)}` : '';
      const tok = h.tokens_accumulated != null ? `tok=${h.tokens_accumulated}` : '';
      const marker = h.event_kind === 'retraction' ? '✗' : h.event_kind === 'assertion' ? '✓' : '·';
      console.log(`${'  '.repeat(depth)}${marker} ${h.event_kind}: ${h.event_label}  [${conf} ${tok}]`);
      render(h.heartbeat_uuid, depth + 1);
    }
  }
  render('ROOT', 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

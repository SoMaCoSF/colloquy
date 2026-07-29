#!/usr/bin/env node
// =============================================================================
// file_id: SOM-SCR-0021-v0.1.0
// name: heartbeat.mjs
// description: CLI: emit a heartbeat into an active colloquy. Useful for
//              agent-explicit semantic heartbeats (plan_branch,
//              confidence_shift, assertion, retraction) that can't be
//              auto-instrumented.
// category: SCR
// tags: [colloquy, heartbeat, cli]
// created: 2026-04-22
// version: 0.1.0
// usage: node scripts/heartbeat.mjs <colloquy_uuid> <kind> <label>
//        [--signal 0xE666] [--parent <uuid>] [--payload '{...}']
// =============================================================================

const KINDS = [
  'tool_call', 'skill_invoke', 'model_route', 'plan_branch',
  'confidence_shift', 'memory_write', 'delegation',
  'assertion', 'retraction', 'uuid_mint', 'keepalive',
];

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
  const [colloquy_uuid, kind, label] = positional;

  if (!colloquy_uuid || !kind || !label) {
    console.error('Usage: heartbeat.mjs <colloquy_uuid> <kind> <label> [--signal 0xE666] [--parent <uuid>] [--payload \'{...}\']');
    console.error('Kinds:', KINDS.join(', '));
    process.exit(1);
  }

  if (!KINDS.includes(kind)) {
    console.error(`Unknown kind: ${kind}. Valid: ${KINDS.join(', ')}`);
    process.exit(1);
  }

  const signal = flags.signal
    ? (String(flags.signal).startsWith('0x')
        ? parseInt(flags.signal, 16)
        : parseInt(flags.signal, 10))
    : 0x8000;

  let payload = null;
  if (flags.payload) {
    try {
      payload = JSON.parse(flags.payload);
    } catch (e) {
      console.error('Invalid --payload JSON:', e.message);
      process.exit(1);
    }
  }

  const vertexUrl = process.env.VERTEX_URL || 'http://100.106.72.94:7374';
  const vertexToken = process.env.VERTEX_TOKEN;

  if (!vertexToken) {
    console.error('VERTEX_TOKEN not set.');
    process.exit(1);
  }

  const resp = await fetch(`${vertexUrl}/v1/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${vertexToken}`,
    },
    body: JSON.stringify({
      colloquy_uuid,
      event_kind: kind,
      event_label: label,
      signal,
      parent_heartbeat_uuid: flags.parent || null,
      payload_json: payload ? JSON.stringify(payload) : null,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`heartbeat failed: ${resp.status} ${text}`);
    process.exit(1);
  }

  const result = await resp.json();
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

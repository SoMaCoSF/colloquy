#!/usr/bin/env node
// =============================================================================
// file_id: SOM-SCR-0023-v0.1.0
// name: fork.mjs
// description: CLI: fork a colloquy at a specific heartbeat. Spawns a new
//              colloquy rooted at that decision point with optional
//              alternate context.
// category: SCR
// tags: [colloquy, fork, counterfactual, cli]
// created: 2026-04-22
// version: 0.1.0
// usage: node scripts/fork.mjs <heartbeat_uuid> [--skill name] [--context '{...}']
// =============================================================================

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
  const [heartbeat_uuid] = positional;

  if (!heartbeat_uuid) {
    console.error('Usage: fork.mjs <heartbeat_uuid> [--skill name] [--context \'{...}\']');
    process.exit(1);
  }

  const vertexUrl = process.env.VERTEX_URL || 'http://100.106.72.94:7374';
  const vertexToken = process.env.VERTEX_TOKEN;
  if (!vertexToken) {
    console.error('VERTEX_TOKEN not set.');
    process.exit(1);
  }

  let context_override = null;
  if (flags.context) {
    try { context_override = JSON.parse(flags.context); }
    catch (e) { console.error('Invalid --context JSON:', e.message); process.exit(1); }
  }

  // Endpoint looks up colloquy from heartbeat_uuid, creates child colloquy,
  // copies ancestry path, emits synthetic fork heartbeat in child.
  const resp = await fetch(`${vertexUrl}/v1/colloquy/fork`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${vertexToken}`,
    },
    body: JSON.stringify({
      from_heartbeat: heartbeat_uuid,
      skill: flags.skill || null,
      context_override,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`fork failed: ${resp.status} ${text}`);
    process.exit(1);
  }

  const result = await resp.json();
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
// =============================================================================
// file_id: SOM-SCR-0020-v0.1.0
// name: mint.mjs
// description: CLI: mint a new colloquy. Calls POST /v1/colloquy/mint on the
//              openclaw daemon, or mints locally against a direct Turso
//              connection if --direct flag is set. Prints colloquy_uuid and
//              per-party session UUIDs.
// category: SCR
// tags: [colloquy, mint, cli]
// created: 2026-04-22
// version: 0.1.0
// usage: node scripts/mint.mjs --skill <name> --parties <a,b,c> [--telemetry heartbeat]
// =============================================================================

import { mintColloquyUUID, deriveAgentSessionUUID } from './lib/derive.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const skill = args.skill || args.s;
  const partiesArg = args.parties || args.p;
  const telemetry = args.telemetry || 'heartbeat';
  const vertexUrl = process.env.VERTEX_URL || 'http://100.106.72.94:7374';
  const vertexToken = process.env.VERTEX_TOKEN;

  if (!skill || !partiesArg) {
    console.error('Usage: mint.mjs --skill <name> --parties <a,b,c> [--telemetry mode]');
    process.exit(1);
  }

  const parties = String(partiesArg).split(',').map(s => s.trim());

  if (args.direct) {
    // Local mint path (for testing without daemon)
    const [initiatorName, ...rest] = parties;
    const initiator = {
      agent_uuid: `local-${initiatorName}`,  // placeholder; real code looks up agents table
      domain: initiatorName === 'somaco' ? 0x2 : 0x6,
      provenance: initiatorName === 'somaco' ? 0x1 : 0x2,
    };
    const { uuid: colloquy_uuid, nonce, timestamp_s } = mintColloquyUUID({ initiator });
    console.log(JSON.stringify({
      colloquy_uuid, nonce, timestamp_s, skill, telemetry_mode: telemetry,
      session_uuids: parties.map(p => ({
        party: p,
        session_uuid: deriveAgentSessionUUID({
          agent: { agent_uuid: `local-${p}`, domain: p === 'somaco' ? 0x2 : 0x6, provenance: p === 'somaco' ? 0x1 : 0x2 },
          colloquy_uuid,
        }),
      })),
    }, null, 2));
    return;
  }

  // Daemon path
  if (!vertexToken) {
    console.error('VERTEX_TOKEN not set. source D:/somacosf/utils/.env.vertex or pass --direct');
    process.exit(1);
  }

  const resp = await fetch(`${vertexUrl}/v1/colloquy/mint`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${vertexToken}`,
    },
    body: JSON.stringify({ skill, parties, telemetry_mode: telemetry }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`mint failed: ${resp.status} ${text}`);
    process.exit(1);
  }

  const result = await resp.json();
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

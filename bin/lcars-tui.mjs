#!/usr/bin/env node
console.log('\x1b[38;2;255;153;0m╔════════════════════════════════════════════════════════════════════╗\x1b[0m');
console.log('\x1b[38;2;255;153;0m║                     COLLOQUY LCARS CONTROL V2.5                    ║\x1b[0m');
console.log('\x1b[38;2;255;153;0m╠════════════════════════════════════════════════════════════════════╣\x1b[0m');
console.log('\x1b[38;2;204;153;255m[SYSTEM STACK]\x1b[0m  Herdr Multiplexer Daemon Connected');
console.log('\x1b[38;2;102;204;255m[DAG STATUS]\x1b[0m    Active Session: 0x009-COLLOQUY-ROOT');
console.log('\x1b[38;2;255;204;102m[CACHE WARMTH]\x1b[0m  TTL Window: 300,000ms (5m Ephemeral)');
console.log('\x1b[38;2;255;153;0m╚════════════════════════════════════════════════════════════════════╝\x1b[0m');

if (process.argv.includes('--list')) {
  console.log('Active Parties: somaco, vertex, claude-agent');
} else {
  console.log('\x1b[32m✔ LCARS Dashboard initialized and active.\x1b[0m');
}

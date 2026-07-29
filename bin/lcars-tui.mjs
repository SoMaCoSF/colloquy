#!/usr/bin/env node

/**
 * Colloquy Interactive LCARS TUI Dashboard
 * Features: Multi-Pane Focus (Files, Network Map, DAG Tree), ASCII Telemetry Loop.
 */

import readline from 'readline';

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  orange: "\x1b[38;2;255;153;0m",
  purple: "\x1b[38;2;204;153;255m",
  cyan: "\x1b[38;2;102;204;255m",
  gold: "\x1b[38;2;255;204;102m",
  green: "\x1b[38;2;51;204;102m",
  red: "\x1b[38;2;255;102;102m",
  selected: "\x1b[48;2;255;153;0m\x1b[30m",
  selectedCyan: "\x1b[48;2;102;204;255m\x1b[30m",
  selectedPurple: "\x1b[48;2;204;153;255m\x1b[30m"
};

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
let spinnerIndex = 0;

const state = {
  activePane: "network", // "files" | "network" | "dag"
  fileIndex: 0,
  netIndex: 0,
  dagIndex: 0,
  activeColloquy: "0x009-82F1-9A4B-2026",
  cacheWarmStart: Date.now(),
  
  // 1. Repository Files
  files: [
    { name: "schema/colloquy-tables.sql" },
    { name: "bin/colloquy-daemon.mjs" },
    { name: "bin/mint.mjs" },
    { name: "bin/heartbeat.mjs" },
    { name: "bin/fork.mjs" },
    { name: "lib/derive.mjs" }
  ],

  // 2. Swarm Model Network Topology
  network: [
    { id: "ROOT-ORCHESTRATOR", model: "claude-3-7-sonnet", type: "root", ping: "24ms", status: "ONLINE" },
    { id: "├─► SUB-AGENT-01", model: "claude-3-5-haiku", type: "worker", ping: "18ms", status: "ACTIVE" },
    { id: "│   └─► TOOL-EXPRT", model: "gpt-4o-mini", type: "leaf", ping: "42ms", status: "IDLE" },
    { id: "└─► AUDIT-VERIFIER", model: "deepseek-r1", type: "worker", ping: "65ms", status: "VERIFYING" }
  ],

  // 3. Causal DAG Tree Nodes
  nodes: [
    { type: "session", id: "0x00A-SESS-SOMACO", label: "somaco / Human", depth: 0 },
    { type: "turn", id: "0x005-TURN-001", label: '"Refactor index strategy"', depth: 1 },
    { type: "heartbeat", id: "0x825-NODE-E666", label: "[plan_branch] signal:0xE666", depth: 2 },
    { type: "session", id: "0x00A-SESS-VERTEX", label: "vertex / Agent", depth: 0 },
    { type: "turn", id: "0x005-TURN-002", label: '"Schema migration patch"', depth: 1 },
    { type: "heartbeat", id: "0x825-NODE-9000", label: "[assertion] signal:0x9000", depth: 2 },
    { type: "fork", id: "0x009-FORK-CHILD", label: "[Counterfactual Branch]", depth: 0 }
  ],

  logs: [
    "Herdr socket daemon connected on local socket",
    "Model network map synced (4 active routes)",
    "5-minute ephemeral prompt cache active"
  ],
  statusMessage: "[TAB] Cycle Pane (Files -> Net -> DAG) | [UP/DOWN] Navigate | [F] Fork | [Q] Quit"
};

function render() {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");

  const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
  const elapsedSec = Math.floor((Date.now() - state.cacheWarmStart) / 1000);
  const ttlSeconds = Math.max(0, 300 - (elapsedSec % 300));
  const cachePercent = Math.floor((ttlSeconds / 300) * 100);
  
  const animFrame = SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length];
  spinnerIndex++;

  let out = "";

  // Header Banner
  out += `${ANSI.orange}╔═════════════════════════════════════════════════════════════════════════════════════════════════════════╗${ANSI.reset}\n`;
  out += `${ANSI.orange}║ ${ANSI.selected}${ANSI.bold} LCARS-24 █ COLLOQUY MODEL NETWORK & CAUSAL TELEMETRY ${ANSI.reset}           ${ANSI.cyan}${animFrame} LIVE ${ANSI.orange}[${timestamp}] ║${ANSI.reset}\n`;
  out += `${ANSI.orange}╠═════════════════════════════════════════════════════════════════════════════════════════════════════════╣${ANSI.reset}\n`;

  // System Stats
  out += `${ANSI.purple}[HERDR MULTIPLEXER]${ANSI.reset} Socket: Active | Workspace: w4 | Node: v24.11.1\n`;
  out += `${ANSI.gold}[PROMPT CACHE TTL] ${ANSI.reset} [${"█".repeat(Math.floor(cachePercent / 5))}${"░".repeat(20 - Math.floor(cachePercent / 5))}] ${cachePercent}% (${ttlSeconds}s remaining)\n`;
  out += `${ANSI.cyan}[ACTIVE PANE]      ${ANSI.reset} ${ANSI.bold}${state.activePane.toUpperCase()}${ANSI.reset} | Root DAG: ${state.activeColloquy}\n`;

  out += `${ANSI.orange}─────────────────────────────────────────────────────────────────────────────────────────────────────────${ANSI.reset}\n`;

  // Column Headers
  const isFiles = state.activePane === "files";
  const isNet = state.activePane === "network";
  const isDag = state.activePane === "dag";

  out += ` ${isFiles ? ANSI.selectedCyan : ANSI.bold + ANSI.gold}[📁 FILES]${ANSI.reset}           ${isNet ? ANSI.selectedPurple : ANSI.bold + ANSI.gold}[🌐 MODEL NETWORK MAP]${ANSI.reset}              ${isDag ? ANSI.selected : ANSI.bold + ANSI.gold}[🧬 CAUSAL DAG]${ANSI.reset}\n`;

  const maxRows = Math.max(state.files.length, state.network.length, state.nodes.length);

  for (let i = 0; i < maxRows; i++) {
    // 1. Files Column
    let fileCell = "";
    if (i < state.files.length) {
      const f = state.files[i];
      const selected = isFiles && i === state.fileIndex;
      const str = `📄 ${f.name}`;
      fileCell = selected ? `${ANSI.selectedCyan} > ${str.padEnd(20)} ${ANSI.reset}` : `   ${ANSI.dim}${str.padEnd(20)}${ANSI.reset}`;
    } else {
      fileCell = "".padEnd(23);
    }

    // 2. Network Column
    let netCell = "";
    if (i < state.network.length) {
      const n = state.network[i];
      const selected = isNet && i === state.netIndex;
      const str = `${n.id} (${n.model}) [${n.ping}]`;
      netCell = selected ? `${ANSI.selectedPurple} > ${str.padEnd(38)} ${ANSI.reset}` : `   ${ANSI.purple}${str.padEnd(38)}${ANSI.reset}`;
    } else {
      netCell = "".padEnd(41);
    }

    // 3. DAG Column
    let dagCell = "";
    if (i < state.nodes.length) {
      const d = state.nodes[i];
      const selected = isDag && i === state.dagIndex;
      const prefix = " ".repeat(d.depth) + (d.depth > 0 ? "└─" : "├─");
      const str = `${prefix} ${d.id} ${d.label}`;
      dagCell = selected ? `${ANSI.selected} > ${str.padEnd(32)} ${ANSI.reset}` : `   ${ANSI.cyan}${str.padEnd(32)}${ANSI.reset}`;
    }

    out += `${fileCell} │ ${netCell} │ ${dagCell}\n`;
  }

  out += `${ANSI.orange}─────────────────────────────────────────────────────────────────────────────────────────────────────────${ANSI.reset}\n`;

  // Audit Log Feed
  out += `${ANSI.bold}${ANSI.cyan}LIVE AUDIT LOG EVENT FEED${ANSI.reset}\n`;
  state.logs.slice(-2).forEach(log => {
    out += ` [${timestamp}] ${ANSI.dim}${log}${ANSI.reset}\n`;
  });

  out += `\n${ANSI.bold}${ANSI.gold}STATUS:${ANSI.reset} ${state.statusMessage}\n`;

  process.stdout.write(out);
}

// Keyboard handling
if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  process.stdin.on('keypress', (str, key) => {
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      process.stdout.write("\x1b[2J\x1b[H");
      process.exit();
    } else if (key.name === 'tab') {
      if (state.activePane === "files") state.activePane = "network";
      else if (state.activePane === "network") state.activePane = "dag";
      else state.activePane = "files";
      state.statusMessage = `Focus: ${state.activePane.toUpperCase()} pane.`;
      render();
    } else if (key.name === 'up') {
      if (state.activePane === "files") state.fileIndex = Math.max(0, state.fileIndex - 1);
      if (state.activePane === "network") state.netIndex = Math.max(0, state.netIndex - 1);
      if (state.activePane === "dag") state.dagIndex = Math.max(0, state.dagIndex - 1);
      render();
    } else if (key.name === 'down') {
      if (state.activePane === "files") state.fileIndex = Math.min(state.files.length - 1, state.fileIndex + 1);
      if (state.activePane === "network") state.netIndex = Math.min(state.network.length - 1, state.netIndex + 1);
      if (state.activePane === "dag") state.dagIndex = Math.min(state.nodes.length - 1, state.dagIndex + 1);
      render();
    } else if (key.name === 'return') {
      if (state.activePane === "network") {
        const net = state.network[state.netIndex];
        state.statusMessage = `Inspected Node Route: ${net.id} -> ${net.model}`;
        state.logs.push(`Checked route telemetry for ${net.model} (${net.ping})`);
      } else if (state.activePane === "dag") {
        const d = state.nodes[state.dagIndex];
        state.statusMessage = `Inspected DAG Node: ${d.id}`;
        state.logs.push(`Queried state for ${d.id}`);
      }
      render();
    } else if (key.name === 'f') {
      if (state.activePane === "dag") {
        const d = state.nodes[state.dagIndex];
        state.statusMessage = `Forked counterfactual child DAG off ${d.id}!`;
        state.logs.push(`Spawned child DAG branch off decision node ${d.id}`);
        render();
      }
    }
  });
}

render();
setInterval(render, 500);

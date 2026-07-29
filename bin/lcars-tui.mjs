#!/usr/bin/env node

/**
 * Colloquy Interactive LCARS TUI Dashboard
 * Supports keyboard navigation (Up/Down/Enter/f/q) & dynamic socket/DB telemetry.
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
  bgPurple: "\x1b[48;2;204;153;255m\x1b[30m"
};

// State Data Structure
const state = {
  selectedIndex: 0,
  activeColloquy: "0x009-82F1-9A4B-2026",
  skill: "system-audit",
  cacheWarmStart: Date.now(),
  nodes: [
    { type: "session", id: "0x00A-SESS-SOMACO", label: "somaco / Human Operator", depth: 0 },
    { type: "turn", id: "0x005-TURN-001", label: 'Turn 1: "Refactor database index strategy"', depth: 1 },
    { type: "heartbeat", id: "0x825-NODE-E666", label: "[plan_branch] signal: 0xE666 (conf: 90%)", depth: 2 },
    { type: "session", id: "0x00A-SESS-VERTEX", label: "vertex / Sub-Agent Worker", depth: 0 },
    { type: "turn", id: "0x005-TURN-002", label: 'Turn 2: "Generating schema migration patch"', depth: 1 },
    { type: "heartbeat", id: "0x825-NODE-9000", label: "[assertion] signal: 0x9000 (depth: 1)", depth: 2 },
    { type: "fork", id: "0x009-FORK-CHILD", label: "[Counterfactual Branch] <-- Alternate Execution", depth: 0 }
  ],
  logs: [
    "Emitted plan_branch node to local state buffer",
    "5-minute ephemeral prompt cache active (6.35x token savings)",
    "Synced causal graph topology with Herdr multiplexer socket"
  ],
  statusMessage: "Use UP/DOWN arrows to select nodes | Press [F] to Fork | Press [Q] to Quit"
};

function render() {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");

  const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
  const elapsedSec = Math.floor((Date.now() - state.cacheWarmStart) / 1000);
  const ttlSeconds = Math.max(0, 300 - (elapsedSec % 300));
  const cachePercent = Math.floor((ttlSeconds / 300) * 100);
  const cacheBar = "█".repeat(Math.floor(cachePercent / 5)) + "░".repeat(20 - Math.floor(cachePercent / 5));

  let out = "";

  // Banner Header
  out += `${ANSI.orange}╔═════════════════════════════════════════════════════════════════════════════════╗${ANSI.reset}\n`;
  out += `${ANSI.orange}║ ${ANSI.selected}${ANSI.bold} LCARS INTERACTIVE █ COLLOQUY CAUSAL DAG DASHBOARD ${ANSI.reset}${ANSI.orange}           [${timestamp}] ║${ANSI.reset}\n`;
  out += `${ANSI.orange}╠═════════════════════════════════════════════════════════════════════════════════╣${ANSI.reset}\n`;

  // Telemetry Box
  out += `${ANSI.purple}[HERDR MULTIPLEXER]${ANSI.reset} Socket: Active | Workspace: w4 | Node: v24.11.1\n`;
  out += `${ANSI.gold}[PROMPT CACHE TTL] ${ANSI.reset} [${cacheBar}] ${cachePercent}% (${ttlSeconds}s remaining)\n`;
  out += `${ANSI.cyan}[ACTIVE DAG ROOT]  ${ANSI.reset} UUID: ${ANSI.bold}${state.activeColloquy}${ANSI.reset} | Skill: ${state.skill}\n`;

  out += `${ANSI.orange}─────────────────────────────────────────────────────────────────────────────────${ANSI.reset}\n`;

  // Interactive Tree View
  out += `${ANSI.bold}${ANSI.gold}INTERACTIVE CAUSAL DAG TREE${ANSI.reset}\n`;

  state.nodes.forEach((node, idx) => {
    const isSelected = idx === state.selectedIndex;
    const prefix = "  ".repeat(node.depth) + (node.depth > 0 ? "└── " : "├── ");
    
    let icon = "●";
    let color = ANSI.green;
    if (node.type === "turn") { icon = "◆"; color = ANSI.cyan; }
    if (node.type === "heartbeat") { icon = "⚡"; color = ANSI.purple; }
    if (node.type === "fork") { icon = "⑂"; color = ANSI.red; }

    const lineText = `${prefix}${icon} ${node.id} ${node.label}`;
    
    if (isSelected) {
      out += ` ${ANSI.selected} > ${lineText.padEnd(75)} ${ANSI.reset}\n`;
    } else {
      out += `   ${color}${lineText}${ANSI.reset}\n`;
    }
  });

  out += `${ANSI.orange}─────────────────────────────────────────────────────────────────────────────────${ANSI.reset}\n`;

  // Live Audit Log Feed
  out += `${ANSI.bold}${ANSI.cyan}LIVE AUDIT LOG EVENT FEED${ANSI.reset}\n`;
  state.logs.slice(-3).forEach(log => {
    out += ` [${timestamp}] ${ANSI.dim}${log}${ANSI.reset}\n`;
  });

  out += `\n${ANSI.bold}${ANSI.gold}STATUS:${ANSI.reset} ${state.statusMessage}\n`;

  process.stdout.write(out);
}

// Enable Interactive Keypress Listener
if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  process.stdin.on('keypress', (str, key) => {
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      process.stdout.write("\x1b[2J\x1b[H");
      process.exit();
    } else if (key.name === 'up') {
      state.selectedIndex = Math.max(0, state.selectedIndex - 1);
      render();
    } else if (key.name === 'down') {
      state.selectedIndex = Math.min(state.nodes.length - 1, state.selectedIndex + 1);
      render();
    } else if (key.name === 'return') {
      const activeNode = state.nodes[state.selectedIndex];
      state.statusMessage = `Selected: ${activeNode.id} (${activeNode.type})`;
      state.logs.push(`Inspected node ${activeNode.id}`);
      render();
    } else if (key.name === 'f') {
      const activeNode = state.nodes[state.selectedIndex];
      state.statusMessage = `Counterfactual Fork created off ${activeNode.id}!`;
      state.logs.push(`Forked child DAG from decision node ${activeNode.id}`);
      render();
    }
  });
}

// Initial Render and dynamic refresh loop
render();
setInterval(render, 1000);

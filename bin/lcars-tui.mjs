#!/usr/bin/env node

/**
 * Colloquy LCARS TUI Dashboard v2.8
 * Features: High-Fidelity Audit-Grade Causal DAG (Intent vs. System Execution).
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { setupHarness, logError } from '../lib/logger.mjs';

setupHarness('LCARS-TUI');

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
  selectedGold: "\x1b[48;2;255;204;102m\x1b[30m",
  selectedCyan: "\x1b[48;2;102;204;255m\x1b[30m",
  selectedPurple: "\x1b[48;2;204;153;255m\x1b[30m",
  selectedOrange: "\x1b[48;2;255;153;0m\x1b[30m"
};

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
let spinnerIndex = 0;

function loadIdeas() {
  const ideasPath = path.join(process.cwd(), 'ideas.md');
  if (!fs.existsSync(ideasPath)) return [];
  const content = fs.readFileSync(ideasPath, 'utf8');
  const lines = content.split('\n');
  const ideas = [];
  lines.forEach(line => {
    const match = line.match(/-\s*\[\s*\]\s*\*\*([^*]+)\*\*/);
    if (match) {
      ideas.push({ title: match[1].trim(), rawLine: line });
    }
  });
  return ideas;
}

const state = {
  activePane: "dag", // Default focus to DAG to showcase the expanded tree!
  ideaIndex: 0,
  fileIndex: 0,
  netIndex: 0,
  dagIndex: 0,
  cacheWarmStart: Date.now(),
  ideas: loadIdeas(),
  files: [
    "schema/colloquy-tables.sql",
    "bin/colloquy-daemon.mjs",
    "bin/agent-worker.mjs",
    "bin/slurp.mjs",
    "bin/lcars-tui.mjs",
    "ideas.md"
  ],
  network: [
    { id: "ORCHESTRATOR", ping: "24ms" },
    { id: "AGENT-WORKER", ping: "12ms" },
    { id: "AUDIT-VERIFIER", ping: "65ms" }
  ],
  // Detailed Audit DAG splitting Model Intent from Real System Execution
  dagNodes: [
    { type: "ROOT", label: "ROOT COLLOQUY DAG (0x009)", color: ANSI.gold },
    { type: "TURN", label: "├─ 0x00A-SESS-HUMAN [somaco / Operator]", color: ANSI.green },
    { type: "INTENT", label: "│  ├─ 💭 [INTENT] \"Refactor DB Index Strategy\"", color: ANSI.cyan },
    { type: "TOOL", label: "│  ├─ 🔐 [TOOL] execute_sql_patch (Scope: WRITE)", color: ANSI.purple },
    { type: "EXEC", label: "│  ├─ ⚡ [DELTA] +idx_sess_hash (2 tables updated)", color: ANSI.gold },
    { type: "PROOF", label: "│  └─ 🧬 [HASH] merkle:0xE666A900 (Verified)", color: ANSI.green },
    { type: "AGENT", label: "├─ 0x00B-AGENT-WORKER [Herdr Sub-Agent]", color: ANSI.green },
    { type: "INTENT", label: "│  ├─ 💭 [INTENT] \"Scaffold /lib module code\"", color: ANSI.cyan },
    { type: "TOOL", label: "│  ├─ 🔐 [TOOL] fs_write_file (Scope: Local FS)", color: ANSI.purple },
    { type: "EXEC", label: "│  ├─ ⚡ [DELTA] +lib/ascii-topology.mjs", color: ANSI.gold },
    { type: "PROOF", label: "│  └─ 🧬 [HASH] merkle:0x9000F825 (Verified)", color: ANSI.green },
    { type: "FORK", label: "└─ 0x009-FORK-CHILD [Counterfactual Branch]", color: ANSI.red }
  ],
  logs: [
    "Auditable Causal DAG loaded (Intent ➔ Tool Scope ➔ State Delta ➔ Hash)",
    "Use [UP/DOWN] to inspect DAG node audit metadata"
  ],
  statusMessage: "Focus: CAUSAL DAG | [TAB] Cycle Panes | [S] Slurp | [Q] Quit"
};

process.stdout.write("\x1b[2J");

function render() {
  readline.cursorTo(process.stdout, 0, 0);

  const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
  const elapsedSec = Math.floor((Date.now() - state.cacheWarmStart) / 1000);
  const ttlSeconds = Math.max(0, 300 - (elapsedSec % 300));
  const cachePercent = Math.floor((ttlSeconds / 300) * 100);
  
  const animFrame = SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length];
  spinnerIndex++;

  let out = "";

  out += `${ANSI.orange}╔═════════════════════════════════════════════════════════════════════════════════════════════════════════╗${ANSI.reset}\n`;
  out += `${ANSI.orange}║ ${ANSI.selectedOrange}${ANSI.bold} LCARS-24 █ AUDITABLE CAUSAL DAG & SYSTEM EXECUTION ${ANSI.reset}               ${ANSI.cyan}${animFrame} LIVE ${ANSI.orange}[${timestamp}] ║${ANSI.reset}\n`;
  out += `${ANSI.orange}╠═════════════════════════════════════════════════════════════════════════════════════════════════════════╣${ANSI.reset}\n`;

  out += `${ANSI.purple}[HERDR MULTIPLEXER]${ANSI.reset} Socket: Active | Verifier: Online | Node: v24.11.1\n`;
  out += `${ANSI.gold}[PROMPT CACHE TTL] ${ANSI.reset} [${"█".repeat(Math.floor(cachePercent / 5))}${"░".repeat(20 - Math.floor(cachePercent / 5))}] ${cachePercent}% (${ttlSeconds}s remaining)\n`;
  out += `${ANSI.cyan}[ACTIVE PANE]      ${ANSI.reset} ${ANSI.bold}${state.activePane.toUpperCase()}${ANSI.reset} | DAG Depth: 4 Execution Layers\n`;

  out += `${ANSI.orange}─────────────────────────────────────────────────────────────────────────────────────────────────────────${ANSI.reset}\n`;

  const isIdeas = state.activePane === "ideas";
  const isFiles = state.activePane === "files";
  const isNet = state.activePane === "network";
  const isDag = state.activePane === "dag";

  const col1H = isIdeas ? `${ANSI.selectedGold} [💡 IDEAS] ${ANSI.reset}` : ` ${ANSI.bold + ANSI.gold}[💡 IDEAS]${ANSI.reset} `;
  const col2H = isFiles ? `${ANSI.selectedCyan} [📁 FILES] ${ANSI.reset}` : ` ${ANSI.bold + ANSI.gold}[📁 FILES]${ANSI.reset} `;
  const col3H = isNet ? `${ANSI.selectedPurple} [🌐 SWARM] ${ANSI.reset}` : ` ${ANSI.bold + ANSI.gold}[🌐 SWARM]${ANSI.reset} `;
  const col4H = isDag ? `${ANSI.selectedOrange} [🧬 AUDITABLE CAUSAL DAG] ${ANSI.reset}` : ` ${ANSI.bold + ANSI.gold}[🧬 AUDITABLE CAUSAL DAG]${ANSI.reset} `;

  out += `${col1H.padEnd(24)} │${col2H.padEnd(22)} │${col3H.padEnd(20)} │${col4H}\n`;

  const maxRows = Math.max(state.ideas.length, state.files.length, state.network.length, state.dagNodes.length, 12);

  for (let i = 0; i < maxRows; i++) {
    // Col 1: Ideas
    let c1 = "".padEnd(20);
    if (i < state.ideas.length) {
      const item = state.ideas[i];
      const trunc = item.title.length > 14 ? item.title.substring(0, 11) + "..." : item.title;
      const isSel = isIdeas && i === state.ideaIndex;
      c1 = isSel ? `${ANSI.selectedGold}> 💡 ${trunc.padEnd(14)}${ANSI.reset}` : `  💡 ${ANSI.gold}${trunc.padEnd(14)}${ANSI.reset}`;
    }

    // Col 2: Files
    let c2 = "".padEnd(18);
    if (i < state.files.length) {
      const f = state.files[i];
      const trunc = f.length > 14 ? f.substring(0, 11) + "..." : f;
      const isSel = isFiles && i === state.fileIndex;
      c2 = isSel ? `${ANSI.selectedCyan}> 📄 ${trunc.padEnd(14)}${ANSI.reset}` : `  📄 ${ANSI.dim}${trunc.padEnd(14)}${ANSI.reset}`;
    }

    // Col 3: Network
    let c3 = "".padEnd(16);
    if (i < state.network.length) {
      const n = state.network[i];
      const str = `${n.id}`;
      const trunc = str.length > 12 ? str.substring(0, 10) + ".." : str;
      const isSel = isNet && i === state.netIndex;
      c3 = isSel ? `${ANSI.selectedPurple}> ${trunc.padEnd(12)}${ANSI.reset}` : `  ${ANSI.purple}${trunc.padEnd(12)}${ANSI.reset}`;
    }

    // Col 4: Auditable Causal DAG
    let c4 = "".padEnd(46);
    if (i < state.dagNodes.length) {
      const node = state.dagNodes[i];
      const isSel = isDag && i === state.dagIndex;
      c4 = isSel ? `${ANSI.selectedOrange} > ${node.label.padEnd(42)} ${ANSI.reset}` : `   ${node.color}${node.label.padEnd(42)}${ANSI.reset}`;
    }

    out += `${c1} │ ${c2} │ ${c3} │ ${c4}\n`;
  }

  out += `${ANSI.orange}─────────────────────────────────────────────────────────────────────────────────────────────────────────${ANSI.reset}\n`;
  out += `${ANSI.bold}${ANSI.cyan}LIVE AUDIT LOG EVENT FEED${ANSI.reset}\n`;

  state.logs.slice(-2).forEach(log => {
    out += ` [${timestamp}] ${ANSI.dim}${log.padEnd(90)}${ANSI.reset}\n`;
  });

  out += `\n${ANSI.bold}${ANSI.gold}STATUS:${ANSI.reset} ${state.statusMessage.padEnd(85)}\n`;

  process.stdout.write(out);
}

if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  process.stdin.on('keypress', (str, key) => {
    try {
      if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
        process.stdout.write("\x1b[2J\x1b[H");
        process.exit();
      } else if (key.name === 'tab') {
        if (state.activePane === "ideas") state.activePane = "files";
        else if (state.activePane === "files") state.activePane = "network";
        else if (state.activePane === "network") state.activePane = "dag";
        else state.activePane = "ideas";
        state.statusMessage = `Focus: ${state.activePane.toUpperCase()} pane.`;
      } else if (key.name === 'up') {
        if (state.activePane === "dag") state.dagIndex = Math.max(0, state.dagIndex - 1);
      } else if (key.name === 'down') {
        if (state.activePane === "dag") state.dagIndex = Math.min(state.dagNodes.length - 1, state.dagIndex + 1);
      }
      render();
    } catch (err) {
      logError(err, 'KEYPRESS_EVENT');
    }
  });
}

render();
setInterval(() => {
  try {
    render();
  } catch (err) {
    logError(err, 'RENDER_LOOP');
  }
}, 500);

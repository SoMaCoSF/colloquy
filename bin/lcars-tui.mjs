#!/usr/bin/env node

/**
 * Colloquy Interactive LCARS TUI Dashboard
 * Features: File Tree, Model Network Map, Causal DAG, and Interactive Ideas Inbox with 1-Click Slurp ([S]).
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';

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
  selectedPurple: "\x1b[48;2;204;153;255m\x1b[30m",
  selectedGold: "\x1b[48;2;255;204;102m\x1b[30m"
};

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
let spinnerIndex = 0;

// Helper: Parse unchecked ideas from ideas.md
function loadIdeas() {
  const ideasPath = path.join(process.cwd(), 'ideas.md');
  if (!fs.existsSync(ideasPath)) {
    return [{ title: "No ideas.md found", status: "EMPTY" }];
  }
  const content = fs.readFileSync(ideasPath, 'utf8');
  const matches = content.match(/-\s*\[\s*\]\s*\*\*([^*]+)\*\*/g) || [];
  return matches.map(m => {
    const clean = m.replace(/-\s*\[\s*\]\s*\*\*/, '').replace(/\*\*/, '').trim();
    return { title: clean, status: "READY" };
  });
}

// Helper: Slurp idea directly into /docs
function slurpToFile(title) {
  const docsDir = path.join(process.cwd(), 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  const filePath = path.join(docsDir, `${slug}.md`);

  const docContent = `# Doc Entry: ${title}

- **Status:** Slurped from TUI
- **Created At:** ${new Date().toISOString()}
- **Source Session:** 0x009-COLLOQUY-ROOT

---

## 💡 Overview
${title}

## 🎯 Objectives
- Auto-slurped via LCARS TUI Dashboard shortcut ([S]).
- Registered into causal workspace documentation queue.
`;

  fs.writeFileSync(filePath, docContent, 'utf8');
  return `docs/${slug}.md`;
}

const state = {
  activePane: "ideas", // "ideas" | "files" | "network" | "dag"
  ideaIndex: 0,
  fileIndex: 0,
  netIndex: 0,
  dagIndex: 0,
  activeColloquy: "0x009-82F1-9A4B-2026",
  cacheWarmStart: Date.now(),

  ideas: loadIdeas(),

  files: [
    { name: "schema/colloquy-tables.sql" },
    { name: "bin/colloquy-daemon.mjs" },
    { name: "bin/slurp.mjs" },
    { name: "bin/lcars-tui.mjs" },
    { name: "ideas.md" }
  ],

  network: [
    { id: "ORCHESTRATOR", model: "claude-3-7-sonnet", ping: "24ms" },
    { id: "SUB-AGENT-01", model: "claude-3-5-haiku", ping: "18ms" },
    { id: "AUDIT-VERIFIER", model: "deepseek-r1", ping: "65ms" }
  ],

  nodes: [
    { type: "session", id: "0x00A-SESS-SOMACO", label: "somaco / Human", depth: 0 },
    { type: "turn", id: "0x005-TURN-001", label: '"Refactor index strategy"', depth: 1 },
    { type: "heartbeat", id: "0x825-NODE-E666", label: "[plan_branch] signal:0xE666", depth: 2 },
    { type: "fork", id: "0x009-FORK-CHILD", label: "[Counterfactual Branch]", depth: 0 }
  ],

  logs: [
    "LCARS TUI Dashboard ready",
    "Loaded ideas backlog from ideas.md",
    "Slurp trigger active: Press [S] on selected idea"
  ],
  statusMessage: "[TAB] Cycle Pane | [S] Slurp Idea -> /docs | [F] Fork DAG | [Q] Quit"
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
  out += `${ANSI.orange}║ ${ANSI.selected}${ANSI.bold} LCARS-24 █ COLLOQUY IDEAS BROWSER & SWARM CONTROL ${ANSI.reset}               ${ANSI.cyan}${animFrame} LIVE ${ANSI.orange}[${timestamp}] ║${ANSI.reset}\n`;
  out += `${ANSI.orange}╠═════════════════════════════════════════════════════════════════════════════════════════════════════════╣${ANSI.reset}\n`;

  // Telemetry Box
  out += `${ANSI.purple}[HERDR MULTIPLEXER]${ANSI.reset} Socket: Active | Workspace: w4 | Node: v24.11.1\n`;
  out += `${ANSI.gold}[PROMPT CACHE TTL] ${ANSI.reset} [${"█".repeat(Math.floor(cachePercent / 5))}${"░".repeat(20 - Math.floor(cachePercent / 5))}] ${cachePercent}% (${ttlSeconds}s remaining)\n`;
  out += `${ANSI.cyan}[ACTIVE PANE]      ${ANSI.reset} ${ANSI.bold}${state.activePane.toUpperCase()}${ANSI.reset} | Active Ideas: ${state.ideas.length}\n`;

  out += `${ANSI.orange}─────────────────────────────────────────────────────────────────────────────────────────────────────────${ANSI.reset}\n`;

  // Pane Column Headers
  const isIdeas = state.activePane === "ideas";
  const isFiles = state.activePane === "files";
  const isNet = state.activePane === "network";
  const isDag = state.activePane === "dag";

  out += ` ${isIdeas ? ANSI.selectedGold : ANSI.bold + ANSI.gold}[💡 IDEAS INBOX]`}${ANSI.reset}   ${isFiles ? ANSI.selectedCyan : ANSI.bold + ANSI.gold}[📁 FILES]${ANSI.reset}   ${isNet ? ANSI.selectedPurple : ANSI.bold + ANSI.gold}[🌐 NETWORK]${ANSI.reset}   ${isDag ? ANSI.selected : ANSI.bold + ANSI.gold}[🧬 CAUSAL DAG]${ANSI.reset}\n`;

  const maxRows = Math.max(state.ideas.length, state.files.length, state.network.length, state.nodes.length);

  for (let i = 0; i < maxRows; i++) {
    // 1. Ideas Column
    let ideaCell = "";
    if (i < state.ideas.length) {
      const item = state.ideas[i];
      const selected = isIdeas && i === state.ideaIndex;
      const str = `💡 ${item.title}`;
      ideaCell = selected ? `${ANSI.selectedGold} > ${str.padEnd(26)} ${ANSI.reset}` : `   ${ANSI.gold}${str.padEnd(26)}${ANSI.reset}`;
    } else {
      ideaCell = "".padEnd(29);
    }

    // 2. Files Column
    let fileCell = "";
    if (i < state.files.length) {
      const f = state.files[i];
      const selected = isFiles && i === state.fileIndex;
      const str = `📄 ${f.name}`;
      fileCell = selected ? `${ANSI.selectedCyan} > ${str.padEnd(18)} ${ANSI.reset}` : `   ${ANSI.dim}${str.padEnd(18)}${ANSI.reset}`;
    } else {
      fileCell = "".padEnd(21);
    }

    // 3. Network Column
    let netCell = "";
    if (i < state.network.length) {
      const n = state.network[i];
      const selected = isNet && i === state.netIndex;
      const str = `${n.id} (${n.ping})`;
      netCell = selected ? `${ANSI.selectedPurple} > ${str.padEnd(20)} ${ANSI.reset}` : `   ${ANSI.purple}${str.padEnd(20)}${ANSI.reset}`;
    } else {
      netCell = "".padEnd(23);
    }

    // 4. DAG Column
    let dagCell = "";
    if (i < state.nodes.length) {
      const d = state.nodes[i];
      const selected = isDag && i === state.dagIndex;
      const prefix = " ".repeat(d.depth) + (d.depth > 0 ? "└─" : "├─");
      const str = `${prefix} ${d.id}`;
      dagCell = selected ? `${ANSI.selected} > ${str.padEnd(20)} ${ANSI.reset}` : `   ${ANSI.cyan}${str.padEnd(20)}${ANSI.reset}`;
    }

    out += `${ideaCell} │ ${fileCell} │ ${netCell} │ ${dagCell}\n`;
  }

  out += `${ANSI.orange}─────────────────────────────────────────────────────────────────────────────────────────────────────────${ANSI.reset}\n`;

  // Audit Log
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
      if (state.activePane === "ideas") state.activePane = "files";
      else if (state.activePane === "files") state.activePane = "network";
      else if (state.activePane === "network") state.activePane = "dag";
      else state.activePane = "ideas";
      state.statusMessage = `Focus: ${state.activePane.toUpperCase()} pane.`;
      render();
    } else if (key.name === 'up') {
      if (state.activePane === "ideas") state.ideaIndex = Math.max(0, state.ideaIndex - 1);
      if (state.activePane === "files") state.fileIndex = Math.max(0, state.fileIndex - 1);
      if (state.activePane === "network") state.netIndex = Math.max(0, state.netIndex - 1);
      if (state.activePane === "dag") state.dagIndex = Math.max(0, state.dagIndex - 1);
      render();
    } else if (key.name === 'down') {
      if (state.activePane === "ideas") state.ideaIndex = Math.min(state.ideas.length - 1, state.ideaIndex + 1);
      if (state.activePane === "files") state.fileIndex = Math.min(state.files.length - 1, state.fileIndex + 1);
      if (state.activePane === "network") state.netIndex = Math.min(state.network.length - 1, state.netIndex + 1);
      if (state.activePane === "dag") state.dagIndex = Math.min(state.nodes.length - 1, state.dagIndex + 1);
      render();
    } else if (key.name === 's' || key.name === 'S') {
      if (state.activePane === "ideas" && state.ideas.length > 0) {
        const selectedIdea = state.ideas[state.ideaIndex];
        const generatedPath = slurpToFile(selectedIdea.title);
        selectedIdea.status = "SLURPED";
        state.statusMessage = `✔ Slurped "${selectedIdea.title}" -> ${generatedPath}`;
        state.logs.push(`Slurped idea into ${generatedPath}`);
        render();
      }
    } else if (key.name === 'return') {
      if (state.activePane === "ideas") {
        const item = state.ideas[state.ideaIndex];
        state.statusMessage = `Selected Idea: "${item.title}" | Press [S] to Slurp`;
      }
      render();
    }
  });
}

render();
setInterval(render, 500);

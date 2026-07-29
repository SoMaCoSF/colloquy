#!/usr/bin/env node

/**
 * Colloquy LCARS TUI Dashboard v2.6
 * Fixes: Double-buffer flicker-free rendering, clean column widths, and interactive Slurping.
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
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

function executeSlurp(idea) {
  const docsDir = path.join(process.cwd(), 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

  const slug = idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  const filePath = path.join(docsDir, `${slug}.md`);

  const docContent = `# Architecture Doc: ${idea.title}

- **Status:** Auto-Slurped from LCARS TUI Inbox
- **Date:** ${new Date().toISOString()}
- **Session:** 0x009-COLLOQUY-ROOT

---

## 💡 Overview
${idea.title}

## 🎯 Implementation Strategy
1. Register state schema.
2. Wire event bus to Herdr socket multiplexer.
`;

  fs.writeFileSync(filePath, docContent, 'utf8');

  // Mark item as checked in ideas.md
  const ideasPath = path.join(process.cwd(), 'ideas.md');
  if (fs.existsSync(ideasPath)) {
    let content = fs.readFileSync(ideasPath, 'utf8');
    const target = `- [ ] **${idea.title}**`;
    const replacement = `- [x] **${idea.title}** (Slurped -> docs/${slug}.md)`;
    content = content.replace(target, replacement);
    fs.writeFileSync(ideasPath, content, 'utf8');
  }

  return `docs/${slug}.md`;
}

const state = {
  activePane: "ideas",
  ideaIndex: 0,
  fileIndex: 0,
  netIndex: 0,
  dagIndex: 0,
  cacheWarmStart: Date.now(),
  ideas: loadIdeas(),
  files: [
    "schema/colloquy-tables.sql",
    "bin/colloquy-daemon.mjs",
    "bin/slurp.mjs",
    "bin/lcars-tui.mjs",
    "ideas.md"
  ],
  network: [
    { id: "ORCHESTRATOR", ping: "24ms" },
    { id: "SUB-AGENT-01", ping: "18ms" },
    { id: "AUDIT-VERIFIER", ping: "65ms" }
  ],
  nodes: [
    { id: "0x00A-SESS-SOMACO", depth: 0 },
    { id: "0x005-TURN-001", depth: 1 },
    { id: "0x825-NODE-E666", depth: 2 },
    { id: "0x009-FORK-CHILD", depth: 0 }
  ],
  logs: [
    "LCARS TUI render loop active (double-buffered)",
    "Press [S] on selected idea to slurp into /docs"
  ],
  statusMessage: "Focus: IDEAS pane | Press [TAB] to switch panes | [S] Slurp | [Q] Exit"
};

// Clear screen ONCE at startup
process.stdout.write("\x1b[2J");

function render() {
  // Return cursor to top-left (0,0) without clearing screen (prevents flicker)
  readline.cursorTo(process.stdout, 0, 0);

  const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
  const elapsedSec = Math.floor((Date.now() - state.cacheWarmStart) / 1000);
  const ttlSeconds = Math.max(0, 300 - (elapsedSec % 300));
  const cachePercent = Math.floor((ttlSeconds / 300) * 100);
  
  const animFrame = SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length];
  spinnerIndex++;

  let out = "";

  out += `${ANSI.orange}╔═════════════════════════════════════════════════════════════════════════════════════════════════════════╗${ANSI.reset}\n`;
  out += `${ANSI.orange}║ ${ANSI.selectedOrange}${ANSI.bold} LCARS-24 █ COLLOQUY IDEAS BROWSER & SWARM CONTROL ${ANSI.reset}               ${ANSI.cyan}${animFrame} LIVE ${ANSI.orange}[${timestamp}] ║${ANSI.reset}\n`;
  out += `${ANSI.orange}╠═════════════════════════════════════════════════════════════════════════════════════════════════════════╣${ANSI.reset}\n`;

  out += `${ANSI.purple}[HERDR MULTIPLEXER]${ANSI.reset} Socket: Active | Workspace: w4 | Node: v24.11.1\n`;
  out += `${ANSI.gold}[PROMPT CACHE TTL] ${ANSI.reset} [${"█".repeat(Math.floor(cachePercent / 5))}${"░".repeat(20 - Math.floor(cachePercent / 5))}] ${cachePercent}% (${ttlSeconds}s remaining)\n`;
  out += `${ANSI.cyan}[ACTIVE PANE]      ${ANSI.reset} ${ANSI.bold}${state.activePane.toUpperCase()}${ANSI.reset} | Backlog Items: ${state.ideas.length}\n`;

  out += `${ANSI.orange}─────────────────────────────────────────────────────────────────────────────────────────────────────────${ANSI.reset}\n`;

  const isIdeas = state.activePane === "ideas";
  const isFiles = state.activePane === "files";
  const isNet = state.activePane === "network";
  const isDag = state.activePane === "dag";

  const col1H = isIdeas ? `${ANSI.selectedGold} [💡 IDEAS INBOX] ${ANSI.reset}` : ` ${ANSI.bold + ANSI.gold}[💡 IDEAS INBOX]${ANSI.reset} `;
  const col2H = isFiles ? `${ANSI.selectedCyan} [📁 FILES] ${ANSI.reset}` : ` ${ANSI.bold + ANSI.gold}[📁 FILES]${ANSI.reset} `;
  const col3H = isNet ? `${ANSI.selectedPurple} [🌐 NETWORK] ${ANSI.reset}` : ` ${ANSI.bold + ANSI.gold}[🌐 NETWORK]${ANSI.reset} `;
  const col4H = isDag ? `${ANSI.selectedOrange} [🧬 CAUSAL DAG] ${ANSI.reset}` : ` ${ANSI.bold + ANSI.gold}[🧬 CAUSAL DAG]${ANSI.reset} `;

  out += `${col1H.padEnd(38)} │${col2H.padEnd(28)} │${col3H.padEnd(22)} │${col4H}\n`;

  const maxRows = Math.max(state.ideas.length, state.files.length, state.network.length, state.nodes.length, 9);

  for (let i = 0; i < maxRows; i++) {
    // Column 1: Ideas
    let c1 = "".padEnd(32);
    if (i < state.ideas.length) {
      const item = state.ideas[i];
      const trunc = item.title.length > 26 ? item.title.substring(0, 23) + "..." : item.title;
      const isSel = isIdeas && i === state.ideaIndex;
      c1 = isSel ? `${ANSI.selectedGold}> 💡 ${trunc.padEnd(26)}${ANSI.reset}` : `  💡 ${ANSI.gold}${trunc.padEnd(26)}${ANSI.reset}`;
    }

    // Column 2: Files
    let c2 = "".padEnd(24);
    if (i < state.files.length) {
      const f = state.files[i];
      const trunc = f.length > 20 ? f.substring(0, 17) + "..." : f;
      const isSel = isFiles && i === state.fileIndex;
      c2 = isSel ? `${ANSI.selectedCyan}> 📄 ${trunc.padEnd(20)}${ANSI.reset}` : `  📄 ${ANSI.dim}${trunc.padEnd(20)}${ANSI.reset}`;
    }

    // Column 3: Network
    let c3 = "".padEnd(18);
    if (i < state.network.length) {
      const n = state.network[i];
      const str = `${n.id} (${n.ping})`;
      const trunc = str.length > 16 ? str.substring(0, 14) + ".." : str;
      const isSel = isNet && i === state.netIndex;
      c3 = isSel ? `${ANSI.selectedPurple}> ${trunc.padEnd(16)}${ANSI.reset}` : `  ${ANSI.purple}${trunc.padEnd(16)}${ANSI.reset}`;
    }

    // Column 4: DAG Nodes
    let c4 = "".padEnd(20);
    if (i < state.nodes.length) {
      const d = state.nodes[i];
      const prefix = " ".repeat(d.depth) + (d.depth > 0 ? "└─" : "├─");
      const str = `${prefix}${d.id}`;
      const isSel = isDag && i === state.dagIndex;
      c4 = isSel ? `${ANSI.selectedOrange}> ${str.padEnd(18)}${ANSI.reset}` : `  ${ANSI.cyan}${str.padEnd(18)}${ANSI.reset}`;
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
        if (state.activePane === "ideas") state.ideaIndex = Math.max(0, state.ideaIndex - 1);
        if (state.activePane === "files") state.fileIndex = Math.max(0, state.fileIndex - 1);
        if (state.activePane === "network") state.netIndex = Math.max(0, state.netIndex - 1);
        if (state.activePane === "dag") state.dagIndex = Math.max(0, state.dagIndex - 1);
      } else if (key.name === 'down') {
        if (state.activePane === "ideas") state.ideaIndex = Math.min(state.ideas.length - 1, state.ideaIndex + 1);
        if (state.activePane === "files") state.fileIndex = Math.min(state.files.length - 1, state.files.length - 1);
        if (state.activePane === "network") state.netIndex = Math.min(state.network.length - 1, state.network.length - 1);
        if (state.activePane === "dag") state.dagIndex = Math.min(state.nodes.length - 1, state.dagIndex + 1);
      } else if (key.name === 's' || key.name === 'S') {
        if (state.activePane === "ideas" && state.ideas.length > 0) {
          const selectedIdea = state.ideas[state.ideaIndex];
          const docPath = executeSlurp(selectedIdea);
          
          state.logs.push(`Slurped "${selectedIdea.title}" -> ${docPath}`);
          state.statusMessage = `✔ Slurped "${selectedIdea.title}" -> ${docPath}`;
          
          // Reload ideas queue
          state.ideas = loadIdeas();
          state.ideaIndex = Math.max(0, Math.min(state.ideaIndex, state.ideas.length - 1));
        }
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

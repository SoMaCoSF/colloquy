#!/usr/bin/env node

/**
 * Colloquy Slurp CLI
 * Slurps new ideas from ideas.md or arguments and generates auto-structured /docs entries.
 */

import fs from 'fs';
import path from 'path';

const docsDir = path.join(process.cwd(), 'docs');

// Ensure /docs directory exists
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function slurpIdea(title, category = 'feature-proposal') {
  const timestamp = new Date().toISOString();
  const slug = slugify(title);
  const filename = `${slug}.md`;
  const filePath = path.join(docsDir, filename);

  const docContent = `# Doc Entry: ${title}

- **Status:** Auto-Slurped / Draft
- **Category:** ${category}
- **Created At:** ${timestamp}
- **Source Session:** 0x009-COLLOQUY-ROOT

---

## 💡 Overview
${title}

## 🎯 Objectives & Intent
- Auto-generated from Colloquy slurp queue.
- Integrates with causal DAG decision tracking and Herdr multiplexer sessions.

## 🛠️ Implementation Plan
1. Parse technical parameters and requirements.
2. Register node schema within \`lib/derive.mjs\`.
3. Add interactive trigger inside \`bin/lcars-tui.mjs\`.
4. Emit heartbeat node (\`0x825\`) upon state change.

---
*Generated automatically by \`colloquy slurp\`*
`;

  fs.writeFileSync(filePath, docContent, 'utf8');
  console.log(`\x1b[32m✔ Slurped idea into documentation:\x1b[0m docs/${filename}`);
}

// CLI Argument Handling
const args = process.argv.slice(2);
const titleArg = args.join(' ');

if (!titleArg) {
  console.log('\x1b[38;2;255;153;0mUsage:\x1b[0m node bin/slurp.mjs "Your new feature idea here"');
  process.exit(1);
}

slurpIdea(titleArg);

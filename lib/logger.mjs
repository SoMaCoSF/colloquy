import fs from 'fs';
import path from 'path';

export function logError(err, source = 'UNKNOWN') {
  const logDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${source}] ${err.stack || err.message || err}\n----------------------------------------\n`;
  
  fs.appendFileSync(path.join(logDir, 'error.log'), entry, 'utf8');
}

export function setupHarness(source) {
  process.on('uncaughtException', (err) => {
    logError(err, source);
    console.error(`\x1b[31m[CRASH] Error captured and saved to logs/error.log:\x1b[0m ${err.message}`);
    process.exit(1);
  });
}

#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRepl } from '../src/repl.js';
import { authCommand, launchChatGPT } from '../src/chatgpt-cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'));
const argv = process.argv.slice(2);

if (argv.includes('--version') || argv.includes('-v')) {
  console.log(`SciAgent v${version}`);
  process.exit(0);
}
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`SciAgent v${version} — bilimsel kodlama ajanı

Kullanım:
  sci-agent                                  # etkileşimli terminal
  sci-agent --chatgpt                        # Continue with ChatGPT (local interactive)
  sci-agent auth login | status | switch | models | logout | usage
  sci-agent --prompt "görev"                 # tek seferlik görev
  sci-agent --workspace <dizin>              # çalışma alanını belirle
  sci-agent --version | --help

REPL içindeki komutlar için /help yaz.`);
  process.exit(0);
}

try {
  if (argv[0] === 'auth') await authCommand(argv.slice(1));
  else if (argv.includes('--chatgpt')) await launchChatGPT(argv, startRepl);
  else await startRepl(argv);
} catch (error) {
  console.error('Error: ' + String(error?.message ?? 'Unknown error').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,400));
  process.exitCode=1;
}

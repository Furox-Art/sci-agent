#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRepl } from '../src/repl.js';

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
  sci-agent --prompt "görev"                 # tek seferlik görev
  sci-agent --workspace <dizin>              # çalışma alanını belirle
  sci-agent --version | --help

REPL içindeki komutlar için /help yaz.`);
  process.exit(0);
}

startRepl(argv);

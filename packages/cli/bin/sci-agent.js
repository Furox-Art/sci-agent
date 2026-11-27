#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchLocal, localCommand } from '../src/local-cli.js';
import { startRepl } from '../src/repl.js';
import { authCommand, launchChatGPT } from '../src/chatgpt-cli.js';
import { launchClaude, launchGemini, nativeAuthCommand } from '../src/native-agent-cli.js';
import { launchOpenRouter, launchCopilot, providerMenu, openRouterCommand, copilotCommand } from '../src/provider-cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'));
const argv = process.argv.slice(2);

if (argv.includes('--version') || argv.includes('-v')) {
  console.log(`Sci-Agent v${version}`);
  process.exit(0);
}
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`Sci-Agent v${version} — scientific coding agent

Usage:
  sci-agent                                  # interactive terminal
  sci-agent --provider-menu                 # select account provider
  sci-agent --claude                        # native Claude Code terminal session
  sci-agent --gemini                        # official Antigravity ACP terminal session
  sci-agent auth claude | gemini <command>
  sci-agent --copilot                       # official Copilot account
  sci-agent --openrouter                    # OpenRouter OAuth / own credits
  sci-agent auth copilot | openrouter <command>
  sci-agent --chatgpt                        # Continue with ChatGPT (local interactive)
  sci-agent auth login | status | switch | models | logout | usage
  sci-agent --prompt "task"                 # one-shot task
  sci-agent --local ollama|lmstudio|llamacpp|vllm|custom
  sci-agent --local ollama --local-start --local-model <model>
  sci-agent local models|status --local <runtime>
  sci-agent --sandbox                        # opt-in local process sandbox (Linux/WSL2)
  sci-agent --workspace <directory>              # set the workspace
  sci-agent --version | --help

Type /help for commands inside the REPL.`);
  process.exit(0);
}

try {
  const options=['--chatgpt','--openrouter','--copilot','--provider-menu','--claude','--gemini','--local'].filter(x=>argv.includes(x));
  if(options.length>1)throw new Error('Select only one provider');
  if (argv[0] === 'local') await localCommand(argv.slice(1));
  else if (argv[0] === 'auth' && ['claude','gemini'].includes(argv[1])) await nativeAuthCommand(argv[1],argv.slice(2));
  else if (argv[0] === 'auth' && argv[1]==='openrouter') await openRouterCommand(argv.slice(2));
  else if (argv[0] === 'auth' && argv[1]==='copilot') await copilotCommand(argv.slice(2));
  else if (argv[0] === 'auth') await authCommand(argv.slice(1));
  else if (argv.includes('--local')) await launchLocal(argv,startRepl);
  else if (argv.includes('--claude')) await launchClaude(argv.filter(a=>a!=='--claude'));
  else if (argv.includes('--gemini')) await launchGemini(argv.filter(a=>a!=='--gemini'));
  else if (argv.includes('--openrouter')) await launchOpenRouter(argv.filter(a=>a!=='--openrouter'),startRepl);
  else if (argv.includes('--copilot')) await launchCopilot(argv.filter(a=>a!=='--copilot'),startRepl);
  else if (argv.includes('--provider-menu')) await providerMenu(argv.filter(a=>a!=='--provider-menu'),startRepl);
  else if (argv.includes('--chatgpt')) await launchChatGPT(argv, startRepl);
  else await startRepl(argv);
} catch (error) {
  console.error('Error: ' + String(error?.message ?? 'Unknown error').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,400));
  process.exitCode=1;
}

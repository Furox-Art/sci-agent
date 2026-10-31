#!/usr/bin/env node
import { startRepl } from '../src/repl.js';

startRepl(process.argv.slice(2));

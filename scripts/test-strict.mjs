import { spawnSync } from 'node:child_process';

// Preserve all test output and reject missing/partial/skipped test summaries.
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/**/*.test.js'], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, SCI_AGENT_REQUIRE_SANDBOX_TESTS: '1' },
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
const counts = {};
for (const match of (result.stdout ?? '').matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\r?$/gm)) {
  counts[match[1]] = Number(match[2]);
}
if (result.status !== 0 || !(counts.tests > 0) || counts.pass !== counts.tests ||
    counts.fail !== 0 || counts.cancelled !== 0 || counts.skipped !== 0 || counts.todo !== 0) {
  console.error('Strict test gate failed: every discovered test must pass; no skips, cancellations or TODOs.');
  process.exit(1);
}
console.log('Strict test gate passed: all tests executed and passed.');

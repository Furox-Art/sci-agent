#!/usr/bin/env node
/**
 * Build the publishable npm tarball and (optionally) the PyPI wheel/sdist.
 *
 * Usage:
 *   node scripts/build-packages.mjs            # npm tarball + PyPI bundle only
 *   node scripts/build-packages.mjs --build    # also run `python -m build`
 *
 * The PyPI wheel bundles the exact npm tarball, so the two registries always
 * ship the same runtime source and version.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const distNpm = path.join(root, 'dist-npm');
const stage = path.join(distNpm, 'package');
const bundleDir = path.join(root, 'python', 'src', 'sci_agent', '_bundle');

const skip = /[\\/](node_modules|\.git|test|dist)([\\/]|$)/;
function copyTree(from, to) {
  cpSync(path.join(root, from), path.join(stage, to), {
    recursive: true,
    filter: (source) => !skip.test(source),
  });
}

rmSync(distNpm, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

copyTree('packages/cli', 'packages/cli');
copyTree('packages/core', 'packages/core');
for (const file of [
  'CHANGELOG.md',
  'LICENSE-MIT',
  'LICENSE-APACHE',
  'sci-agent.config.example.json',
]) {
  copyFileSync(path.join(root, file), path.join(stage, file));
}
copyFileSync(path.join(root, 'README.md'), path.join(stage, 'README.md'));

const manifest = {
  name: 'sci-agent',
  version: pkg.version,
  description: pkg.description,
  type: 'module',
  license: pkg.license,
  author: pkg.author,
  homepage: pkg.homepage,
  repository: pkg.repository,
  bugs: pkg.bugs,
  keywords: pkg.keywords,
  engines: pkg.engines,
  bin: { 'sci-agent': 'packages/cli/bin/sci-agent.js' },
  dependencies: pkg.dependencies,
  optionalDependencies: pkg.optionalDependencies,
  bundleDependencies: pkg.bundleDependencies,
  files: [
    'packages/cli',
    'packages/core',
    'sci-agent.config.example.json',
    'CHANGELOG.md',
    'LICENSE-MIT',
    'LICENSE-APACHE',
    'README.md',
  ],
  publishConfig: { access: 'public' },
};
writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Install the bundled runtime dependencies so both registries ship a package
// that runs with `node` alone, without a follow-up `npm install`.
const npmBin = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
execFileSync(
  process.execPath,
  [npmBin, 'install', '--omit=dev', '--omit=optional', '--no-package-lock', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: stage, stdio: 'inherit' },
);

const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
if (existsSync(npmCli)) {
  execFileSync(process.execPath, [npmCli, 'pack', '--pack-destination', distNpm], {
    cwd: stage,
    stdio: 'inherit',
  });
} else {
  execFileSync('npm', ['pack', '--pack-destination', distNpm], {
    cwd: stage,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

const tarball = readdirSync(distNpm).find((file) => file.endsWith('.tgz'));
if (!tarball) throw new Error('npm pack did not produce a tarball');

mkdirSync(bundleDir, { recursive: true });
for (const file of readdirSync(bundleDir)) {
  if (file.endsWith('.tgz')) rmSync(path.join(bundleDir, file));
}
copyFileSync(path.join(distNpm, tarball), path.join(bundleDir, `sci-agent-${pkg.version}.tgz`));
copyFileSync(path.join(root, 'LICENSE-MIT'), path.join(root, 'python', 'LICENSE-MIT'));
copyFileSync(path.join(root, 'LICENSE-APACHE'), path.join(root, 'python', 'LICENSE-APACHE'));

console.log(`npm tarball: ${path.join(distNpm, tarball)}`);
console.log(`PyPI bundle: ${path.join(bundleDir, `sci-agent-${pkg.version}.tgz`)}`);

if (process.argv.includes('--build')) {
  const python = process.env.SCI_AGENT_BUILD_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  execFileSync(python, ['-m', 'build'], {
    cwd: path.join(root, 'python'),
    stdio: 'inherit',
  });
  console.log(`PyPI dist: ${path.join(root, 'python', 'dist')}`);
}

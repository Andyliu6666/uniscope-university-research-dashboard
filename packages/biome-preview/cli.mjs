#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import checksums from './checksums.json' with { type: 'json' };

const revision = '100d4d7fa9f95f701c47e6734b00553e4de0b9c6';
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const musl = process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime;
const target = [process.platform, process.arch, ...(musl ? ['musl'] : [])].join('-');
const filename = process.platform === 'win32' ? 'biome.exe' : 'biome';
const cache = join(repo, '.tools', 'biome', revision, target);
const binary = join(cache, filename);
const args = process.argv.slice(2);

function compiledPreview() {
  const tag = `uniscope-biome:${revision}`;
  const image = spawnSync('docker', ['image', 'inspect', tag], { stdio: 'ignore' });
  if (image.status !== 0) {
    console.error('Building the pinned Biome preview from its upstream source using Docker.');
    const built = spawnSync(
      'docker',
      ['build', '--build-arg', `REVISION=${revision}`, '-t', tag, here],
      { stdio: 'inherit' },
    );
    if (built.status !== 0)
      throw new Error('Building the Biome preview requires a running Docker engine.');
  }
  const cwd = process.cwd();
  const user = process.getuid ? ['--user', `${process.getuid()}:${process.getgid()}`] : [];
  const result = spawnSync(
    'docker',
    ['run', '--rm', '-i', ...user, '-v', `${repo}:${repo}`, '-w', cwd, tag, ...args],
    { stdio: 'inherit' },
  );
  return result.status ?? 1;
}

function run() {
  if (!existsSync(binary)) {
    if (!checksums[target]) return compiledPreview();
    mkdirSync(cache, { recursive: true });
    const tmp = mkdtempSync(join(cache, 'install-'));
    try {
      const archive = join(tmp, 'biome.tgz');
      const url = `https://pkg.pr.new/biomejs/biome/@biomejs/cli-${target}@${revision}`;
      const downloaded = spawnSync(
        'curl',
        [
          '-fsSL',
          '--retry',
          '2',
          '--connect-timeout',
          '10',
          '--max-time',
          '120',
          '-o',
          archive,
          url,
        ],
        { stdio: 'inherit' },
      );
      if (downloaded.status !== 0) return compiledPreview();
      const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
      if (digest !== checksums[target]) throw new Error('Biome preview checksum mismatch.');
      const unpack = spawnSync('tar', ['-xzf', archive, '-C', tmp, `package/${filename}`], {
        stdio: 'inherit',
      });
      if (unpack.status !== 0) throw new Error('Could not unpack the verified Biome preview.');
      renameSync(join(tmp, 'package', filename), binary);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  const result = spawnSync(binary, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
// Upstream's scheduled native build leaves its embedded version string empty.
if (args.length === 1 && ['--version', '-V'].includes(args[0])) {
  console.log(`Biome preview ${revision}`);
} else {
  process.exitCode = run();
}

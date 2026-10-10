import { describe, expect, test, beforeAll } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PKG = '.';
let dist: string;

beforeAll(() => {
  const built = Bun.spawnSync(['bun', 'run', 'build'], { cwd: PKG, stdout: 'pipe', stderr: 'pipe' });
  if (built.exitCode !== 0) throw new Error(`build failed:\n${built.stderr.toString()}`);
  dist = join(PKG, 'dist');
});

describe('the built package', () => {
  test('compiles to JavaScript with type declarations beside it', () => {
    for (const f of ['index.js', 'index.d.ts', 'client.js', 'webhooks.js', 'webhooks.d.ts']) {
      expect(existsSync(join(dist, f)), `dist/${f} is missing`).toBe(true);
    }
  });

  test('every relative import carries a .js extension', () => {
    const offenders: string[] = [];
    for (const f of ['index.js', 'client.js', 'errors.js', 'retry.js', 'webhooks.js']) {
      for (const line of readFileSync(join(dist, f), 'utf8').split('\n')) {
        const m = /from '(\.[^']*)'/.exec(line);
        if (m && !m[1]!.endsWith('.js')) offenders.push(`${f}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the entry points package.json names all exist', () => {
    const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      main: string; types: string; exports: Record<string, { types: string; default: string }>;
    };
    for (const p of [pkg.main, pkg.types, ...Object.values(pkg.exports).flatMap((e) => [e.types, e.default])]) {
      expect(existsSync(join(PKG, p)), `${p} is declared but missing`).toBe(true);
    }
  });

  test('no test files or sources are shipped', () => {
    const packed = Bun.spawnSync(['bun', 'pm', 'pack', '--dry-run'], { cwd: PKG, stdout: 'pipe', stderr: 'pipe' });
    const listing = packed.stdout.toString() + packed.stderr.toString();
    expect(listing).not.toContain('.test.ts');
    expect(listing).not.toContain('src/');
    expect(listing).toContain('dist/index.js');
  });

  test('and it still declares no dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });
});

describe('installed into a plain Node project', () => {
  test('both entry points import, and the exports are real', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sadasend-pack-'));
    try {
      const packed = Bun.spawnSync(['bun', 'pm', 'pack', '--destination', dir], { cwd: PKG, stdout: 'pipe', stderr: 'pipe' });
      expect(packed.exitCode, packed.stderr.toString()).toBe(0);

      const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as { version: string };
      const tgz = join(dir, `sadasend-${pkg.version}.tgz`);
      writeFileSync(join(dir, 'package.json'), '{"name":"c","type":"module","version":"1.0.0"}');
      const installed = Bun.spawnSync(['npm', 'install', tgz, '--silent', '--no-audit', '--no-fund'], {
        cwd: dir, stdout: 'pipe', stderr: 'pipe',
      });
      expect(installed.exitCode, installed.stderr.toString()).toBe(0);

      writeFileSync(join(dir, 'check.mjs'), `
        import { SadaSend, RecipientNotAllowlistedError, SadaSendError } from 'sadasend';
        import { verifyWebhook, parseWebhook } from 'sadasend/webhooks';
        import { readdirSync } from 'node:fs';
        const e = new RecipientNotAllowlistedError('x', 403, 'm', { allowlist: ['@a.test'] });
        console.log(JSON.stringify({
          client: typeof SadaSend,
          webhooks: typeof verifyWebhook === 'function' && typeof parseWebhook === 'function',
          subclassing: e instanceof SadaSendError && e.allowlist[0] === '@a.test',
          installed: readdirSync('node_modules').filter((d) => !d.startsWith('.')),
        }));
      `);
      const ran = Bun.spawnSync(['node', 'check.mjs'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
      expect(ran.exitCode, ran.stderr.toString()).toBe(0);

      const out = JSON.parse(ran.stdout.toString()) as Record<string, unknown>;
      expect(out.client).toBe('function');
      expect(out.webhooks).toBe(true);
      expect(out.subclassing).toBe(true);
      expect(out.installed).toEqual(['sadasend']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});

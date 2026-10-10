import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const EXAMPLE = 'examples/ten-lines.ts';

let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      if (req.method === 'POST' && new URL(req.url).pathname === '/emails') {
        return new Response(JSON.stringify({ status: 'queued', id: '11111111-2222-3333-4444-555555555555' }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    },
  });
});

afterAll(() => {
  server?.stop(true);
});

describe('the ten-line example', () => {
  const counted = () => readFileSync(EXAMPLE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('//'));

  test('is ten lines or fewer', () => {
    const lines = counted();
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines.length).toBeGreaterThan(5);
  });

  test('installs the published package name, not a relative path', () => {
    const src = readFileSync(EXAMPLE, 'utf8');
    expect(src).toContain("from 'sadasend'");
    expect(src).not.toMatch(/from '\.\.?\//);
    expect(src).toContain('bun add sadasend');
  });

  test('the README shows exactly the file that runs', () => {
    const readme = readFileSync('README.md', 'utf8');
    const block = /<!-- example:ten-lines -->\n```ts\n([\s\S]*?)```\n<!-- \/example -->/.exec(readme);
    expect(block, 'the marked example block is missing from the README').not.toBeNull();
    expect(block![1]).toBe(readFileSync(EXAMPLE, 'utf8'));
  });

  test('runs, against a server, and sends a message', async () => {
    process.env.SADASEND_API_KEY = 'sada_live_sk_test123';
    process.env.SADASEND_BASE_URL = `http://localhost:${server.port}`;

    const logged: unknown[][] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { logged.push(args); };
    try {
      await import(`../examples/ten-lines.ts?run=${Date.now()}`);
    } finally {
      console.log = realLog;
    }

    expect(logged).toHaveLength(1);
    expect(logged[0]![0]).toBe('queued');
    expect(String(logged[0]![1])).toBe('11111111-2222-3333-4444-555555555555');
  });
});

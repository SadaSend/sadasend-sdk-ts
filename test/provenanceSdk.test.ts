import { describe, expect, test } from 'bun:test';
import { SadaSend } from '../src/client.js';

type Scripted = { status: number; body?: unknown; headers?: Record<string, string> };

function scriptedFetch(script: Scripted[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = script[calls.length - 1] ?? script.at(-1)!;
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json', ...next.headers },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fn, calls };
}

describe('SDK Provenance Tracking', () => {
  test('emails.send passes channel, source, and agent_name in body and headers from input', async () => {
    const f = scriptedFetch([{ status: 202, body: { id: 'msg_123', status: 'queued' } }]);
    const sdk = new SadaSend('sada_live_sk_test', {
      baseUrl: 'https://api.test',
      fetch: f.fn,
    });

    const res = await sdk.emails.send({
      from: 'alerts@domain.com',
      to: 'user@example.com',
      subject: 'Agent update',
      text: 'Report ready',
      channel: 'mcp',
      source: 'agent',
      agentName: 'claude-code',
    });

    expect(res.ok).toBe(true);
    expect(f.calls.length).toBe(1);

    const call = f.calls[0]!;
    expect(call.url).toBe('https://api.test/emails');
    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-sadasend-agent']).toBe('claude-code');
    expect(headers['x-sadasend-source']).toBe('agent');

    const body = JSON.parse(call.init.body as string);
    expect(body.channel).toBe('mcp');
    expect(body.source).toBe('agent');
    expect(body.agent_name).toBe('claude-code');
  });

  test('client-level defaults populate provenance if omitted from send', async () => {
    const f = scriptedFetch([{ status: 202, body: { id: 'msg_456', status: 'queued' } }]);
    const sdk = new SadaSend('sada_agent_sk_test', {
      baseUrl: 'https://api.test',
      fetch: f.fn,
      channel: 'sdk',
      source: 'automation',
      agentName: 'ci-runner',
    });

    const res = await sdk.emails.send({
      from: 'ci@domain.com',
      to: 'qa@example.com',
      subject: 'Build passed',
      text: 'All green',
    });

    expect(res.ok).toBe(true);
    const call = f.calls[0]!;
    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-sadasend-agent']).toBe('ci-runner');
    expect(headers['x-sadasend-source']).toBe('automation');

    const body = JSON.parse(call.init.body as string);
    expect(body.channel).toBe('sdk');
    expect(body.source).toBe('automation');
    expect(body.agent_name).toBe('ci-runner');
  });

  test('emails.list passes channel, source, and agent_name query parameters', async () => {
    const f = scriptedFetch([{ status: 200, body: { messages: [], total: 0, nextCursor: null } }]);
    const sdk = new SadaSend('sada_live_sk_test', {
      baseUrl: 'https://api.test',
      fetch: f.fn,
    });

    await sdk.emails.list({
      channel: 'mcp',
      source: 'agent',
      agentName: 'support-bot',
    });

    expect(f.calls.length).toBe(1);
    const url = new URL(f.calls[0]!.url);
    expect(url.searchParams.get('channel')).toBe('mcp');
    expect(url.searchParams.get('source')).toBe('agent');
    expect(url.searchParams.get('agent_name')).toBe('support-bot');
  });
});

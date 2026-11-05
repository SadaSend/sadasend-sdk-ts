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

  test('emails.send passes structured provenance and x-sadasend-priority header', async () => {
    const f = scriptedFetch([
      { status: 202, body: { id: 'msg_prov_1', status: 'queued', holdType: null } },
    ]);
    const sdk = new SadaSend('sada_live_sk_test', {
      baseUrl: 'https://api.test',
      fetch: f.fn,
    });

    const res = await sdk.emails.send({
      from: 'alerts@domain.com',
      to: 'vip@example.com',
      subject: 'Critical Alert',
      text: 'Action required',
      provenance: {
        channel: 'agent',
        source: 'workflow',
        agentName: 'arbiter-bot',
        priority: 'critical',
      },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.id).toBe('msg_prov_1');
      expect(res.status).toBe('queued');
      expect(res.holdType).toBeNull();
    }

    const call = f.calls[0]!;
    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-sadasend-agent']).toBe('arbiter-bot');
    expect(headers['x-sadasend-source']).toBe('workflow');
    expect(headers['x-sadasend-priority']).toBe('critical');

    const body = JSON.parse(call.init.body as string);
    expect(body.channel).toBe('agent');
    expect(body.source).toBe('workflow');
    expect(body.agent_name).toBe('arbiter-bot');
    expect(body.provenance).toEqual({
      channel: 'agent',
      source: 'workflow',
      agentName: 'arbiter-bot',
      priority: 'critical',
    });
  });

  test('emails.send and emails.get preserve holdType in pending_approval responses', async () => {
    const f = scriptedFetch([
      {
        status: 202,
        body: {
          id: 'msg_held_1',
          status: 'pending_approval',
          held: true,
          holdType: 'security',
          holdReason: 'Volume surge anomaly detected: projected daily volume (3,500) exceeds safety threshold (3,000, 3x 7-day baseline). Held for operator review.',
        },
      },
      {
        status: 200,
        body: {
          id: 'msg_held_1',
          from: 'agent@corp.com',
          to: ['target@external.com'],
          subject: 'Outreach',
          status: 'pending_approval',
          held: true,
          holdType: 'security',
          holdReason: 'Volume surge anomaly detected: projected daily volume (3,500) exceeds safety threshold (3,000, 3x 7-day baseline). Held for operator review.',
          at: '2026-10-30T10:00:00Z',
          provenance: {
            channel: 'agent',
            source: 'mcp',
            agentName: 'sales-agent',
            priority: 'standard',
          },
        },
      },
    ]);
    const sdk = new SadaSend('sada_live_sk_test', {
      baseUrl: 'https://api.test',
      fetch: f.fn,
    });

    const sendRes = await sdk.emails.send({
      from: 'agent@corp.com',
      to: 'target@external.com',
      subject: 'Outreach',
      text: 'Hello',
    });

    expect(sendRes.ok).toBe(true);
    if (sendRes.ok) {
      expect(sendRes.status).toBe('pending_approval');
      expect(sendRes.held).toBe(true);
      expect(sendRes.holdType).toBe('security');
      expect(sendRes.holdReason).toContain('Volume surge anomaly detected');
    }

    const getRes = await sdk.emails.get('msg_held_1');
    expect(getRes.ok).toBe(true);
    if (getRes.ok) {
      expect(getRes.data.status).toBe('pending_approval');
      expect(getRes.data.held).toBe(true);
      expect(getRes.data.holdType).toBe('security');
      expect(getRes.data.holdReason).toContain('Volume surge anomaly detected');
      expect(getRes.data.provenance?.priority).toBe('standard');
      expect(getRes.data.provenance?.agentName).toBe('sales-agent');
    }
  });

  test('emails.batch serializes provenance and agent metadata for each item', async () => {
    const f = scriptedFetch([
      {
        status: 207,
        body: {
          total: 1,
          accepted: 1,
          refused: 0,
          results: [{ ok: true, id: 'msg_b1', index: 0 }],
        },
      },
    ]);
    const sdk = new SadaSend('sada_live_sk_test', {
      baseUrl: 'https://api.test',
      fetch: f.fn,
    });

    const batchRes = await sdk.emails.batch([
      {
        from: 'bot@corp.com',
        to: 'lead@corp.com',
        subject: 'Batch item',
        text: 'Hello',
        provenance: {
          channel: 'agent',
          source: 'workflow',
          agentName: 'batch-bot',
          priority: 'bulk',
        },
      },
    ]);

    expect(batchRes.ok).toBe(true);
    const body = JSON.parse(f.calls[0]!.init.body as string);
    expect(body.emails[0].agent_name).toBe('batch-bot');
    expect(body.emails[0].channel).toBe('agent');
    expect(body.emails[0].source).toBe('workflow');
    expect(body.emails[0].provenance.priority).toBe('bulk');
  });

  test('emails.send passes allowDuplicate, dlp, crossAgentCooldown, priority, and ticketAware', async () => {
    const f = scriptedFetch([
      { status: 202, body: { id: 'msg_advanced_1', status: 'queued' } },
    ]);
    const sdk = new SadaSend('sada_live_sk_test', {
      baseUrl: 'https://api.test',
      fetch: f.fn,
    });

    const res = await sdk.emails.send({
      from: 'agent@corp.com',
      to: 'customer@corp.com',
      subject: 'Urgent Update',
      text: 'Notification body',
      bypassLoopBreaker: true,
      dlp: false,
      crossAgentCooldown: '24h',
      priority: 'critical',
      ticketAware: false,
    });

    expect(res.ok).toBe(true);
    const call = f.calls[0]!;
    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-sadasend-priority']).toBe('critical');

    const body = JSON.parse(call.init.body as string);
    expect(body.allow_duplicate).toBe(true);
    expect(body.dlp).toBe(false);
    expect(body.cross_agent_cooldown).toBe('24h');
    expect(body.priority).toBe('critical');
    expect(body.ticket_aware).toBe(false);
  });

  test('emails.batch serializes arbitration and safety controls per item', async () => {
    const f = scriptedFetch([
      { status: 207, body: { total: 1, accepted: 1, refused: 0, results: [{ ok: true, id: 'b1' }] } },
    ]);
    const sdk = new SadaSend('sada_live_sk_test', {
      baseUrl: 'https://api.test',
      fetch: f.fn,
    });

    const res = await sdk.emails.batch([
      {
        from: 'agent@corp.com',
        to: 'customer@corp.com',
        subject: 'Batch item',
        text: 'Hello',
        allowDuplicate: true,
        dlp: true,
        crossAgentCooldown: 3600,
        priority: 'alert',
        ticketAware: true,
      },
    ]);

    expect(res.ok).toBe(true);
    const body = JSON.parse(f.calls[0]!.init.body as string);
    expect(body.emails[0].allow_duplicate).toBe(true);
    expect(body.emails[0].dlp).toBe(true);
    expect(body.emails[0].cross_agent_cooldown).toBe(3600);
    expect(body.emails[0].priority).toBe('alert');
    expect(body.emails[0].ticket_aware).toBe(true);
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SadaSend, verifyWebhook, parseWebhook } from '../src/index.js';
import {
  AuthenticationError,
  ConnectionError,
  DomainNotVerifiedError,
  InsufficientScopeError,
  RecipientNotAllowlistedError,
  RecipientSuppressedError,
  UndeliverableRecipientError,
} from '../src/errors.js';

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
const TEST_KEY = 'sada_live_sk_test_e2e_secret_123';

// In-memory state for stateful E2E operations
const state = {
  messages: new Map<string, any>(),
  suppressions: new Set<string>(['already-blocked@example.com']),
  flakyAttempts: 0,
  rateLimitAttempts: 0,
  idempotencyKeysSeen: [] as string[],
};

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get('authorization');
      const method = req.method;
      const simulate = req.headers.get('x-simulate');
      const idempotencyKey = req.headers.get('idempotency-key');
      if (idempotencyKey) {
        state.idempotencyKeysSeen.push(idempotencyKey);
      }

      // Check auth for protected routes
      if (!auth || auth !== `Bearer ${TEST_KEY}`) {
        return new Response(JSON.stringify({
          error: 'invalid_api_key',
          message: 'That API key is not valid, or it has been revoked.',
          docs: 'https://www.sadasend.com/docs/errors#invalid_api_key',
        }), { status: 401, headers: { 'content-type': 'application/json' } });
      }

      // Simulation headers for end-to-end wire testing
      if (simulate === 'flaky-500') {
        state.flakyAttempts++;
        if (state.flakyAttempts === 1) {
          return new Response(JSON.stringify({
            error: 'temporary_database_glitch',
            message: 'Database connection retry needed',
          }), { status: 503, headers: { 'content-type': 'application/json' } });
        }
        return Response.json({
          id: 'acc_flaky_ok',
          org: 'Recovered Org',
          plan: 'scale',
          state: 'active',
          emailsUsed: 1,
          emailQuota: 1000,
          domainsUsed: 1,
          domainQuota: 1,
          retentionDays: 30,
          trackOpens: false,
          trackClicks: false,
          seatsUsed: 1,
          seatQuota: 1,
        });
      }

      if (simulate === 'rate-limited') {
        state.rateLimitAttempts++;
        if (state.rateLimitAttempts === 1) {
          return new Response(JSON.stringify({
            error: 'rate_limited',
            message: 'Burst ceiling hit',
          }), {
            status: 429,
            headers: {
              'content-type': 'application/json',
              'retry-after': '0',
            },
          });
        }
        return Response.json({
          id: 'acc_rate_recovered',
          org: 'Throttled Org Recovered',
          plan: 'scale',
          state: 'active',
          emailsUsed: 1,
          emailQuota: 1000,
          domainsUsed: 1,
          domainQuota: 1,
          retentionDays: 30,
          trackOpens: false,
          trackClicks: false,
          seatsUsed: 1,
          seatQuota: 1,
        });
      }

      if (simulate === 'allowlist') {
        return new Response(JSON.stringify({
          error: 'recipient_not_allowlisted',
          message: 'Key allowlist is [@allowed.example]. Recipient is outside it.',
          allowlist: ['@allowed.example'],
          recipient: 'outsider@evil.com',
        }), { status: 403, headers: { 'content-type': 'application/json' } });
      }

      if (simulate === 'domain-unverified') {
        return new Response(JSON.stringify({
          error: 'domain_not_verified',
          message: 'example.com has not passed DNS verification yet.',
          records: [
            { type: 'TXT', host: 'sada._domainkey', value: 'v=DKIM1...', verdict: 'fail' },
          ],
        }), { status: 403, headers: { 'content-type': 'application/json' } });
      }

      if (simulate === 'suppressed') {
        return new Response(JSON.stringify({
          error: 'recipient_suppressed',
          message: 'Address is on the suppression list.',
          recipient: 'optout@example.com',
          reason: 'unsubscribe',
        }), { status: 403, headers: { 'content-type': 'application/json' } });
      }

      if (simulate === 'scope') {
        return new Response(JSON.stringify({
          error: 'insufficient_scope',
          message: 'Key lacks the send scope.',
        }), { status: 403, headers: { 'content-type': 'application/json' } });
      }

      // 1. Account Routes
      if (url.pathname === '/account' && method === 'GET') {
        return Response.json({
          id: 'acc_e2e_test',
          org: 'SadaSend E2E Org',
          plan: 'scale',
          state: 'active',
          emailsUsed: 420,
          emailQuota: 100_000,
          domainsUsed: 2,
          domainQuota: 10,
          retentionDays: 90,
          trackOpens: true,
          trackClicks: true,
          seatsUsed: 3,
          seatQuota: 10,
          reputationLevel: 'optimal',
        });
      }

      if (url.pathname === '/account/stats' && method === 'GET') {
        const windowParam = url.searchParams.get('window') || '14d';
        return Response.json({
          window: windowParam,
          sent: 1250,
          delivered: 1245,
          deliveryRate: 0.996,
          bounced: 4,
          bounceRate: 0.0032,
          complained: 1,
          complaintRate: 0.0008,
        });
      }

      if (url.pathname === '/account/volume' && method === 'GET') {
        const windowParam = url.searchParams.get('window') || '7d';
        return Response.json({
          window: windowParam,
          days: [
            { date: '2026-10-08', sent: 150, delivered: 149, bounced: 1, complained: 0 },
            { date: '2026-10-09', sent: 180, delivered: 180, bounced: 0, complained: 0 },
            { date: '2026-10-10', sent: 210, delivered: 209, bounced: 1, complained: 0 },
          ],
        });
      }

      if (url.pathname === '/account/checklist' && method === 'GET') {
        return Response.json({
          completed: 4,
          total: 5,
          items: [
            { key: 'verify_domain', title: 'Verify Sending Domain', completed: true },
            { key: 'send_first_email', title: 'Send First Email via SDK', completed: true },
            { key: 'setup_webhook', title: 'Configure Webhook Endpoint', completed: true },
            { key: 'add_team_member', title: 'Invite Teammate', completed: true },
            { key: 'setup_dmarc_rua', title: 'Publish DMARC RUA reporting', completed: false },
          ],
        });
      }

      if (url.pathname === '/account/circuit-breakers' && method === 'GET') {
        return Response.json({
          circuitBreakers: [
            {
              agentIdentifier: 'agent_rogue_1',
              agentName: 'marketing-spammer',
              channel: 'mcp',
              trippedAt: '2026-10-10T10:00:00Z',
              reason: 'Velocity ceiling exceeded: 50 emails in 1 minute',
            },
          ],
        });
      }

      if (url.pathname === '/account/staff-access' && method === 'GET') {
        return Response.json({
          accesses: [
            {
              id: 'stf_1',
              at: '2026-10-09T14:20:00Z',
              staff: 'support-agent@sadasend.com',
              role: 'support_engineer',
              reason: 'Ticket #4092 deliverability diagnosis',
            },
          ],
        });
      }

      // 2. Domain Routes
      if (url.pathname === '/domains' && method === 'GET') {
        return Response.json({
          domains: [
            { id: 'dom_live_123', name: 'onboarding.sadasend.com', status: 'verified' },
            { id: 'dom_unverified_456', name: 'staging.testcorp.com', status: 'unverified' },
          ],
        });
      }

      if (url.pathname.startsWith('/domains/') && url.pathname.endsWith('/records') && method === 'GET') {
        return Response.json({
          records: [
            { type: 'TXT', host: 'sadasend._domainkey.onboarding.sadasend.com', value: 'v=DKIM1; k=rsa; p=MIGfMA0GCS...', verdict: 'pass' },
            { type: 'TXT', host: 'onboarding.sadasend.com', value: 'v=spf1 include:_spf.sadasend.com ~all', verdict: 'pass' },
            { type: 'TXT', host: '_dmarc.onboarding.sadasend.com', value: 'v=DMARC1; p=reject; sp=reject;', verdict: 'pass' },
          ],
        });
      }

      if (url.pathname.startsWith('/domains/') && url.pathname.endsWith('/verify') && method === 'POST') {
        return Response.json({
          id: 'dom_live_123',
          status: 'verified',
          verified: true,
        });
      }

      // 3. Email Routes
      if (url.pathname === '/emails' && method === 'POST') {
        const body = await req.json();

        if (body.verify_before_send && (body.to === 'undeliverable@fake.test' || (Array.isArray(body.to) && body.to.includes('undeliverable@fake.test')))) {
          return new Response(JSON.stringify({
            error: 'undeliverable_recipient',
            message: 'Recipient address undeliverable@fake.test failed deliverability checks.',
            recipient: 'undeliverable@fake.test',
          }), { status: 422, headers: { 'content-type': 'application/json' } });
        }

        const id = `msg_${crypto.randomUUID()}`;
        const isDryRun = Boolean(body.dryRun);
        const isApproval = body.agent_name === 'approval-agent';

        const record = {
          id,
          from: body.from,
          to: body.to,
          subject: body.subject ?? 'No Subject',
          status: isApproval ? 'pending_approval' : 'queued',
          holdType: isApproval ? ('security' as const) : null,
          at: new Date().toISOString(),
          dryRun: isDryRun || undefined,
          channel: body.channel ?? 'sdk',
          source: body.source ?? 'backend',
          agentName: body.agent_name,
          provenance: body.provenance,
          events: [{ type: 'queued', at: new Date().toISOString() }],
        };
        state.messages.set(id, record);

        return new Response(JSON.stringify({
          id,
          status: record.status,
          holdType: record.holdType,
          ...(isDryRun ? { dryRun: true } : {}),
        }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.pathname === '/emails' && method === 'GET') {
        const limit = Number(url.searchParams.get('limit') || 20);
        const agentName = url.searchParams.get('agent_name');
        let all = Array.from(state.messages.values());
        if (agentName) {
          all = all.filter((m) => m.agentName === agentName);
        }
        return Response.json({
          messages: all.slice(0, limit),
          total: all.length,
          nextCursor: null,
        });
      }

      if (url.pathname === '/emails/batch' && method === 'POST') {
        const body = await req.json();
        const emails = body.emails || [];
        const results = emails.map((item: any, idx: number) => {
          const id = `msg_batch_${crypto.randomUUID()}`;
          return {
            index: idx,
            ok: true,
            id,
            status: 'queued',
          };
        });
        return new Response(JSON.stringify({
          total: emails.length,
          accepted: emails.length,
          refused: 0,
          results,
        }), {
          status: 207,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.pathname.startsWith('/emails/') && url.pathname.endsWith('/resend') && method === 'POST') {
        const parts = url.pathname.split('/');
        const originalId = parts[2]!;
        const newId = `msg_resend_${crypto.randomUUID()}`;
        return new Response(JSON.stringify({
          id: newId,
          status: 'queued',
          originalId,
        }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.pathname.startsWith('/emails/') && method === 'GET') {
        const parts = url.pathname.split('/');
        const id = decodeURIComponent(parts[2]!);
        const found = state.messages.get(id);
        if (found) {
          return Response.json(found);
        }
        return Response.json({
          id,
          from: 'noreply@onboarding.sadasend.com',
          to: ['recipient@example.com'],
          subject: 'Fallback message',
          status: 'delivered',
          at: new Date().toISOString(),
          events: [
            { type: 'queued', at: new Date(Date.now() - 5000).toISOString() },
            { type: 'delivered', at: new Date().toISOString() },
          ],
        });
      }

      if (url.pathname.startsWith('/emails/') && method === 'DELETE') {
        const parts = url.pathname.split('/');
        const id = decodeURIComponent(parts[2]!);
        return Response.json({
          id,
          status: 'cancelled',
          scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        });
      }

      // 4. Template Routes
      if (url.pathname === '/templates' && method === 'GET') {
        return Response.json({
          templates: [
            { id: 'tpl_welcome_1', name: 'Customer Welcome', version: 2 },
            { id: 'tpl_invoice_2', name: 'Order Invoice', version: 1 },
          ],
        });
      }

      if (url.pathname.startsWith('/templates/') && url.pathname.endsWith('/render') && method === 'POST') {
        const body = await req.json();
        return Response.json({
          subject: `Invoice for ${body.variables?.customer_name || 'Customer'}`,
          html: `<p>Hello ${body.variables?.customer_name || 'Customer'}, total is ${body.variables?.total || '$0'}</p>`,
          text: `Hello ${body.variables?.customer_name || 'Customer'}`,
        });
      }

      if (url.pathname.startsWith('/templates/') && url.pathname.endsWith('/test') && method === 'POST') {
        return Response.json({
          ok: true,
          messageId: `msg_test_${crypto.randomUUID()}`,
        });
      }

      if (url.pathname.startsWith('/templates/') && method === 'GET') {
        const parts = url.pathname.split('/');
        const id = decodeURIComponent(parts[2]!);
        return Response.json({
          id,
          name: 'Customer Welcome',
          subject: 'Welcome to SadaSend, {{ customer_name }}',
          html: '<h1>Welcome</h1>',
          text: 'Welcome',
          version: 2,
        });
      }

      // 5. Suppression Routes
      if (url.pathname === '/suppressions' && method === 'POST') {
        const body = await req.json();
        const already = state.suppressions.has(body.address);
        state.suppressions.add(body.address);
        return new Response(JSON.stringify({
          address: body.address,
          reason: body.reason,
          already,
        }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.pathname.startsWith('/suppressions') && method === 'GET') {
        const queryQ = url.searchParams.get('q');
        let list = Array.from(state.suppressions).map((addr) => ({
          address: addr,
          reason: 'unsubscribe',
          createdAt: new Date().toISOString(),
        }));
        if (queryQ) {
          list = list.filter((item) => item.address.includes(queryQ));
        }
        return Response.json({
          suppressions: list,
          total: list.length,
        });
      }

      // 6. Keys & Approvals
      if (url.pathname === '/keys' && method === 'GET') {
        return Response.json({
          keys: [
            {
              id: 'key_1',
              name: 'Production Worker Key',
              prefix: 'sada_live_sk_',
              mode: 'live',
              scopes: ['send', 'read', 'templates'],
              createdAt: '2026-09-01T00:00:00Z',
              lastUsedAt: '2026-10-10T12:00:00Z',
            },
          ],
        });
      }

      if (url.pathname === '/keys/approvals' && method === 'GET') {
        return Response.json({
          pending: [
            {
              id: 'appr_msg_101',
              to: 'vip-client@example.com',
              subject: 'Contract Approval Required',
              requestedBy: 'agent_claude_3',
              at: '2026-10-10T11:45:00Z',
            },
          ],
        });
      }

      // 7. Support & Team & Tools
      if (url.pathname.startsWith('/support/tickets') && method === 'GET') {
        const parts = url.pathname.split('/');
        if (parts.length > 3 && parts[3]) {
          return Response.json({
            id: parts[3],
            subject: 'Domain alignment question',
            status: 'open',
            priority: 'normal',
            createdAt: '2026-10-09T08:00:00Z',
          });
        }
        return Response.json({
          tickets: [
            {
              id: 'tkt_123',
              subject: 'Domain alignment question',
              status: 'open',
              priority: 'normal',
              createdAt: '2026-10-09T08:00:00Z',
            },
          ],
        });
      }

      if (url.pathname === '/team' && method === 'GET') {
        return Response.json({
          members: [
            { id: 'usr_1', name: 'Alice Founder', email: 'alice@sadasend.com', role: 'owner' },
            { id: 'usr_2', name: 'Bob Engineer', email: 'bob@sadasend.com', role: 'developer' },
          ],
        });
      }

      if (url.pathname === '/tools' && method === 'GET') {
        return Response.json({
          tools: [
            { id: 'dns_inspector', name: 'DNS Inspector', description: 'Validate DKIM and SPF records' },
            { id: 'dmarc_analyzer', name: 'DMARC Analyzer', description: 'Analyze domain alignment' },
          ],
        });
      }

      if (url.pathname === '/tools/verify' && method === 'POST') {
        const body = await req.json();
        const email = body.email || '';
        const isBad = email.includes('bad') || email.includes('undeliverable');
        const [user = '', domain = ''] = email.split('@');
        return Response.json({
          email,
          user,
          domain,
          status: isBad ? 'undeliverable' : 'deliverable',
          verdict: isBad ? 'fail' : 'pass',
          score: isBad ? 0 : 98,
          checks: {
            syntax: { valid: true },
            mx: { valid: !isBad, records: isBad ? [] : ['mx1.example.com'] },
            disposable: { isDisposable: false },
            role: { isRole: false },
          },
          rows: [
            { label: 'MX', value: isBad ? 'missing' : 'valid', verdict: isBad ? 'fail' : 'pass' },
          ],
          summary: isBad ? 'Undeliverable address' : 'Address is deliverable',
        });
      }

      if (url.pathname === '/tools/verify/batch' && method === 'POST') {
        const body = await req.json();
        const emails: string[] = body.emails || [];
        const results = emails.map((email) => {
          const isBad = email.includes('bad') || email.includes('undeliverable');
          const [user = '', domain = ''] = email.split('@');
          return {
            email,
            user,
            domain,
            status: isBad ? 'undeliverable' : 'deliverable',
            verdict: isBad ? 'fail' : 'pass',
            score: isBad ? 0 : 98,
            checks: {
              syntax: { valid: true },
              mx: { valid: !isBad },
              disposable: { isDisposable: false },
              role: { isRole: false },
            },
            rows: [],
            summary: isBad ? 'Undeliverable' : 'Deliverable',
          };
        });
        const deliverable = results.filter((r) => r.status === 'deliverable').length;
        const undeliverable = results.length - deliverable;
        return Response.json({
          ok: true,
          total: emails.length,
          deliverable,
          undeliverable,
          disposable: 0,
          role_account: 0,
          results,
        });
      }

      if (url.pathname === '/tools/utm' && method === 'POST') {
        const body = await req.json();
        const rawUrl = new URL(body.url || 'https://example.com');
        if (body.source) rawUrl.searchParams.set('utm_source', body.source);
        if (body.medium) rawUrl.searchParams.set('utm_medium', body.medium);
        if (body.campaign) rawUrl.searchParams.set('utm_campaign', body.campaign);
        if (body.term) rawUrl.searchParams.set('utm_term', body.term);
        if (body.content) rawUrl.searchParams.set('utm_content', body.content);
        const params: Record<string, string> = {};
        rawUrl.searchParams.forEach((v, k) => { params[k] = v; });
        return Response.json({
          ok: true,
          original: body.url || 'https://example.com',
          tagged: rawUrl.toString(),
          params,
        });
      }

      if (url.pathname.startsWith('/tools/') && method === 'POST') {
        const body = await req.json();
        return Response.json({
          tool: url.pathname.split('/')[2],
          subject: body.subject,
          status: 'ok',
          verdict: 'pass',
        });
      }

      // 8. Webhooks
      if (url.pathname === '/webhooks' && method === 'GET') {
        return Response.json({
          webhooks: [
            {
              id: 'wh_endpoint_99',
              url: 'https://webhook.site/sadasend-events',
              events: ['email.sent', 'email.delivered', 'email.bounced'],
              enabled: true,
            },
          ],
        });
      }

      if (url.pathname.startsWith('/webhooks/') && url.pathname.endsWith('/deliveries') && method === 'GET') {
        return Response.json({
          deliveries: [
            {
              id: 'del_1001',
              event: 'email.delivered',
              status: 200,
              success: true,
            },
          ],
        });
      }

      // 9. Inbound Routes & Parsing
      if (url.pathname === '/inbound/routes' && method === 'GET') {
        return Response.json({
          count: 1,
          routes: [
            {
              id: 'rt_live_1',
              pattern: '*@inbound.sadasend.com',
              targetUrl: 'https://webhook.site/inbound',
              enabled: true,
              priority: 10,
              description: 'Primary agent webhook inbound route',
              createdAt: '2026-10-10T00:00:00Z',
              updatedAt: '2026-10-10T00:00:00Z',
            },
          ],
        });
      }

      if (url.pathname === '/inbound/routes' && method === 'POST') {
        const body = await req.json();
        return Response.json({
          ok: true,
          route: {
            id: 'rt_live_created',
            pattern: body.pattern,
            targetUrl: body.targetUrl,
            enabled: body.enabled ?? true,
            priority: body.priority ?? 0,
            description: body.description,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }, { status: 201 });
      }

      if (url.pathname.startsWith('/inbound/routes/') && method === 'GET') {
        const id = decodeURIComponent(url.pathname.split('/')[3]!);
        return Response.json({
          ok: true,
          route: {
            id,
            pattern: '*@inbound.sadasend.com',
            targetUrl: 'https://webhook.site/inbound',
            enabled: true,
            priority: 10,
            createdAt: '2026-10-10T00:00:00Z',
            updatedAt: '2026-10-10T00:00:00Z',
          },
        });
      }

      if (url.pathname.startsWith('/inbound/routes/') && method === 'PATCH') {
        const id = decodeURIComponent(url.pathname.split('/')[3]!);
        const body = await req.json();
        return Response.json({
          ok: true,
          route: {
            id,
            pattern: body.pattern ?? '*@inbound.sadasend.com',
            targetUrl: body.targetUrl ?? 'https://webhook.site/inbound',
            enabled: body.enabled ?? false,
            priority: body.priority ?? 10,
            createdAt: '2026-10-10T00:00:00Z',
            updatedAt: new Date().toISOString(),
          },
        });
      }

      if (url.pathname.startsWith('/inbound/routes/') && method === 'DELETE') {
        const id = decodeURIComponent(url.pathname.split('/')[3]!);
        return Response.json({ ok: true, id, deleted: true });
      }

      if (url.pathname === '/inbound/messages' && method === 'GET') {
        return Response.json({
          count: 1,
          messages: [
            {
              id: 'in_msg_100',
              from: 'sender@client.com',
              to: ['support@inbound.sadasend.com'],
              subject: 'Need help with account',
              routeId: 'rt_live_1',
              status: 'processed',
              receivedAt: '2026-10-10T12:00:00Z',
            },
          ],
        });
      }

      if (url.pathname.startsWith('/inbound/messages/') && method === 'GET') {
        const id = decodeURIComponent(url.pathname.split('/')[3]!);
        return Response.json({
          ok: true,
          message: {
            id,
            from: 'sender@client.com',
            to: ['support@inbound.sadasend.com'],
            subject: 'Need help with account',
            status: 'processed',
            receivedAt: '2026-10-10T12:00:00Z',
          },
        });
      }

      if (url.pathname === '/inbound/parse' && method === 'POST') {
        const body = await req.json();
        return Response.json({
          ok: true,
          quarantined: false,
          from: body.from ?? 'sender@corp.com',
          to: body.to ?? ['agent@inbound.sadasend.com'],
          subject: body.subject ?? 'Inbound report',
          thread: {
            threadId: 'th_wire_1',
            cleanSubject: 'Inbound report',
            isThreadRoot: true,
            threadDepth: 1,
          },
          content: {
            cleanMarkdown: body.text ? `Cleaned: ${body.text}` : 'Parsed body markdown',
            hasQuotedHistory: false,
            hasSignature: false,
            telemetry: {
              originalBytes: 100,
              cleanedBytes: 80,
              originalTokensEst: 25,
              cleanedTokensEst: 20,
              tokenReductionPercent: 20,
            },
          },
          security: {
            injectionRiskScore: 0.02,
            riskLevel: 'clean',
            recommendedAction: 'pass',
            quarantineRecommended: false,
            hiddenContentDetected: false,
            detections: [],
          },
        });
      }

      if (url.pathname === '/inbound/simulate' && method === 'POST') {
        return Response.json({
          matched: true,
          targetUrl: 'https://webhook.site/inbound',
          route: {
            id: 'rt_live_1',
            pattern: '*@inbound.sadasend.com',
            targetUrl: 'https://webhook.site/inbound',
            enabled: true,
            priority: 10,
            createdAt: '2026-10-10T00:00:00Z',
            updatedAt: '2026-10-10T00:00:00Z',
          },
        });
      }

      // 10. DMARC Reports & Threats
      if (url.pathname.startsWith('/dmarc/reports/') && method === 'GET') {
        const id = decodeURIComponent(url.pathname.split('/')[3]!);
        return Response.json({
          ok: true,
          report: {
            id,
            org: 'Google Inc.',
            reportId: 'rep_g_123',
            domain: 'onboarding.sadasend.com',
          },
        });
      }

      if (url.pathname === '/dmarc/reports' && method === 'GET') {
        return Response.json({
          count: 1,
          reports: [
            {
              id: 'rep_wire_1',
              org: 'Google Inc.',
              reportId: 'rep_g_123',
              dateRangeBegin: '2026-10-01T00:00:00Z',
              dateRangeEnd: '2026-10-02T00:00:00Z',
              domain: 'onboarding.sadasend.com',
              policy: 'reject',
              totalMessages: 500,
              spfPassCount: 499,
              dkimPassCount: 500,
              fullyAlignedCount: 499,
              passRate: 0.998,
              createdAt: '2026-10-02T04:00:00Z',
            },
          ],
        });
      }

      if (url.pathname === '/dmarc/reports' && method === 'POST') {
        return Response.json({ ok: true, id: 'rep_wire_uploaded' }, { status: 201 });
      }

      if (url.pathname.startsWith('/dmarc/domains/') && url.pathname.endsWith('/summary') && method === 'GET') {
        const domain = decodeURIComponent(url.pathname.split('/')[3]!);
        return Response.json({
          domain,
          totalReports: 12,
          totalMessages: 5000,
          overallPassRate: 0.999,
          dkimAlignmentPct: 99.9,
          spfAlignmentPct: 100,
          currentPolicy: 'reject',
          recommendedPolicy: 'reject',
        });
      }

      if (url.pathname === '/dmarc/threats' && method === 'GET') {
        return Response.json({
          ok: true,
          threats: [
            {
              ip: '198.51.100.42',
              domain: 'phish-origin.bad',
              messageCount: 8,
              country: 'US',
              lastSeenAt: '2026-10-10T08:00:00Z',
            },
          ],
        });
      }

      // 11. Arbiter Multi-Agent Arbitration
      if (url.pathname === '/arbiter/stats' && method === 'GET') {
        return Response.json({
          ok: true,
          activeCooldownsCount: 2,
          openTicketsCount: 1,
          collisionsPrevented: 37,
        });
      }

      if (url.pathname.startsWith('/arbiter/recipients/') && url.pathname.endsWith('/cooldown') && method === 'POST') {
        const recipient = decodeURIComponent(url.pathname.split('/')[3]!);
        const body = await req.json();
        return Response.json({
          ok: true,
          cooldown: true,
          recipient,
          durationSeconds: body.durationSeconds ?? 86400,
          reason: body.reason,
          expiresAt: new Date(Date.now() + (body.durationSeconds ?? 86400) * 1000).toISOString(),
        });
      }

      if (url.pathname.startsWith('/arbiter/recipients/') && url.pathname.endsWith('/cooldown') && method === 'DELETE') {
        const recipient = decodeURIComponent(url.pathname.split('/')[3]!);
        return Response.json({ ok: true, recipient, cleared: true });
      }

      if (url.pathname.startsWith('/arbiter/recipients/') && url.pathname.endsWith('/status') && method === 'GET') {
        const recipient = decodeURIComponent(url.pathname.split('/')[3]!);
        return Response.json({
          ok: true,
          recipient,
          cooldownActive: false,
          remainingSeconds: 0,
        });
      }

      if (url.pathname === '/arbiter/tickets' && method === 'POST') {
        const body = await req.json();
        return Response.json({
          ok: true,
          recipient: body.recipient,
          ticketId: 'tkt_arbiter_wire_1',
        });
      }

      if (url.pathname.startsWith('/arbiter/tickets/') && method === 'DELETE') {
        const recipient = decodeURIComponent(url.pathname.split('/')[3]!);
        return Response.json({ ok: true, recipient, resolved: true });
      }

      // 12. Ephemeral Inboxes
      if (url.pathname === '/inboxes' && method === 'GET') {
        return Response.json({
          ok: true,
          count: 1,
          inboxes: [
            {
              id: 'inb_wire_1',
              email: 'e2e-agent@auth.sadasend.com',
              alias: 'e2e-agent',
              domain: 'auth.sadasend.com',
              ttlSeconds: 3600,
              createdAt: '2026-10-10T00:00:00Z',
              expiresAt: '2026-10-10T01:00:00Z',
              messageCount: 1,
              latestOtp: '654321',
            },
          ],
        });
      }

      if (url.pathname === '/inboxes/ephemeral' && method === 'POST') {
        const body = await req.json();
        return Response.json({
          ok: true,
          inbox: {
            id: 'inb_wire_new',
            email: `${body?.alias ?? 'ephemeral'}@auth.sadasend.com`,
            alias: body?.alias ?? 'ephemeral',
            domain: 'auth.sadasend.com',
            ttlSeconds: body?.ttlSeconds ?? 1800,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + (body?.ttlSeconds ?? 1800) * 1000).toISOString(),
            messageCount: 0,
          },
        }, { status: 201 });
      }

      if (url.pathname.startsWith('/inboxes/') && url.pathname.endsWith('/otp') && method === 'GET') {
        const id = decodeURIComponent(url.pathname.split('/')[2]!);
        return Response.json({
          ok: true,
          inboxId: id,
          email: 'e2e-agent@auth.sadasend.com',
          code: '654321',
          otp: '654321',
          magicLink: null,
        });
      }

      if (url.pathname.startsWith('/inboxes/') && url.pathname.endsWith('/messages') && method === 'GET') {
        return Response.json({
          ok: true,
          messages: [
            {
              id: 'inb_m_1',
              from: 'security@service.com',
              subject: 'Your One-Time Code: 654321',
              receivedAt: '2026-10-10T00:05:00Z',
              otp: '654321',
            },
          ],
        });
      }

      if (url.pathname.startsWith('/inboxes/') && url.pathname.endsWith('/stream') && method === 'GET') {
        const id = decodeURIComponent(url.pathname.split('/')[2]!);
        return Response.json({
          ok: true,
          url: `https://api.sadasend.com/inboxes/${id}/stream`,
        });
      }

      if (url.pathname === '/inboxes/inbound' && method === 'POST') {
        return Response.json({ ok: true, otp: '654321', magicLink: null }, { status: 201 });
      }

      if (url.pathname.startsWith('/inboxes/') && method === 'GET') {
        const id = decodeURIComponent(url.pathname.split('/')[2]!);
        return Response.json({
          ok: true,
          inbox: {
            id,
            email: 'e2e-agent@auth.sadasend.com',
            alias: 'e2e-agent',
            domain: 'auth.sadasend.com',
            ttlSeconds: 3600,
            createdAt: '2026-10-10T00:00:00Z',
            expiresAt: '2026-10-10T01:00:00Z',
            messageCount: 1,
          },
        });
      }

      if (url.pathname.startsWith('/inboxes/') && method === 'DELETE') {
        const id = decodeURIComponent(url.pathname.split('/')[2]!);
        return Response.json({ ok: true, id, deleted: true });
      }

      // 13. Testing Inbound & WaitForCode
      if (url.pathname === '/testing/inbound' && method === 'POST') {
        return Response.json({ ok: true, status: 'ingested', id: 'tst_wire_inbound_1' });
      }

      if (url.pathname === '/testing/wait-for-code' && method === 'POST') {
        return Response.json({
          ok: true,
          code: '772211',
          magicLink: null,
          messageId: 'tst_msg_wait_1',
        });
      }

      if (url.pathname.startsWith('/testing/inboxes/') && url.pathname.endsWith('/code') && method === 'GET') {
        return Response.json({ ok: true, code: '772211' });
      }

      if (url.pathname.startsWith('/testing/inboxes/') && url.pathname.endsWith('/latest') && method === 'GET') {
        return Response.json({
          ok: true,
          message: { id: 'tst_msg_wait_1', code: '772211', subject: 'Verification code' },
        });
      }

      // 14. Integrations
      if (url.pathname === '/integrations/slack' && method === 'GET') {
        return Response.json({
          connected: true,
          integration: {
            id: 'slk_wire_int',
            channel: 'slack',
            name: 'Slack Alerts Channel',
            enabled: true,
            hasSigningSecret: true,
            createdAt: '2026-10-01T00:00:00Z',
            updatedAt: '2026-10-01T00:00:00Z',
          },
        });
      }

      return new Response(JSON.stringify({ error: 'not_found', path: url.pathname }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
});

describe('End-to-End Suite: Real Network Wire Tests', () => {
  test('Complete SDK resource lifecycle runs against real HTTP server', async () => {
    const client = new SadaSend(TEST_KEY, {
      baseUrl,
      channel: 'sdk',
      source: 'agent',
      agentName: 'e2e-suite-runner',
    });

    // 1. Account Telemetry
    const acc = await client.account.get();
    expect(acc.ok).toBe(true);
    if (acc.ok) {
      expect(acc.data.org).toBe('SadaSend E2E Org');
      expect(acc.data.plan).toBe('scale');
      expect(acc.data.emailsUsed).toBe(420);
    }

    const stats = await client.account.stats({ window: '14d' });
    expect(stats.ok).toBe(true);
    if (stats.ok) {
      expect(stats.data.sent).toBe(1250);
      expect(stats.data.deliveryRate).toBeGreaterThan(0.99);
    }

    const volume = await client.account.volume({ window: '7d' });
    expect(volume.ok).toBe(true);
    if (volume.ok) {
      expect(volume.data.days.length).toBe(3);
    }

    const checklist = await client.account.checklist();
    expect(checklist.ok).toBe(true);
    if (checklist.ok) {
      expect(checklist.data.completed).toBe(4);
    }

    const breakers = await client.account.circuitBreakers();
    expect(breakers.ok).toBe(true);
    if (breakers.ok) {
      expect(breakers.data.circuitBreakers.length).toBe(1);
      expect(breakers.data.circuitBreakers[0]!.agentName).toBe('marketing-spammer');
    }

    const staff = await client.account.staffAccess();
    expect(staff.ok).toBe(true);
    if (staff.ok) {
      expect(staff.data.accesses.length).toBe(1);
    }

    // 2. Domains
    const doms = await client.domains.list();
    expect(doms.ok).toBe(true);
    if (doms.ok) {
      expect(doms.data.domains.length).toBe(2);
      const primary = doms.data.domains[0]!;
      expect(primary.name).toBe('onboarding.sadasend.com');

      const recs = await client.domains.records(primary.id);
      expect(recs.ok).toBe(true);
      if (recs.ok) {
        expect(recs.data.records.length).toBe(3);
      }

      const verify = await client.domains.verify(primary.id);
      expect(verify.ok).toBe(true);
      if (verify.ok) {
        expect(verify.data.status).toBe('verified');
      }
    }

    // 3. Email Sending & Lifecycle
    const sendRes = await client.emails.send({
      from: 'noreply@onboarding.sadasend.com',
      to: 'recipient@example.com',
      subject: 'E2E Wire Test',
      html: '<h1>End-to-End Success</h1>',
      tags: ['e2e', 'wire'],
      attachments: [
        {
          filename: 'test.txt',
          content: Buffer.from('E2E payload').toString('base64'),
          contentType: 'text/plain',
        },
      ],
      idempotencyKey: 'idemp_key_custom_wire_1',
    });
    expect(sendRes.ok).toBe(true);
    if (sendRes.ok) {
      expect(sendRes.status).toBe('queued');
      expect(sendRes.id).toMatch(/^msg_/);

      const msgGet = await client.emails.get(sendRes.id);
      expect(msgGet.ok).toBe(true);
      if (msgGet.ok) {
        expect(msgGet.data.id).toBe(sendRes.id);
        expect(msgGet.data.from).toBe('noreply@onboarding.sadasend.com');
        expect(msgGet.data.to).toEqual(['recipient@example.com']);
      }

      const resend = await client.emails.resend(sendRes.id);
      expect(resend.ok).toBe(true);
      if (resend.ok) {
        expect(resend.data.status).toBe('queued');
        expect(resend.data.id).toMatch(/^msg_resend_/);
      }
    }

    // Dry Run Send
    const dryRun = await client.emails.send({
      from: 'noreply@onboarding.sadasend.com',
      to: 'recipient@example.com',
      subject: 'Dry run check',
      text: 'No mail delivered',
      dryRun: true,
    });
    expect(dryRun.ok).toBe(true);
    if (dryRun.ok) {
      expect(dryRun.dryRun).toBe(true);
    }

    // Approval Mode Send
    const approvalSend = await client.emails.send({
      from: 'noreply@onboarding.sadasend.com',
      to: 'recipient@example.com',
      subject: 'Approval check',
      text: 'Held in queue',
      agentName: 'approval-agent',
    });
    expect(approvalSend.ok).toBe(true);
    if (approvalSend.ok) {
      expect(approvalSend.status).toBe('pending_approval');
    }

    // Cancel Scheduled Send
    const cancelRes = await client.emails.cancel('msg_scheduled_to_cancel');
    expect(cancelRes.ok).toBe(true);
    if (cancelRes.ok) {
      expect(cancelRes.data.status).toBe('cancelled');
    }

    // Batch Sending
    const batch = await client.emails.batch([
      { from: 'noreply@onboarding.sadasend.com', to: 'a@example.com', subject: 'Batch 1', text: 'Item 1' },
      { from: 'noreply@onboarding.sadasend.com', to: 'b@example.com', subject: 'Batch 2', text: 'Item 2' },
    ]);
    expect(batch.ok).toBe(true);
    if (batch.ok) {
      expect(batch.data.total).toBe(2);
      expect(batch.data.accepted).toBe(2);
      expect(batch.data.results.length).toBe(2);
    }

    // Email Listing
    const listRes = await client.emails.list({ limit: 10 });
    expect(listRes.ok).toBe(true);
    if (listRes.ok) {
      expect(listRes.data.messages.length).toBeGreaterThan(0);
    }

    // 4. Templates
    const tpls = await client.templates.list();
    expect(tpls.ok).toBe(true);
    if (tpls.ok) {
      expect(tpls.data.templates.length).toBe(2);
      const tplId = tpls.data.templates[0]!.id;

      const detail = await client.templates.get(tplId);
      expect(detail.ok).toBe(true);

      const render = await client.templates.render(tplId, { customer_name: 'Antigravity', total: '$50.00' });
      expect(render.ok).toBe(true);
      if (render.ok) {
        expect(render.data.subject).toContain('Antigravity');
        expect(render.data.html).toContain('$50.00');
      }

      const testTpl = await client.templates.test(tplId, { to: 'test@example.com' });
      expect(testTpl.ok).toBe(true);
    }

    // 5. Suppressions
    const testAddr = `optout-${Date.now()}@testcorp.com`;
    const addSup = await client.suppressions.add(testAddr, 'unsubscribe');
    expect(addSup.ok).toBe(true);
    if (addSup.ok) {
      expect(addSup.data.address).toBe(testAddr);
      expect(addSup.data.already).toBe(false);
    }

    const listSup = await client.suppressions.list({ q: testAddr });
    expect(listSup.ok).toBe(true);
    if (listSup.ok) {
      expect(listSup.data.suppressions.some((s) => s.address === testAddr)).toBe(true);
    }

    // 6. Keys & Governance
    const keys = await client.keys.list();
    expect(keys.ok).toBe(true);
    if (keys.ok) {
      expect(keys.data.keys[0]!.name).toBe('Production Worker Key');
    }

    const approvals = await client.keys.approvals();
    expect(approvals.ok).toBe(true);
    if (approvals.ok) {
      expect(approvals.data.pending.length).toBe(1);
      expect(approvals.data.pending[0]!.requestedBy).toBe('agent_claude_3');
    }

    // 7. Support & Team & Tools
    const tickets = await client.support.tickets();
    expect(tickets.ok).toBe(true);
    if (tickets.ok) {
      expect(tickets.data.tickets.length).toBe(1);
    }

    const ticketDetail = await client.support.ticket('tkt_123');
    expect(ticketDetail.ok).toBe(true);

    const team = await client.team.get();
    expect(team.ok).toBe(true);
    if (team.ok) {
      expect(team.data.members.length).toBe(2);
    }

    const tools = await client.tools.list();
    expect(tools.ok).toBe(true);
    if (tools.ok) {
      expect(tools.data.tools.length).toBe(2);
    }

    const toolCheck = await client.tools.check('dns_inspector', 'onboarding.sadasend.com');
    expect(toolCheck.ok).toBe(true);

    // 8. Webhooks
    const webhooks = await client.webhooks.list();
    expect(webhooks.ok).toBe(true);
    if (webhooks.ok) {
      expect(webhooks.data.webhooks.length).toBe(1);
      const deliveries = await client.webhooks.deliveries(webhooks.data.webhooks[0]!.id);
      expect(deliveries.ok).toBe(true);
      if (deliveries.ok) {
        expect(deliveries.data.deliveries.length).toBe(1);
      }
    }

    // 9. Inbound Routing, Messages, Parsing & Simulation
    const inbRoutes = await client.inbound.routes.list();
    expect(inbRoutes.ok).toBe(true);
    if (inbRoutes.ok) {
      expect(inbRoutes.data.routes.length).toBe(1);
      expect(inbRoutes.data.routes[0]!.pattern).toBe('*@inbound.sadasend.com');
    }

    const createdRoute = await client.inbound.routes.create({
      pattern: 'support@inbound.sadasend.com',
      targetUrl: 'https://webhook.site/support',
      priority: 20,
      description: 'Support queue',
    });
    expect(createdRoute.ok).toBe(true);
    if (createdRoute.ok) {
      expect(createdRoute.data.route.pattern).toBe('support@inbound.sadasend.com');
    }

    const fetchedRoute = await client.inbound.routes.get('rt_live_1');
    expect(fetchedRoute.ok).toBe(true);

    const patchedRoute = await client.inbound.routes.update('rt_live_1', { enabled: false });
    expect(patchedRoute.ok).toBe(true);
    if (patchedRoute.ok) {
      expect(patchedRoute.data.route.enabled).toBe(false);
    }

    const deletedRoute = await client.inbound.routes.delete('rt_live_1');
    expect(deletedRoute.ok).toBe(true);
    if (deletedRoute.ok) {
      expect(deletedRoute.data.deleted).toBe(true);
    }

    const inboundMsgs = await client.inbound.messages.list({ limit: 10 });
    expect(inboundMsgs.ok).toBe(true);
    if (inboundMsgs.ok) {
      expect(inboundMsgs.data.messages.length).toBe(1);
    }

    const singleInbMsg = await client.inbound.messages.get('in_msg_100');
    expect(singleInbMsg.ok).toBe(true);

    const parseResult = await client.inbound.parse({
      from: 'sender@client.com',
      to: ['support@inbound.sadasend.com'],
      subject: 'Inbound report',
      text: 'Please review our invoice',
    });
    expect(parseResult.ok).toBe(true);
    if (parseResult.ok) {
      expect(parseResult.data.quarantined).toBe(false);
      expect(parseResult.data.content.cleanMarkdown).toContain('Please review our invoice');
      expect(parseResult.data.security.riskLevel).toBe('clean');
    }

    const simResult = await client.inbound.simulate('support@inbound.sadasend.com');
    expect(simResult.ok).toBe(true);
    if (simResult.ok) {
      expect(simResult.data.matched).toBe(true);
      expect(simResult.data.targetUrl).toBe('https://webhook.site/inbound');
    }

    // 10. DMARC Reports, Summary & Threats
    const dmarcList = await client.dmarc.reports.list({ domain: 'onboarding.sadasend.com' });
    expect(dmarcList.ok).toBe(true);
    if (dmarcList.ok) {
      expect(dmarcList.data.reports.length).toBe(1);
      expect(dmarcList.data.reports[0]!.passRate).toBeGreaterThan(0.99);
    }

    const dmarcUpload = await client.dmarc.reports.create('<feedback></feedback>');
    expect(dmarcUpload.ok).toBe(true);
    if (dmarcUpload.ok) {
      expect(dmarcUpload.data.id).toBe('rep_wire_uploaded');
    }

    const dmarcReport = await client.dmarc.reports.get('rep_wire_1');
    expect(dmarcReport.ok).toBe(true);

    const dmarcSummary = await client.dmarc.summary('onboarding.sadasend.com');
    expect(dmarcSummary.ok).toBe(true);
    if (dmarcSummary.ok) {
      expect(dmarcSummary.data.currentPolicy).toBe('reject');
      expect(dmarcSummary.data.dkimAlignmentPct).toBeGreaterThan(99);
    }

    const dmarcThreats = await client.dmarc.threats();
    expect(dmarcThreats.ok).toBe(true);
    if (dmarcThreats.ok) {
      expect(dmarcThreats.data.threats.length).toBe(1);
      expect(dmarcThreats.data.threats[0]!.ip).toBe('198.51.100.42');
    }

    // 11. Multi-Agent Arbitration & Cooldowns
    const arbStats = await client.arbiter.stats();
    expect(arbStats.ok).toBe(true);
    if (arbStats.ok) {
      expect(arbStats.data.collisionsPrevented).toBe(37);
    }

    const cdSet = await client.arbiter.cooldowns.set('lead@enterprise.com', 86400, 'Agent outreach');
    expect(cdSet.ok).toBe(true);
    if (cdSet.ok) {
      expect(cdSet.data.recipient).toBe('lead@enterprise.com');
      expect(cdSet.data.cooldown).toBe(true);
    }

    const cdStatus = await client.arbiter.cooldowns.status('lead@enterprise.com');
    expect(cdStatus.ok).toBe(true);

    const cdClear = await client.arbiter.cooldowns.clear('lead@enterprise.com');
    expect(cdClear.ok).toBe(true);
    if (cdClear.ok) {
      expect(cdClear.data.cleared).toBe(true);
    }

    const tktCreate = await client.arbiter.tickets.create('lead@enterprise.com', 'Human ticket open');
    expect(tktCreate.ok).toBe(true);
    if (tktCreate.ok) {
      expect(tktCreate.data.ticketId).toBe('tkt_arbiter_wire_1');
    }

    const tktDelete = await client.arbiter.tickets.delete('lead@enterprise.com');
    expect(tktDelete.ok).toBe(true);
    if (tktDelete.ok) {
      expect(tktDelete.data.resolved).toBe(true);
    }

    // 12. Ephemeral Inboxes
    const inbList = await client.inboxes.list();
    expect(inbList.ok).toBe(true);
    if (inbList.ok) {
      expect(inbList.data.inboxes.length).toBe(1);
    }

    const inbCreate = await client.inboxes.create({ alias: 'wire-agent', ttlSeconds: 1800 });
    expect(inbCreate.ok).toBe(true);

    const inbCreateEph = await client.inboxes.createEphemeral({ alias: 'wire-eph', ttlSeconds: 900 });
    expect(inbCreateEph.ok).toBe(true);

    const inbGet = await client.inboxes.get('inb_wire_1');
    expect(inbGet.ok).toBe(true);

    const inbOtp = await client.inboxes.otp('inb_wire_1', { waitFor: true, timeoutMs: 5000 });
    expect(inbOtp.ok).toBe(true);
    if (inbOtp.ok) {
      expect(inbOtp.data.code).toBe('654321');
    }

    const ephemeralMsgs = await client.inboxes.messages('inb_wire_1');
    expect(ephemeralMsgs.ok).toBe(true);
    if (ephemeralMsgs.ok) {
      expect(ephemeralMsgs.data.messages.length).toBe(1);
    }

    const inbStream = await client.inboxes.stream('inb_wire_1');
    expect(inbStream.ok).toBe(true);
    if (inbStream.ok) {
      expect(inbStream.data.url).toContain('/inboxes/inb_wire_1/stream');
    }

    const inbInbound = await client.inboxes.inbound({
      to: 'e2e-agent@auth.sadasend.com',
      subject: 'Security Code',
      text: 'Your code is 654321',
    });
    expect(inbInbound.ok).toBe(true);

    const inbDelete = await client.inboxes.delete('inb_wire_1');
    expect(inbDelete.ok).toBe(true);
    if (inbDelete.ok) {
      expect(inbDelete.data.deleted).toBe(true);
    }

    // 13. Testing Inbound & Wait For Code
    const testInb = await client.testing.inbound({
      to: 'test-qa@auth.sadasend.com',
      subject: 'Verification',
      text: 'Your security code: 772211',
    });
    expect(testInb.ok).toBe(true);
    if (testInb.ok) {
      expect(testInb.data.id).toBe('tst_wire_inbound_1');
    }

    const testWait = await client.testing.waitForCode({
      to: 'test-qa@auth.sadasend.com',
      timeoutMs: 5000,
    });
    expect(testWait.ok).toBe(true);
    if (testWait.ok) {
      expect(testWait.data.code).toBe('772211');
    }

    const testCode = await client.testing.inboxes.code('test-qa@auth.sadasend.com');
    expect(testCode.ok).toBe(true);
    if (testCode.ok) {
      expect(testCode.data.code).toBe('772211');
    }

    const testLatest = await client.testing.inboxes.latest('test-qa@auth.sadasend.com');
    expect(testLatest.ok).toBe(true);

    // 14. Integrations
    const slackIntegration = await client.integrations.slack();
    expect(slackIntegration.ok).toBe(true);
    if (slackIntegration.ok) {
      expect(slackIntegration.data.connected).toBe(true);
      expect(slackIntegration.data.integration?.channel).toBe('slack');
    }

    // 15. Structured Provenance and Hold Type Send
    const provSend = await client.emails.send({
      from: 'noreply@onboarding.sadasend.com',
      to: 'recipient@example.com',
      subject: 'Provenance & HoldType Wire Test',
      text: 'Testing provenance metadata over real wire',
      provenance: {
        channel: 'agent',
        source: 'workflow',
        agentName: 'approval-agent',
        priority: 'alert',
      },
    });
    expect(provSend.ok).toBe(true);
    if (provSend.ok) {
      expect(provSend.status).toBe('pending_approval');
      expect(provSend.holdType).toBe('security');

      const heldGet = await client.emails.get(provSend.id);
      expect(heldGet.ok).toBe(true);
      if (heldGet.ok) {
        expect(heldGet.data.holdType).toBe('security');
        expect(heldGet.data.provenance?.agentName).toBe('approval-agent');
        expect(heldGet.data.provenance?.priority).toBe('alert');
      }
    }

    // 16. Agent Arbitration & Loop Breaker Wire Controls
    const safetySend = await client.emails.send({
      from: 'noreply@onboarding.sadasend.com',
      to: 'recipient@example.com',
      subject: 'Loop Breaker & Cooldown Wire Test',
      text: 'Testing allowDuplicate and crossAgentCooldown over real wire',
      allowDuplicate: true,
      dlp: false,
      crossAgentCooldown: '12h',
      priority: 'critical',
      ticketAware: true,
    });
    expect(safetySend.ok).toBe(true);
    if (safetySend.ok) {
      expect(safetySend.id).toMatch(/^msg_/);
      const msgGet = await client.emails.get(safetySend.id);
      expect(msgGet.ok).toBe(true);
    }
  });

  test('Real wire retry on 503 recovery carries identical Idempotency-Key', async () => {
    state.flakyAttempts = 0;
    const client = new SadaSend(TEST_KEY, {
      baseUrl,
      retry: { baseDelayMs: 10, maxRetries: 3 },
    });

    const res = await client.emails.send({
      from: 'noreply@onboarding.sadasend.com',
      to: 'recipient@example.com',
      subject: 'Flaky wire test',
      text: 'Retried message',
      headers: { 'x-simulate': 'flaky-500' },
      idempotencyKey: 'flaky-wire-key-12345',
    });
    expect(res.ok).toBe(true);
    expect(state.flakyAttempts).toBe(2);

    // Verify both attempts sent the exact same idempotency key over HTTP
    const seen = state.idempotencyKeysSeen.filter((k) => k === 'flaky-wire-key-12345');
    expect(seen.length).toBe(2);
  });

  test('Real wire rate limit 429 retries successfully when Retry-After is supplied', async () => {
    state.rateLimitAttempts = 0;
    const client = new SadaSend(TEST_KEY, {
      baseUrl,
      retry: { baseDelayMs: 10, maxRetries: 3 },
    });

    const res = await client.emails.send({
      from: 'noreply@onboarding.sadasend.com',
      to: 'recipient@example.com',
      subject: 'Rate limit test',
      text: 'Throttled message',
      headers: { 'x-simulate': 'rate-limited' },
      idempotencyKey: 'rate-limit-test-key-54321',
    });
    expect(res.ok).toBe(true);
    expect(state.rateLimitAttempts).toBe(2);
  });

  test('Type-safe discriminated error mapping over the wire', async () => {
    const client = new SadaSend(TEST_KEY, { baseUrl, retry: { maxRetries: 0 } });

    // 401 invalid key
    const badKeyClient = new SadaSend('sada_live_sk_invalid_bad_key', { baseUrl, retry: { maxRetries: 0 } });
    const err401 = await badKeyClient.account.get();
    expect(err401.ok).toBe(false);
    if (!err401.ok) {
      expect(err401.error).toBeInstanceOf(AuthenticationError);
      expect(err401.error.code).toBe('invalid_api_key');
    }

    // 403 recipient not allowlisted
    const errAllow = await client.emails.send({
      from: 'noreply@onboarding.sadasend.com',
      to: 'outsider@evil.com',
      subject: 'Allowlist test',
      text: 'Forbidden',
      headers: { 'x-simulate': 'allowlist' },
    });
    expect(errAllow.ok).toBe(false);
    if (!errAllow.ok) {
      expect(errAllow.error).toBeInstanceOf(RecipientNotAllowlistedError);
      expect((errAllow.error as RecipientNotAllowlistedError).allowlist).toEqual(['@allowed.example']);
    }

    // 403 domain unverified
    const errDomain = await client.emails.send({
      from: 'noreply@unverified.com',
      to: 'recipient@example.com',
      subject: 'Unverified test',
      text: 'Unverified',
      headers: { 'x-simulate': 'domain-unverified' },
    });
    expect(errDomain.ok).toBe(false);
    if (!errDomain.ok) {
      expect(errDomain.error).toBeInstanceOf(DomainNotVerifiedError);
      expect((errDomain.error as DomainNotVerifiedError).records.length).toBe(1);
    }

    // 403 recipient suppressed
    const errSup = await client.emails.send({
      from: 'noreply@onboarding.sadasend.com',
      to: 'optout@example.com',
      subject: 'Suppressed test',
      text: 'Suppressed',
      headers: { 'x-simulate': 'suppressed' },
    });
    expect(errSup.ok).toBe(false);
    if (!errSup.ok) {
      expect(errSup.error).toBeInstanceOf(RecipientSuppressedError);
      expect((errSup.error as RecipientSuppressedError).reason).toBe('unsubscribe');
    }

    // 403 insufficient scope
    const errScope = await client.emails.send({
      from: 'noreply@onboarding.sadasend.com',
      to: 'recipient@example.com',
      subject: 'Scope test',
      text: 'No scope',
      headers: { 'x-simulate': 'scope' },
    });
    expect(errScope.ok).toBe(false);
    if (!errScope.ok) {
      expect(errScope.error).toBeInstanceOf(InsufficientScopeError);
    }
  });

  test('Unreachable server throws ConnectionError with attempt count', async () => {
    const deadClient = new SadaSend('sada_live_sk_dead', {
      baseUrl: 'http://127.0.0.1:59999', // Closed port
      retry: { baseDelayMs: 5, maxRetries: 1 },
      timeoutMs: 500,
    });

    try {
      await deadClient.account.get();
      expect(true).toBe(false); // Should not reach
    } catch (err: any) {
      expect(err).toBeInstanceOf(ConnectionError);
      expect(err.attempts).toBe(2);
    }
  });

  test('Deliverability shield, tools verification, and UTM builder execute end-to-end', async () => {
    const client = new SadaSend(TEST_KEY, { baseUrl });

    // Single verification
    const single = await client.tools.verify('verified@example.com');
    expect(single.ok).toBe(true);
    if (single.ok) {
      expect(single.data.status).toBe('deliverable');
      expect(single.data.verdict).toBe('pass');
      expect(single.data.score).toBe(98);
    }

    // Batch verification
    const batch = await client.tools.verifyBatch(['ok@example.com', 'bad@fake.test']);
    expect(batch.ok).toBe(true);
    if (batch.ok) {
      expect(batch.data.total).toBe(2);
      expect(batch.data.deliverable).toBe(1);
      expect(batch.data.undeliverable).toBe(1);
    }

    // UTM builder
    const utm = await client.tools.buildUtm({
      url: 'https://example.com/pricing',
      source: 'newsletter',
      medium: 'email',
      campaign: 'q4_launch',
    });
    expect(utm.ok).toBe(true);
    if (utm.ok) {
      expect(utm.data.tagged).toContain('utm_source=newsletter');
      expect(utm.data.tagged).toContain('utm_campaign=q4_launch');
      expect(utm.data.params.utm_source).toBe('newsletter');
    }

    // Deliverability shield in emails.send()
    const shieldedBad = await client.emails.send({
      from: 'noreply@onboarding.sadasend.com',
      to: 'undeliverable@fake.test',
      subject: 'Shield Test',
      text: 'Shield',
      verifyBeforeSend: true,
    });
    expect(shieldedBad.ok).toBe(false);
    if (!shieldedBad.ok) {
      expect(shieldedBad.error).toBeInstanceOf(UndeliverableRecipientError);
      expect((shieldedBad.error as UndeliverableRecipientError).recipient).toBe('undeliverable@fake.test');
    }
  });

  test('Standalone live-e2e.ts script executes end-to-end with 100% pass', async () => {
    const proc = Bun.spawn(['bun', 'run', 'examples/live-e2e.ts'], {
      cwd: '.',
      env: {
        ...process.env,
        SADASEND_BASE_URL: baseUrl,
        SADASEND_API_KEY: TEST_KEY,
        TEST_RECIPIENT: 'verified-e2e@example.com',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      console.error('live-e2e.ts stdout:', stdout);
      console.error('live-e2e.ts stderr:', stderr);
    }

    expect(exitCode).toBe(0);
    expect(stdout).toContain('25 PASSED');
    expect(stdout).toContain('0 FAILED');
    expect(stdout).toContain('All TypeScript SDK operations verified and 100% operational!');
    expect(stdout).not.toContain('FAIL:');
  });

  test('Standalone full-features.ts walkthrough executes end-to-end successfully', async () => {
    const proc = Bun.spawn(['bun', 'run', 'examples/full-features.ts'], {
      cwd: '.',
      env: {
        ...process.env,
        SADASEND_BASE_URL: baseUrl,
        SADASEND_API_KEY: TEST_KEY,
        TEST_RECIPIENT: 'verified-e2e@example.com',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      console.error('full-features.ts stdout:', stdout);
      console.error('full-features.ts stderr:', stderr);
    }

    expect(exitCode).toBe(0);
    expect(stdout).toContain('SadaSend TypeScript SDK Demo Completed Successfully');
  });
});

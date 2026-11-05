# SadaSend SDK Cheatsheet for AI Agents

All methods on the `SadaSend` client return `{ ok: true, data } | { ok: false, error }`, except `emails.send()` which returns `{ ok: true, id, status, dryRun?, rendered? } | { ok: false, error }`.

---

## 1. Emails

```ts
// Send single email
const res = await sadasend.emails.send({
  from: 'alerts@domain.com',
  to: 'user@example.com',        // string or string[]
  cc?: 'colleague@example.com',
  bcc?: 'audit@example.com',
  replyTo?: 'help@domain.com',
  subject: 'Invoice Ready',
  html?: '<p>HTML body</p>',
  text?: 'Plain text body',
  react?: <WelcomeEmail name="Alice" />, // First-class React Email component
  template?: 'tmpl_123',         // Server-side liquid template
  variables?: { name: 'Alice' },
  tags?: ['finance', 'october'],
  headers?: { 'X-Entity-ID': 'inv_99' },
  attachments?: [{ filename: 'receipt.pdf', content: base64Data, contentType: 'application/pdf' }],
  scheduledAt?: new Date(Date.now() + 3600000), // Future delivery
  verifyBeforeSend?: true,       // Deliverability Shield: validates MX/syntax before send
  marketing?: true,              // RFC 8058 One-Click List-Unsubscribe headers
  utm?: {                        // Standardized UTM campaign tags
    source: 'agent',
    medium: 'email',
    campaign: 'q4_onboarding',
  },
  dryRun?: true,                 // Zero-cost preflight validation
  idempotencyKey?: 'order-1234', // Custom domain key (auto-generated if omitted)
  channel?: 'sdk',
  source?: 'agent',
  agentName: 'finance-bot',
  // Advanced Agent Safety Options (v0.1.2)
  allowDuplicate?: false,        // Enforce anti-loop duplication breaker
  bypassLoopBreaker?: false,     // Emergency manual override
  crossAgentCooldown?: true,     // Respect multi-agent recipient quiet periods
  dlp?: true,                    // Redact sensitive PII / API keys before send
  priority?: 'normal',           // 'low' | 'normal' | 'high' | 'urgent'
  ticketAware?: true,            // Thread message to existing support ticket
});

// Retrieve message status & event trail
const msg = await sadasend.emails.get('msg_123');
// msg.data: { id, to, from, subject, status, at, events: [...] }

// Resend under original key
const resend = await sadasend.emails.resend('msg_123');

// Cancel scheduled message before dispatch
const cancelled = await sadasend.emails.cancel('msg_123');

// List recent emails with filters
const list = await sadasend.emails.list({
  limit: 20,
  agentName: 'finance-bot',
  status: 'delivered', // 'queued' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'pending_approval'
  q: 'invoice',
});

// High-throughput batch sending (RFC 4918 Multi-Status)
const batch = await sadasend.emails.batch([
  { from: 'a@d.com', to: 'u1@d.com', subject: '1', text: 'hi' },
  { from: 'a@d.com', to: 'u2@d.com', subject: '2', text: 'hi' },
]);
// batch.data: { total: 2, accepted: 2, refused: 0, results: [...] }
```

---

## 2. Account Telemetry & Quotas

```ts
const info = await sadasend.account.get();
// info.data: { org, plan, emailsUsed, emailQuota, domainsUsed, domainQuota, reputationLevel }

const stats = await sadasend.account.stats({ window: '14d' });
// stats.data: { sent, delivered, deliveryRate, bounced, bounceRate, complained, complaintRate }

const volume = await sadasend.account.volume({ window: '7d' });
// volume.data: { days: [{ date, sent, delivered, bounced, complained }] }

const checklist = await sadasend.account.checklist();
// checklist.data: { items: [{ key, title, completed }], completed, total }

const breakers = await sadasend.account.circuitBreakers();
// breakers.data: { circuitBreakers: [{ agentIdentifier, agentName, trippedAt, reason }] }
```

---

## 3. Domains & DNS Verification

```ts
const domains = await sadasend.domains.list();
// domains.data: { domains: [{ id, name, status }] }

const records = await sadasend.domains.records(domainId);
// records.data: { records: [{ type, host, value, verdict, note }] }

const verify = await sadasend.domains.verify(domainId);
// verify.data: { id, status: 'verified', verified: true }
```

---

## 4. Templates

```ts
const templates = await sadasend.templates.list();
const template = await sadasend.templates.get('tmpl_123');
const rendered = await sadasend.templates.render('tmpl_123', { customer_name: 'Bob' });
const testSend = await sadasend.templates.test('tmpl_123', { to: 'qa@company.com' });
```

---

## 5. Suppressions

```ts
// Add email to suppression list
const added = await sadasend.suppressions.add('unsub@example.com', 'unsubscribe');
// reasons: 'unsubscribe' | 'complaint' | 'hard_bounce' | 'manual'

// Search suppressions
const found = await sadasend.suppressions.list({ q: 'unsub@example.com' });
```

---

## 6. Approvals & Governance

```ts
// List emails held in Human Approval Queue awaiting sign-off
const approvals = await sadasend.keys.approvals();
// approvals.data: { pending: [{ id, to, subject, requestedBy, at }] }

// List API keys
const keys = await sadasend.keys.list();
```

---

## 7. Deliverability Tools & Verification

```ts
// Real-time single address verification
const verify = await sadasend.tools.verify('user@example.com');
// verify.data: { email, verdict: 'deliverable' | 'undeliverable' | 'risky' | 'unknown', checks: { score, mx, syntax, disposable } }

// Batch recipient verification
const batchVerify = await sadasend.tools.verifyBatch(['u1@example.com', 'u2@fake.test']);
// batchVerify.data: { total: 2, deliverable: 1, undeliverable: 1, results: [...] }

// Normalized UTM URL campaign builder
const utm = await sadasend.tools.buildUtm({
  url: 'https://domain.com/launch#pricing',
  source: 'newsletter',
  medium: 'email',
  campaign: 'q4_launch',
});
// utm.data: { original: 'https://domain.com/launch#pricing', tagged: 'https://domain.com/launch?utm_source=newsletter&utm_medium=email&utm_campaign=q4_launch#pricing', params: { ... } }
```

---

## 8. Inbound MX Routing & Context-Safe Parser

```ts
// List and configure inbound MX routing rules
const routes = await sadasend.inbound.routes.list();
const created = await sadasend.inbound.routes.create({
  pattern: '*@inbound.yourdomain.com',
  targetUrl: 'https://api.yourdomain.com/webhooks/inbound',
  description: 'AI Support Desk Route',
});

// Parse inbound payload with prompt-injection defense
const parsed = await sadasend.inbound.parse({
  subject: 'Re: Inquiry',
  text: 'Hello, please reset my account.\n\n> Quoted text',
});
// parsed.data: { content: { cleanMarkdown, tokensPreserved }, security: { injectionRiskScore, quarantineRecommended } }
```

---

## 9. DMARC Deliverability Radar

```ts
// Query domain alignment scores and policy upgrade recommendations
const dmarcSummary = await sadasend.dmarc.summary('yourdomain.com');
// dmarcSummary.data: { dkimAlignmentPct, spfAlignmentPct, currentPolicy, recommendedPolicy }

// Upload aggregate XML feedback report
const uploaded = await sadasend.dmarc.reports.upload(xmlReportString);
```

---

## 10. Multi-Agent Collision Arbiter

```ts
// Set cooldown to prevent cross-agent recipient spam
await sadasend.arbiter.cooldowns.set('lead@enterprise.com', 86400, 'Sales outreach completed');

// Check recipient collision status
const status = await sadasend.arbiter.cooldowns.status('lead@enterprise.com');
// status.data: { cooldownActive: boolean, remainingSeconds: number }
```

---

## 11. Ephemeral Inboxes & Reactive 2FA OTP Stream

```ts
// Provision temporary mailbox for browser automation agents (Playwright, Puppeteer)
const inbox = await sadasend.inboxes.create({ ttlSeconds: 600, alias: 'agent-auth' });
// inbox.data: { inbox: { id, email, expiresAt } }

// Capture incoming OTP verification code (without polling loops)
const otp = await sadasend.inboxes.otp(inbox.data.inbox.id, { waitFor: true, timeoutMs: 15000 });
// otp.data: { code: '849201', extractedAt: '...' }

// Stream real-time events via native SSE async iterator (<150ms push latency)
const stream = await sadasend.inboxes.stream(inbox.data.inbox.id);
if (stream.ok) {
  for await (const event of stream.data) {
    if (event.event === 'otp') console.log('OTP received:', event.data);
  }
}

// Get absolute stream URL for browsers / webhooks
const streamEndpoint = sadasend.inboxes.streamUrl(inbox.data.inbox.id);
```

---

## 12. E2E Sandbox Testing

```ts
// Simulate inbound email arrival in automated CI tests
await sadasend.testing.inbound({
  to: 'agent@test.sadasend.com',
  from: 'auth@service.com',
  subject: 'Your code',
  text: 'Your verification code is 849201',
});

// Await OTP code verification in test assertions (.code and .otp are aliases)
const code = await sadasend.testing.waitForCode({
  to: 'agent@test.sadasend.com',
  timeoutMs: 5000,
});
// code.data: { code: '849201', otp: '849201' }
```

---

## 13. Webhooks Cryptographic Verification

```ts
import { verifyWebhook, parseWebhook } from 'sadasend/webhooks';

// Timing-safe constant-time WebCrypto HMAC-SHA256 signature evaluation
const isValid = await verifyWebhook(
  process.env.SADASEND_WEBHOOK_SECRET!,
  rawBodyString,
  req.headers.get('sadasend-signature')!
);

const event = await parseWebhook(
  process.env.SADASEND_WEBHOOK_SECRET!,
  rawBodyString,
  req.headers.get('sadasend-signature')!
);
// event: { id, type: 'email.delivered' | 'email.bounced' | 'email.complained', data: { messageId, ... } }
```

---

## 14. First-Class React Email Rendering

```ts
import { renderReactEmail } from 'sadasend';

// Compile JSX / React component to HTML and plain-text dynamically (0 dependencies)
const rendered = await renderReactEmail(<WelcomeEmail user="Sarah" />);
// rendered: { html: '<h1>Welcome Sarah</h1>...', text: 'Welcome Sarah...' }
```

---

## 15. Official Playwright Drop-in Test Fixtures (`sadasend/playwright`)

```ts
import { test, expect } from 'sadasend/playwright';

test('completes 2FA signup flow without polling', async ({ page, ephemeralInbox }) => {
  await page.goto('https://app.example.com/signup');
  await page.fill('#email', ephemeralInbox.email);
  await page.click('#submit');

  // Sub-150ms zero-polling push via SSE
  const otp = await ephemeralInbox.waitForOtp();
  await page.fill('#otp', otp);
  await expect(page.locator('#dashboard')).toBeVisible();
});
// Ephemeral inboxes are automatically destroyed during test teardown
```

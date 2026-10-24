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
  template?: 'tmpl_123',         // Server-side liquid template
  variables?: { name: 'Alice' },
  tags?: ['billing', 'october'],
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
  agentName?: 'billing-bot',
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
  agentName: 'billing-bot',
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
// utm.data: { url: 'https://domain.com/launch?utm_source=newsletter&utm_medium=email&utm_campaign=q4_launch#pricing', params: { ... } }
```

---

## 8. Billing & Prepaid Credit Packs

```ts
// Initialize one-time Paddle checkout for credit packs
const checkout = await sadasend.billing.creditsCheckout({
  type: 'verify', // 'verify' | 'send'
  pack: '25k',    // '5k' | '25k' | '100k' | '500k' for verify; '10k' | '50k' | '100k' for send
  returnUrl: 'https://domain.com/dashboard/billing',
});
// checkout.data: { checkoutUrl: 'https://checkout.paddle.com/...', transactionId: '...', pack: '25k', credits: 25000 }
```

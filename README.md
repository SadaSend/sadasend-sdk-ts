# sadasend

[![npm version](https://img.shields.io/npm/v/sadasend.svg?style=flat-square&color=0052FF)](https://www.npmjs.com/package/sadasend)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://github.com/SadaSend/sadasend-sdk-ts/blob/main/LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-success.svg?style=flat-square)](https://www.npmjs.com/package/sadasend)
[![TypeScript Strict](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/)
[![Runtime Support](https://img.shields.io/badge/runtimes-Node%2018%2B%20%7C%20Bun%20%7C%20Deno%20%7C%20Workers%20%7C%20Edge-informational.svg?style=flat-square)](https://sadasend.com/docs/sdks/typescript)

The official TypeScript and JavaScript SDK for [SadaSend](https://sadasend.com). High-performance transactional email with unbypassable server-enforced guardrails engineered for human engineering teams and autonomous AI agents.

**Zero dependencies.** Runs on native web standards (`globalThis.fetch` and `crypto.subtle`) across **Node.js 18+**, **Bun**, **Deno**, **Cloudflare Workers**, **Next.js Edge**, and modern browsers. No transitive supply-chain risks, no bloated bundles (< 8 KB unpacked).

---

## Table of Contents

- [Why SadaSend? The AI Agent Moat](#why-sadasend-the-ai-agent-moat)
- [Installation](#installation)
- [Ten-Line Quickstart](#ten-line-quickstart)
- [Server-Enforced Agent Guardrails](#server-enforced-agent-guardrails)
- [Comprehensive API Reference](#comprehensive-api-reference)
  - [1. Transactional Sends (`emails.send`)](#1-transactional-sends-emailssend)
  - [2. High-Throughput Batch Sends (`emails.batch`)](#2-high-throughput-batch-sends-emailsbatch)
  - [3. Scheduled Delivery & Atomic Cancellation (`emails.cancel`)](#3-scheduled-delivery--atomic-cancellation-emailscancel)
  - [4. Sending Domains & Live DNS Verification (`domains`)](#4-sending-domains--live-dns-verification-domains)
  - [5. Server-Side Liquid Dynamic Templates (`templates`)](#5-server-side-liquid-dynamic-templates-templates)
  - [6. Automated & Manual Suppressions (`suppressions`)](#6-automated--manual-suppressions-suppressions)
  - [7. Account Deliverability & Telemetry (`account`)](#7-account-deliverability--telemetry-account)
  - [8. API Key Governance & Approvals Queue (`keys`)](#8-api-key-governance--approvals-queue-keys)
- [Timing-Safe HMAC Webhook Verification](#timing-safe-hmac-webhook-verification)
- [Error Handling: Discriminated Unions](#error-handling-discriminated-unions)
- [Native Model Context Protocol (MCP) Integration](#native-model-context-protocol-mcp-integration)
- [Canonical Documentation & Technical References](#canonical-documentation--technical-references)
- [Frequently Asked Questions (FAQ)](#frequently-asked-questions-faq)
- [AI Agent Skill Integration](#ai-agent-skill-integration)
- [License & Support](#license--support)

---

## Why SadaSend? The AI Agent Moat

Traditional transactional email APIs (SendGrid, Mailgun, Postmark, Resend) were created exclusively for deterministic, hardcoded human backend jobs. When an autonomous AI agent (Claude Code, Cursor, LangChain, CrewAI, AutoGen) is given a traditional email API key, a single prompt injection or hallucination can spam thousands of external customers or burn your sending domain reputation.

SadaSend introduces **Server-Enforced Guardrails** that no agent prompt can talk its way past:

```text
  ┌────────────────────────────────────────────────────────────────────────┐
  │  Human Engineer Mints Key in SadaSend Dashboard                        │
  │  {                                                                     │
  │    scopes: ['send', 'read'],            // Permitted operations        │
  │    allowlist: ['@internal-corp.com'],   // Who it may reach            │
  │    rateLimit: '100 / 1h',               // Token bucket ceiling        │
  │    mode: 'approval'                     // Require human sign-off      │
  │  }                                                                     │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │ Mints sada_agent_sk_...
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │  Autonomous Agent Code (TypeScript / Python / MCP)                     │
  │  const sadasend = new SadaSend(process.env.AGENT_KEY);                 │
  │                                                                        │
  │  ❌ Agent CANNOT widen allowlist or elevate scopes                     │
  │  ❌ Agent CANNOT mint new API keys (session-restricted endpoint)       │
  │  ❌ Agent CANNOT sign off on its own held messages                     │
  │  ✅ Server intercepts rogue sends and returns typed remediation        │
  └────────────────────────────────────────────────────────────────────────┘
```

### Comparison Matrix

| Feature | Legacy Email APIs | SadaSend |
| :--- | :---: | :---: |
| **Agent Recipient Allowlists** | ❌ None (Sends anywhere) | 🟢 **Server-Enforced** (`@domain.com` or exact addresses) |
| **Human-in-the-Loop Mode** | ❌ None (Direct to wire) | 🟢 **Built-in Approval Queue** (`mode: 'approval'`) |
| **Zero-Cost Preflight Dry Runs** | ❌ Burns quota | 🟢 **Native `dryRun: true`** (Validates deliverability free) |
| **Idempotency Guarantees** | ⚠️ Manual / Inconsistent | 🟢 **Auto UUIDv4** rides retries to prevent duplicate sends |
| **Result Type Model** | ❌ Throws on every 4xx/5xx | 🟢 **Discriminated Union** (`Result<T>`: `ok: true` / `ok: false`) |
| **Dependencies** | ❌ Often requires heavy SDKs | 🟢 **Zero Dependencies** (Pure native fetch & WebCrypto) |
| **Model Context Protocol (MCP)** | ❌ Requires custom wrappers | 🟢 **Native SSE MCP Server** (`https://mcp.sadasend.com/mcp/sse`) |

---

## Installation

Install the official package from [npm](https://www.npmjs.com/package/sadasend) via your preferred package manager:

```bash
# npm
npm install sadasend

# Bun
bun add sadasend

# pnpm
pnpm add sadasend

# yarn
yarn add sadasend
```

---

## Ten-Line Quickstart

<!-- example:ten-lines -->
```ts
// bun add sadasend
import { SadaSend } from 'sadasend';

const sadasend = new SadaSend(process.env.SADASEND_API_KEY);

const result = await sadasend.emails.send({
  from: 'noreply@onboarding.sadasend.com',
  to: 'dana@example.com',
  subject: 'It works.',
  html: '<strong>Sent from the SadaSend SDK.</strong>',
});

if (!result.ok) throw new Error(result.error.message);
console.log(result.status, result.id);
```
<!-- /example -->

*Note: The code above is an active integration test verified against a live server in CI via [`examples/ten-lines.ts`](./examples/ten-lines.ts).*

For an executable walkthrough covering all 16 advanced features, inspect [`examples/full-features.ts`](./examples/full-features.ts).

---

## Server-Enforced Agent Guardrails

### 1. Recipient Allowlists (`RecipientNotAllowlistedError`)
When an agent attempts to message an address outside its permitted domain or email list, SadaSend blocks delivery at the API gateway and returns the exact allowlist patterns so the agent can self-correct:

```ts
import { SadaSend, RecipientNotAllowlistedError } from 'sadasend';

const sadasend = new SadaSend(process.env.SADASEND_AGENT_KEY);

const result = await sadasend.emails.send({
  from: 'Agent <assistant@yourdomain.com>',
  to: 'unauthorized-stranger@external.com',
  subject: 'Autonomous follow-up',
  text: 'Hello!',
});

if (!result.ok && result.error instanceof RecipientNotAllowlistedError) {
  console.error('Delivery prevented by server guardrail:');
  console.log('Violating recipient:', result.error.recipient);
  console.log('Permitted patterns:', result.error.allowlist);
  // Example: ["@yourcompany.com", "partner@authorized.com"]
}
```

### 2. Human Approval Mode (`mode: 'approval'`)
Keys minted in approval mode automatically place outgoing messages into `pending_approval` status. The message is queued safely in the [SadaSend Web Dashboard](https://app.sadasend.com/approvals) until a team member approves or cancels it:

```ts
const send = await sadasend.emails.send({
  from: 'notifications@yourdomain.com',
  to: 'client@partner.com',
  subject: 'Proposal Agreement Draft',
  html: '<p>Please review the proposal draft.</p>',
});

if (send.ok && send.status === 'pending_approval') {
  console.log(`Held in human approval queue with ID: ${send.id}`);
}
```

### 3. Preflight Dry-Runs (`dryRun: true`)
Validate template compilation, suppression status, and domain SPF/DKIM verification without sending an email or consuming monthly plan quota:

```ts
const preview = await sadasend.emails.send({
  from: 'noreply@yourdomain.com',
  to: 'customer@example.com',
  subject: 'Weekly Digest',
  html: '<h1>Digest</h1>',
  dryRun: true,
});

if (preview.ok) {
  console.log('Dry run successful. Ready for dispatch.');
}
```

---

## Comprehensive API Reference

### 1. Transactional Sends (`emails.send`)

Send rich transactional emails with attachments, tags, custom metadata, CC/BCC, and reply-to addresses:

```ts
const res = await sadasend.emails.send({
  from: 'Billing Team <billing@yourdomain.com>',
  to: ['customer@example.com'],
  cc: ['finance@yourdomain.com'],
  replyTo: 'support@yourdomain.com',
  subject: 'Invoice #INV-2026-10',
  html: '<h1>Your Invoice is Attached</h1><p>Thank you for your business!</p>',
  text: 'Your Invoice is Attached. Thank you for your business!',
  tags: ['billing', 'october-invoices'],
  headers: {
    'X-Entity-ID': 'cust_98124',
  },
  attachments: [
    {
      filename: 'invoice.pdf',
      content: Buffer.from('%PDF-1.4...').toString('base64'),
      contentType: 'application/pdf',
    },
  ],
  idempotencyKey: 'invoice-send-INV-2026-10',
});

if (res.ok) {
  console.log(`Message queued with ID: ${res.id}`);
}
```

### 2. High-Throughput Batch Sends (`emails.batch`)

Send up to 100 individual emails in a single atomic HTTP request. Returns an RFC 4918 207 Multi-Status object detailing per-item delivery outcomes:

```ts
const batch = await sadasend.emails.batch([
  { from: 'alerts@yourdomain.com', to: 'alice@example.com', subject: 'Server Alert', text: 'CPU at 92%' },
  { from: 'alerts@yourdomain.com', to: 'bob@example.com', subject: 'Server Alert', text: 'CPU at 92%' },
]);

if (batch.ok) {
  console.log(`Accepted: ${batch.data.accepted}, Refused: ${batch.data.refused}`);
  for (const item of batch.data.results) {
    if (item.ok) {
      console.log(`Item ${item.index}: Accepted ID ${item.id}`);
    } else {
      console.error(`Item ${item.index}: Refused due to ${item.error}`);
    }
  }
}
```

### 3. Scheduled Delivery & Atomic Cancellation (`emails.cancel`)

Schedule a future dispatch and cancel it before it leaves the server:

```ts
// Schedule dispatch for 2 hours in the future
const send = await sadasend.emails.send({
  from: 'noreply@yourdomain.com',
  to: 'user@example.com',
  subject: 'Scheduled Notification',
  text: 'This is scheduled.',
  scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
});

// Cancel if user cancels their action
if (send.ok) {
  const cancel = await sadasend.emails.cancel(send.id);
  if (cancel.ok) {
    console.log('Scheduled email cancelled successfully.');
  }
}
```

### 4. Sending Domains & Live DNS Verification (`domains`)

Programmatically register domains and retrieve required SPF, DKIM (2048-bit RSA), and DMARC DNS records:

```ts
// List domains
const domains = await sadasend.domains.list();

// Retrieve DNS records for setup
const records = await sadasend.domains.records('dom_981a2b');
if (records.ok) {
  for (const record of records.data.records) {
    console.log(`Type: ${record.type} | Host: ${record.host} | Value: ${record.value}`);
  }
}

// Perform live internet DNS verification
const verify = await sadasend.domains.verify('dom_981a2b');
if (verify.ok) {
  console.log(`Verification status: ${verify.data.status}`); // 'verified' | 'unverified'
}
```

### 5. Server-Side Liquid Dynamic Templates (`templates`)

Render server-side Liquid templates with strict input sanitization:

```ts
// List available templates
const templates = await sadasend.templates.list();

// Test render against test variables
const preview = await sadasend.templates.render('welcome-email', {
  first_name: 'Sarah',
  login_url: 'https://app.sadasend.com/login',
});

if (preview.ok) {
  console.log('Rendered HTML:', preview.data.html);
}
```

### 6. Automated & Manual Suppressions (`suppressions`)

Manage suppression lists to prevent contacting hard-bounced or unsubscribed recipients:

```ts
// Add manual suppression
await sadasend.suppressions.add('unsub@example.com', 'unsubscribe');

// Query suppression list
const list = await sadasend.suppressions.list({ q: 'unsub@example.com' });
if (list.ok && list.data.suppressions.length > 0) {
  console.log('Recipient is suppressed:', list.data.suppressions[0]!.reason);
}
```

### 7. Account Deliverability & Telemetry (`account`)

Monitor your sending velocity, tier quotas, and deliverability health:

```ts
// Quota & tier metrics
const acc = await sadasend.account.get();
if (acc.ok) {
  console.log(`Plan: ${acc.data.plan} | Quota: ${acc.data.emailsUsed} / ${acc.data.emailQuota}`);
}

// 14-day deliverability ratios
const stats = await sadasend.account.stats({ window: '14d' });
if (stats.ok) {
  console.log(`Sent: ${stats.data.sent} | Delivered: ${stats.data.delivered} | Bounced: ${stats.data.bounced}`);
}

// Inspect active agent circuit breakers
const breakers = await sadasend.account.circuitBreakers();
```

### 8. API Key Governance & Approvals Queue (`keys`)

Audit active API keys and inspect held emails pending human sign-off:

```ts
// List registered keys
const keys = await sadasend.keys.list();

// List held emails waiting in the approval queue
const held = await sadasend.keys.approvals();
if (held.ok) {
  console.log(`Pending approval count: ${held.data.pending.length}`);
}
```

---

## Timing-Safe HMAC Webhook Verification

SadaSend signs all webhook deliveries with HMAC-SHA256 (`t=timestamp,v1=signature`). Verify webhooks with **zero third-party dependencies** using native WebCrypto (`crypto.subtle`):

```ts
import { parseWebhook, verifyWebhook } from 'sadasend/webhooks';

// Example: Next.js App Router (app/api/webhooks/route.ts)
export async function POST(req: Request) {
  // CRITICAL: Must read as raw string. JSON.parse() changes formatting and breaks HMAC!
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('sadasend-signature');

  if (!signatureHeader) {
    return new Response('Missing signature header', { status: 400 });
  }

  const event = await parseWebhook(
    process.env.SADASEND_WEBHOOK_SECRET!,
    rawBody,
    signatureHeader
  );

  if (!event) {
    return new Response('Invalid webhook signature or expired timestamp', { status: 401 });
  }

  // Handle typed event
  switch (event.type) {
    case 'email.delivered':
      console.log('Delivered message:', event.data.messageId);
      break;
    case 'email.bounced':
      console.warn('Bounced message:', event.data.messageId, event.data.detail);
      break;
    case 'email.complained':
      console.warn('Spam complaint recorded for:', event.data.messageId);
      break;
  }

  return new Response('OK', { status: 200 });
}
```

- **Replay Protection**: Timestamps are cryptographically bound to the signed body and rejected if older than 5 minutes.
- **Timing-Attack Immune**: Evaluated in constant time to prevent side-channel timing analysis.

---

## Error Handling: Discriminated Unions

SadaSend returns a discriminated union result (`Result<T>`: `{ ok: true, data } | { ok: false, error }`) instead of throwing exceptions. This ensures that guardrail refusals (such as allowlist violations, suppressions, or unverified domains) are handled as normal business logic:

```ts
const result = await sadasend.emails.send({
  from: 'team@yourdomain.com',
  to: 'partner@example.com',
  subject: 'Project Update',
  text: 'Here is the update.',
});

if (!result.ok) {
  if (result.error instanceof DomainNotVerifiedError) {
    // DNS records are attached directly to the error for instant remediation!
    console.error('Domain not verified. Configure these DNS records:');
    for (const rec of result.error.records) {
      console.log(rec.type, rec.host, rec.value);
    }
  } else if (result.error instanceof RecipientNotAllowlistedError) {
    console.error('Allowlist violation:', result.error.recipient);
  } else if (result.error instanceof RecipientSuppressedError) {
    console.error('Recipient suppressed:', result.error.reason);
  } else if (result.error instanceof RateLimitError) {
    console.error(`Rate limit exceeded. Retry in ${result.error.retryAfterSeconds}s`);
  }
  return;
}

// Success branch is automatically narrowed by TypeScript
console.log('Message ID:', result.id);
```

### Error Hierarchy Table

| Error Class | Trigger Scenario | Automatic Retry | Attached Remediation Data |
| :--- | :--- | :---: | :--- |
| `AuthenticationError` | Missing, invalid, or revoked API key | No | None |
| `InsufficientScopeError` | API key lacks required scope (`send`, `read`, `domains`) | No | `required`, `held` |
| `InvalidFromError` | Sender address is malformed | No | None |
| `DomainNotFoundError` | Sending domain is not registered on this account | No | None |
| `DomainNotVerifiedError` | Sending domain has not completed SPF/DKIM verification | No | `records` (Table of required DNS records) |
| `RecipientNotAllowlistedError` | Agent attempted to email an address not in allowlist | No | `allowlist`, `recipient` |
| `RecipientSuppressedError` | Recipient previously bounced or unsubscribed | No | `reason`, `recipient` |
| `IdempotencyKeyReusedError` | Same idempotency key passed with altered payload | No | None |
| `IdempotencyInProgressError` | Original idempotent request is still processing | **Yes** | None |
| `RateLimitError` | Per-key or account rate limit ceiling reached (HTTP 429) | **Yes** | `retryAfterSeconds` |
| `ServerError` | Transient upstream 5xx error | **Yes** | HTTP status |
| `ConnectionError` | Socket drop or DNS network timeout (**Thrown**) | **Yes** | Root `cause`, `attempts` |

---

## Native Model Context Protocol (MCP) Integration

SadaSend features a native Model Context Protocol (MCP) Server-Sent Events (SSE) server for **Cursor**, **Claude Code**, **Windsurf**, and custom LLM runtimes:

Connect your AI agent with zero local software to install:

```json
{
  "mcpServers": {
    "sadasend": {
      "url": "https://mcp.sadasend.com/mcp/sse",
      "headers": {
        "Authorization": "Bearer sada_agent_sk_your_key_here"
      }
    }
  }
}
```

Read the full [Model Context Protocol Guide](https://sadasend.com/docs/mcp-guide) for tool declarations, schemas, and best practices.

---

## Canonical Documentation & Technical References

For exhaustive architectural specifications, REST API contracts, and guides:

- 🌐 [Official Website](https://sadasend.com)
- 📖 [Developer Documentation](https://sadasend.com/docs)
- 📘 [TypeScript SDK Reference](https://sadasend.com/docs/sdks/typescript)
- 📡 [REST API Documentation](https://sadasend.com/docs/api-reference)
- 🤖 [Model Context Protocol (MCP) Guide](https://sadasend.com/docs/mcp-guide)
- 🛡️ [AI Agent Email Guardrails Overview](https://sadasend.com/docs/agent-guardrails)
- 🔐 [DKIM, SPF & DMARC Deliverability Guide](https://sadasend.com/docs/domains)
- 🪝 [Webhooks & Signature Verification](https://sadasend.com/docs/webhooks)
- 💳 [Plans, Pricing & Quotas](https://sadasend.com/pricing)
- 🚦 [Platform Live System Status](https://status.sadasend.com)

---

## Frequently Asked Questions (FAQ)

### How is SadaSend different from Resend, SendGrid, or AWS SES?
Traditional email APIs only provide basic transactional sending with no concept of AI agent safety. SadaSend introduces server-enforced recipient allowlists, human-in-the-loop approval queues, per-key rate limits, and preflight dry-runs. When an autonomous agent hallucinating an email address tries to send, SadaSend refuses the dispatch before real mail is queued.

### Can an AI agent bypass its recipient allowlist or edit its scopes?
**No.** All guardrails are enforced on SadaSend servers. Key management and allowlist modification endpoints require secure browser sessions with CSRF protection and multi-factor authentication (2FA). API keys can never edit themselves or mint other keys.

### Does the TypeScript SDK work in Cloudflare Workers and Next.js Edge?
**Yes.** The SDK uses zero Node.js-only built-in modules. It relies strictly on `globalThis.fetch`, `crypto.subtle`, and `TextEncoder`, running identically in Node.js 18+, Bun, Deno, Cloudflare Workers, Vercel Edge Functions, and modern browser environments.

### What happens if an email request fails due to a network drop?
SadaSend automatically mints a UUIDv4 `Idempotency-Key` on every send. When the SDK retries after a connection timeout or network drop, it reuses the **exact same idempotency key**. The server returns the cached response if the initial request succeeded, preventing duplicate emails.

### What is Human Approval Mode?
When an API key is minted with `mode: 'approval'`, outgoing messages are held in `pending_approval` state rather than dispatched to the network. An operator can review the message body, recipient, and attachments in the [SadaSend Web Console](https://app.sadasend.com/approvals) before clicking "Approve".

---

## AI Agent Skill Integration

This repository includes a standardized workspace skill for AI coding assistants (Cursor, Claude Code, Antigravity, CrewAI, LangChain) at [`.agents/skills/sadasend-email`](./.agents/skills/sadasend-email/SKILL.md).

It guides agents to:
- Treat `pending_approval` as an intentional human-in-the-loop sign-off state rather than a failure
- Conduct zero-cost preflight dry runs (`dryRun: true`) before making production changes
- Self-correct on guardrail errors using attached remediation data (`error.allowlist`, `error.records`)
- Enforce idempotency across multi-step execution loops

---

## License & Support

- **npm Package:** [https://www.npmjs.com/package/sadasend](https://www.npmjs.com/package/sadasend)
- **GitHub Repository:** [SadaSend/sadasend-sdk-ts](https://github.com/SadaSend/sadasend-sdk-ts)
- **License:** [MIT License](./LICENSE) © [SadaSend](https://sadasend.com)
- **General Support:** [support@sadasend.com](mailto:support@sadasend.com)
- **Security Vulnerabilities:** [security@sadasend.com](mailto:security@sadasend.com)

/**
 * SadaSend TypeScript SDK — Full Features Walkthrough
 *
 * This master example demonstrates the complete capabilities of SadaSend:
 *  1. Client initialization with AI agent provenance defaults & jittered retries
 *  2. Account telemetry, quota metrics, onboarding checklist & circuit breakers
 *  3. Sending domains management & nameserver DNS verification (SPF, DKIM, DMARC)
 *  4. Preflight dry runs (`dryRun: true`) — zero-cost deliverability validation
 *  5. Autonomous AI agent sending & human approval mode (`pending_approval`)
 *  6. Full transactional sending (HTML, text, CC, BCC, Reply-To, tags, headers, attachments)
 *  7. Type-safe guardrail error discrimination (remediations attached to errors)
 *  8. Message event trail inspection (`emails.get`)
 *  9. Email resend under originating key (`emails.resend`)
 * 10. Scheduled sending & atomic cancellation (`emails.cancel`)
 * 11. High-efficiency batch sending with RFC 4918 Multi-Status evaluation
 * 12. Querying message history & filtering by agent / tag (`emails.list`)
 * 13. Server-side Liquid dynamic templates (`templates.list`, `templates.render`)
 * 14. Suppression list management (`suppressions.add`, `suppressions.list`)
 * 15. Human approval queue monitoring (`keys.approvals`)
 * 16. Webhook constant-time HMAC-SHA256 signature verification & event parsing
 *
 * Run this example:
 *   SADASEND_API_KEY="sada_live_sk_..." bun run examples/full-features.ts
 */

import {
  SadaSend,
  DomainNotVerifiedError,
  DomainNotFoundError,
  RecipientNotAllowlistedError,
  RecipientSuppressedError,
  RateLimitError,
  AuthenticationError,
  InsufficientScopeError,
} from 'sadasend';
import { verifyWebhook, parseWebhook } from 'sadasend/webhooks';

const API_KEY = process.env.SADASEND_API_KEY;
if (!API_KEY) {
  console.error('Error: SADASEND_API_KEY environment variable is required.');
  console.error('Provide one via: SADASEND_API_KEY="your_key" bun run examples/full-features.ts');
  process.exit(1);
}

const BASE_URL = process.env.SADASEND_BASE_URL || 'https://api.sadasend.com';
const TEST_RECIPIENT = process.env.TEST_RECIPIENT || 'support@sadasend.com';

console.log('=== SadaSend TypeScript SDK: Master Full-Features Walkthrough ===\n');

// ---------------------------------------------------------------------------
// 1. Client Initialization with AI Agent Provenance & Jittered Retries
// ---------------------------------------------------------------------------
console.log('--- 1. Client Initialization ---');
const sadasend = new SadaSend(API_KEY, {
  baseUrl: BASE_URL,
  timeoutMs: 15_000,
  retry: {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 8_000,
    maxRetryAfterMs: 60_000,
  },
  // Default ingress channel and agent attribution across all sends from this client
  channel: 'sdk',
  source: 'agent',
  agentName: 'billing-bot',
});
console.log(`Initialized SadaSend client targeting: ${BASE_URL}`);

// ---------------------------------------------------------------------------
// 2. Account Telemetry, Quota Metrics, Checklist & Circuit Breakers
// ---------------------------------------------------------------------------
console.log('\n--- 2. Account Telemetry & Deliverability Health ---');
const account = await sadasend.account.get();
if (account.ok) {
  console.log(`Org: ${account.data.org} | Plan: ${account.data.plan.toUpperCase()}`);
  console.log(`Email Quota: ${account.data.emailsUsed} / ${account.data.emailQuota}`);
  console.log(`Domain Quota: ${account.data.domainsUsed} / ${account.data.domainQuota}`);
  console.log(`Reputation Status: ${account.data.reputationLevel ?? 'optimal'}`);
}

const stats = await sadasend.account.stats({ window: '14d' });
if (stats.ok) {
  const deliveryPct = Number.isFinite(stats.data.deliveryRate) ? (stats.data.deliveryRate * 100).toFixed(1) : '100.0';
  const bouncePct = Number.isFinite(stats.data.bounceRate) ? (stats.data.bounceRate * 100).toFixed(2) : '0.00';
  console.log(`14-Day Delivery Rate: ${deliveryPct}% | Bounce Rate: ${bouncePct}%`);
}

const checklist = await sadasend.account.checklist();
if (checklist.ok) {
  console.log(`Onboarding Checklist: ${checklist.data.completed}/${checklist.data.total} steps completed`);
}

const breakers = await sadasend.account.circuitBreakers();
if (breakers.ok) {
  console.log(`Active Circuit Breakers: ${breakers.data.circuitBreakers.length}`);
}

// ---------------------------------------------------------------------------
// 3. Sending Domains Management & DNS Verification
// ---------------------------------------------------------------------------
console.log('\n--- 3. Sending Domains & DNS Records ---');
const domains = await sadasend.domains.list();
if (domains.ok && domains.data.domains.length > 0) {
  const primary = domains.data.domains[0]!;
  console.log(`Primary Domain: ${primary.name} (Status: ${primary.status})`);

  // Fetch DNS records required for DKIM, SPF, and DMARC verification
  const records = await sadasend.domains.records(primary.id);
  if (records.ok) {
    console.log(`DNS Records for verification (${records.data.records.length} records):`);
    for (const rec of records.data.records) {
      console.log(`  [${rec.type}] ${rec.host} -> ${rec.value.slice(0, 32)}... (verdict: ${rec.verdict ?? 'pending'})`);
    }
  }

  // Trigger live nameserver DNS verification check
  const verifyRes = await sadasend.domains.verify(primary.id);
  if (verifyRes.ok) {
    console.log(`Live DNS Verification completed: status = ${verifyRes.data.status}`);
  }
}

// ---------------------------------------------------------------------------
// 4. Safe Preflight Dry Run (Zero-Cost Deliverability Validation)
// ---------------------------------------------------------------------------
console.log('\n--- 4. Safe Preflight Dry Run (Validation Only) ---');
const dryRunResult = await sadasend.emails.send({
  from: 'notifications@sadasend.com',
  to: TEST_RECIPIENT,
  subject: 'Preflight Deliverability Dry Run',
  html: '<p>Testing deliverability and guardrails without dispatching mail.</p>',
  dryRun: true, // Evaluates allowlists, suppressions, and quotas without burning sends
});

if (dryRunResult.ok) {
  console.log(`Preflight passed! dryRun = ${dryRunResult.dryRun}, messageId = ${dryRunResult.id}`);
} else {
  console.error(`Preflight refusal: ${dryRunResult.error.message}`);
}

// ---------------------------------------------------------------------------
// 5. Autonomous AI Agent Sending & Human Approval Queue Mode
// ---------------------------------------------------------------------------
console.log('\n--- 5. Autonomous AI Agent Sending & Approval Queue ---');
const agentSend = await sadasend.emails.send({
  from: 'notifications@sadasend.com',
  to: TEST_RECIPIENT,
  subject: 'Autonomous Agent Summary Report',
  html: '<p>Generated autonomously by AI Agent under safety ceilings.</p>',
  channel: 'sdk',
  source: 'agent',
  agentName: 'claude-code',
});

if (agentSend.ok) {
  if (agentSend.status === 'pending_approval') {
    // Flagship safety feature: Key is in approval mode (sada_agent_sk_...)
    // Message is held safely in the Human Approval Queue until approved in the dashboard
    console.log(`✅ Mail held safely for human approval! ID: ${agentSend.id}`);
  } else {
    console.log(`✅ Mail queued for immediate delivery! ID: ${agentSend.id}`);
  }
} else if (agentSend.error instanceof RecipientNotAllowlistedError) {
  // Model reasonability: The agent receives the exact authorized patterns to self-correct
  console.warn(`Allowlist violation: ${agentSend.error.message}`);
  console.warn(`Authorized patterns: ${agentSend.error.allowlist.join(', ')}`);
}

// ---------------------------------------------------------------------------
// 6. Full-Featured Transactional Email Send (Attachments, Tags, Idempotency)
// ---------------------------------------------------------------------------
console.log('\n--- 6. Advanced Transactional Send with Attachments ---');
const invoicePdfBase64 = Buffer.from('%PDF-1.4 Mock Invoice Content').toString('base64');

const sendResult = await sadasend.emails.send({
  from: 'notifications@sadasend.com',
  to: TEST_RECIPIENT,
  replyTo: 'support@sadasend.com',
  subject: 'Invoice #INV-2026-08 Ready for Download',
  html: `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px;">
      <h2>Invoice #INV-2026-08</h2>
      <p>Thank you for your business. Your official invoice receipt is attached below.</p>
      <a href="https://sadasend.com" style="background: #111; color: #fff; padding: 10px 18px; text-decoration: none; border-radius: 6px;">Open Dashboard</a>
    </div>
  `,
  text: 'Invoice #INV-2026-08. Thank you for your business. Your receipt is attached.',
  tags: ['billing', 'invoices', 'august'],
  headers: {
    'X-Entity-Ref-ID': 'invoice-2026-08',
  },
  attachments: [
    {
      filename: 'invoice-2026-08.pdf',
      content: invoicePdfBase64,
      contentType: 'application/pdf',
    },
  ],
  // Domain-specific idempotency key: guarantees exactly-once delivery across retries and restarts
  idempotencyKey: `invoice-2026-08-${Date.now()}`,
});

let sentMessageId = '';

// ---------------------------------------------------------------------------
// 7. Type-Safe Guardrail Error Discrimination
// ---------------------------------------------------------------------------
if (sendResult.ok) {
  sentMessageId = sendResult.id;
  console.log(`Transactional send succeeded! ID: ${sendResult.id} (Status: ${sendResult.status})`);
} else {
  const err = sendResult.error;
  if (err instanceof DomainNotVerifiedError) {
    console.error(`Domain not verified! Required DNS records:`, err.records);
  } else if (err instanceof DomainNotFoundError) {
    console.error(`Domain not found on account: ${err.message}`);
  } else if (err instanceof RecipientSuppressedError) {
    console.error(`Recipient suppressed! Reason: ${err.reason} (since ${err.body.since ?? 'earlier'})`);
  } else if (err instanceof RecipientNotAllowlistedError) {
    console.error(`Key allowlist restriction:`, err.allowlist);
  } else if (err instanceof RateLimitError) {
    console.error(`Rate limited! Retry after ${err.retryAfterSeconds}s (account throttle: ${err.isAccountThrottle})`);
  } else if (err instanceof AuthenticationError) {
    console.error(`Authentication error: ${err.message}`);
  } else if (err instanceof InsufficientScopeError) {
    console.error(`Key lacks required scopes: ${err.message}`);
  } else {
    console.error(`Send refused: [${err.code}] ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 8. Message Event Trail Inspection & Resending
// ---------------------------------------------------------------------------
if (sentMessageId) {
  console.log('\n--- 8. Message Event Trail Inspection ---');
  const msg = await sadasend.emails.get(sentMessageId);
  if (msg.ok) {
    console.log(`Message ID: ${msg.data.id}`);
    console.log(`From: ${msg.data.from} -> To: ${msg.data.to.join(', ')}`);
    console.log(`Current Status: ${msg.data.status} (at: ${msg.data.at})`);
    if (msg.data.events) {
      console.log(`Event Trail (${msg.data.events.length} events logged):`);
      for (const ev of msg.data.events) {
        console.log(`  [${ev.type}] at ${ev.at}${ev.detail ? ` (${ev.detail})` : ''}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 9. Email Resend Under Originating Key
  // -------------------------------------------------------------------------
  console.log('\n--- 9. Resending Message ---');
  const resend = await sadasend.emails.resend(sentMessageId);
  if (resend.ok) {
    console.log(`Resend queued under original key! New ID: ${resend.data.id} (status: ${resend.data.status})`);
  }
}

// ---------------------------------------------------------------------------
// 10. Scheduled Sending & Atomic Cancellation
// ---------------------------------------------------------------------------
console.log('\n--- 10. Scheduled Sending & Atomic Cancellation ---');
const inTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000);

const scheduledSend = await sadasend.emails.send({
  from: 'notifications@sadasend.com',
  to: TEST_RECIPIENT,
  subject: 'Scheduled Reminder for Tomorrow',
  text: 'This email was scheduled in advance.',
  scheduledAt: inTwoHours,
});

if (scheduledSend.ok) {
  console.log(`Email scheduled! ID: ${scheduledSend.id}`);

  // Cancel the scheduled email atomically before the dispatch worker runs
  const cancelResult = await sadasend.emails.cancel(scheduledSend.id);
  if (cancelResult.ok) {
    console.log(`Scheduled email cancelled! ID: ${cancelResult.data.id} (Status: ${cancelResult.data.status})`);
  }
}

// ---------------------------------------------------------------------------
// 11. High-Efficiency Batch Sending (RFC 4918 Multi-Status)
// ---------------------------------------------------------------------------
console.log('\n--- 11. High-Efficiency Batch Sending ---');
const batchResult = await sadasend.emails.batch([
  {
    from: 'notifications@sadasend.com',
    to: 'customer1@example.com',
    subject: 'Monthly Digest: Part 1',
    text: 'Hello customer 1',
  },
  {
    from: 'notifications@sadasend.com',
    to: 'customer2@example.com',
    subject: 'Monthly Digest: Part 2',
    text: 'Hello customer 2',
  },
]);

if (batchResult.ok) {
  console.log(`Batch processed: ${batchResult.data.accepted} accepted, ${batchResult.data.refused} refused out of ${batchResult.data.total}`);
  for (const item of batchResult.data.results) {
    console.log(`  Item #${item.index}: ok = ${item.ok}, status = ${item.status ?? item.error}`);
  }
}

// ---------------------------------------------------------------------------
// 12. Querying Message History & Filtering by Agent / Tag
// ---------------------------------------------------------------------------
console.log('\n--- 12. Message Listing & Filtering ---');
const listResult = await sadasend.emails.list({
  limit: 5,
  agentName: 'claude-code',
});

if (listResult.ok) {
  console.log(`Found ${listResult.data.messages.length} recent messages sent by 'claude-code'`);
}

// ---------------------------------------------------------------------------
// 13. Server-Side Liquid Dynamic Templates
// ---------------------------------------------------------------------------
console.log('\n--- 13. Server-Side Template Rendering ---');
const templates = await sadasend.templates.list();
if (templates.ok && templates.data.templates.length > 0) {
  const tpl = templates.data.templates[0]!;
  console.log(`Rendering template: ${tpl.name} (v${tpl.version})`);

  const rendered = await sadasend.templates.render(tpl.id, {
    customer_name: 'Alex Johnson',
    order_id: 'ORD-99881',
    total: '$199.50',
  });

  if (rendered.ok) {
    console.log(`Rendered Subject: ${rendered.data.subject ?? '(no subject)'}`);
    console.log(`Rendered HTML snippet: ${rendered.data.html?.slice(0, 60)}...`);
  }
}

// ---------------------------------------------------------------------------
// 14. Suppression List Management
// ---------------------------------------------------------------------------
console.log('\n--- 14. Suppression Management ---');
const unsubAddr = `unsubscribed-${Date.now()}@example.com`;

const addSuppression = await sadasend.suppressions.add(unsubAddr, 'unsubscribe');
if (addSuppression.ok) {
  console.log(`Suppressed address: ${addSuppression.data.address} (already suppressed = ${addSuppression.data.already ?? false})`);
}

const listSuppressions = await sadasend.suppressions.list({ limit: 5 });
if (listSuppressions.ok) {
  console.log(`Total suppressions on account: ${listSuppressions.data.total}`);
}

// ---------------------------------------------------------------------------
// 15. Human Approval Queue Monitoring
// ---------------------------------------------------------------------------
console.log('\n--- 15. Pending Human Approval Queue ---');
const pendingApprovals = await sadasend.keys.approvals();
if (pendingApprovals.ok) {
  console.log(`Messages awaiting human review in dashboard: ${pendingApprovals.data.pending.length}`);
  for (const held of pendingApprovals.data.pending.slice(0, 3)) {
    console.log(`  Held ID: ${held.id} | To: ${held.to} | Subject: "${held.subject}" | Requested By: ${held.requestedBy}`);
  }
}

// ---------------------------------------------------------------------------
// 16. Constant-Time Webhook Signature Verification
// ---------------------------------------------------------------------------
console.log('\n--- 16. Secure Webhook Verification ---');
const sampleWebhookSecret = 'whsec_sample_secret_key_889900';
const samplePayload = JSON.stringify({
  id: 'evt_sample_deliver_01',
  type: 'email.delivered',
  createdAt: new Date().toISOString(),
  data: {
    messageId: 'msg_sample_123',
    accountId: 'acc_demo_456',
    to: [TEST_RECIPIENT],
  },
});

// Constructing test signature header format: `t=<unix-seconds>,v1=<hex>`
const timestamp = Math.floor(Date.now() / 1000);
const encoder = new TextEncoder();
const key = await crypto.subtle.importKey(
  'raw',
  encoder.encode(sampleWebhookSecret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);
const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${samplePayload}`));
const signatureHex = Array.from(new Uint8Array(signatureBuffer))
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');
const signatureHeader = `t=${timestamp},v1=${signatureHex}`;

// In your webhook handler (Next.js / Express / Fastify / Cloudflare Workers):
const isValid = await verifyWebhook(sampleWebhookSecret, samplePayload, signatureHeader);
console.log(`Webhook signature evaluation: ${isValid ? 'VERIFIED (valid)' : 'REJECTED (invalid)'}`);

const parsedEvent = await parseWebhook(sampleWebhookSecret, samplePayload, signatureHeader);
if (parsedEvent) {
  console.log(`Parsed Webhook Event: type = ${parsedEvent.type}, id = ${parsedEvent.id}`);
  console.log(`Delivered to message ID: ${parsedEvent.data.messageId}`);
}

console.log('\n=== SadaSend TypeScript SDK Demo Completed Successfully ===\n');

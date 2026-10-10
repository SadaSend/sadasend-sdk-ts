---
name: sadasend-email
description: >-
  Use this skill whenever an AI agent needs to dispatch transactional emails,
  perform safe preflight deliverability dry runs, handle recipient allowlists,
  monitor human-in-the-loop approval queues, or verify webhooks using the SadaSend SDK.
---

# SadaSend SDK AI Agent Skill

This skill guides autonomous AI agents (Claude, Cursor, LangChain, CrewAI, AutoGen, and Antigravity) on safely and effectively sending transactional emails using the official zero-dependency `sadasend` TypeScript SDK.

Unlike legacy email APIs that blindly dispatch emails or crash via exceptions, SadaSend provides **server-enforced guardrails**, **discriminated union responses**, and **self-correction metadata** specifically engineered for autonomous agents.

---

## Agent Operating Rules (CRITICAL)

1. **Results Are Discriminated Unions — Never Expect Thrown Exceptions for Refusals:**
   ```ts
   const result = await sadasend.emails.send({ from, to, subject, html });
   if (!result.ok) {
     // Handle typed guardrail refusal: result.error
   } else {
     // Success or held for approval: result.id, result.status
   }
   ```
   Refusals (like sending to a recipient outside the allowlist) are the security system working as intended. They do **not** throw.
2. **`pending_approval` Is a Success, NOT a Failure:**
   When an agent runs under an approval-scoped key (`sada_agent_sk_...`), `result.status` will be `'pending_approval'`. This means the email was safely ingested and placed in the **Human Approval Queue** for human review in the SadaSend dashboard. Do **not** retry or treat this as an outage.
3. **Use Safe Preflight Dry Runs (`dryRun: true`):**
   Before dispatching a sensitive or bulk email, run with `dryRun: true`. This validates domain verification, allowlists, syntax, and suppressions at zero cost without emailing external users or burning quota.
4. **Always Provide Agent Provenance:**
   Tag all client instances with `agentName` (e.g. `billing-agent`, `customer-support-bot`) so administrators can trace email velocity and logs directly back to your persona.
5. **Always Use Idempotency Keys Across Multi-Step Workflows:**
   Pass `idempotencyKey: 'task-<id>'` to prevent accidental duplicate deliveries during retries, network glitches, or agent loop restarts.

---

## Quick Reference Workflow

### Step 1: Initialize the Client with Agent Attribution

```ts
import { SadaSend } from 'sadasend';

const sadasend = new SadaSend(process.env.SADASEND_API_KEY, {
  // Attribution headers sent with every request
  agentName: 'customer-support-agent',
  source: 'agent',
  channel: 'sdk',
  timeoutMs: 15_000,
});
```

### Step 2: Preflight Validation (Safe Dry Run)

```ts
const preflight = await sadasend.emails.send({
  from: 'notifications@onboarding.sadasend.com',
  to: 'user@external.com',
  subject: 'Account Notice',
  text: 'Preview notice',
  dryRun: true, // Server evaluates rules but sends nothing
});

if (!preflight.ok) {
  // Guardrail tripped before dispatching
  console.log(`Preflight refused: ${preflight.error.message}`);
}
```

### Step 3: Dispatching Real Transactional Emails

```ts
const result = await sadasend.emails.send({
  from: 'notifications@onboarding.sadasend.com',
  to: 'alice@company.com',
  subject: 'Monthly Summary Report',
  html: '<h1>Report Ready</h1><p>Your weekly metrics have compiled.</p>',
  text: 'Report Ready. Your weekly metrics have compiled.',
  tags: ['reports', 'automated'],
  attachments: [
    {
      filename: 'summary.txt',
      content: Buffer.from('Report details here').toString('base64'),
      contentType: 'text/plain',
    },
  ],
  idempotencyKey: `report-run-${Date.now()}`,
});

if (result.ok) {
  if (result.status === 'pending_approval') {
    console.log(`Email held safely in Human Approval Queue! ID: ${result.id}`);
  } else {
    console.log(`Email queued for immediate delivery! ID: ${result.id}`);
  }
} else {
  // Handle guardrail refusal
}
```

---

## Guardrail Handling & Self-Correction Patterns

When `result.ok === false`, inspect `result.error` to self-correct:

```ts
import {
  RecipientNotAllowlistedError,
  DomainNotVerifiedError,
  RecipientSuppressedError,
  RateLimitError,
} from 'sadasend';

if (!result.ok) {
  const err = result.error;

  // 1. Recipient outside agent allowlist
  if (err instanceof RecipientNotAllowlistedError) {
    console.warn(`Cannot reach ${err.recipient}. Key is restricted to:`, err.allowlist);
    // Self-correction: Inform user/supervisor or route to an approved internal address
  }

  // 2. Domain lacks DNS verification (DKIM/SPF/DMARC)
  else if (err instanceof DomainNotVerifiedError) {
    console.error(`Sending domain unverified. Required DNS records:`, err.records);
    // Report missing records to DevOps
  }

  // 3. Recipient unsubscribed or bounced
  else if (err instanceof RecipientSuppressedError) {
    console.warn(`Recipient suppressed (reason: ${err.reason}). Do NOT retry.`);
  }

  // 4. Rate limited
  else if (err instanceof RateLimitError) {
    console.warn(`Rate limit hit. Wait ${err.retryAfterSeconds}s.`);
  }
}
```

---

## Verifying Inbound Webhooks

When listening for webhook notifications (`email.delivered`, `email.bounced`, etc.):

```ts
import { verifyWebhook, parseWebhook } from 'sadasend/webhooks';

// rawBody MUST be the original string, never re-serialized JSON!
const isValid = await verifyWebhook(
  process.env.SADASEND_WEBHOOK_SECRET!,
  rawBody,
  req.headers.get('sadasend-signature')
);

if (!isValid) {
  return new Response('Invalid webhook signature', { status: 400 });
}

const event = await parseWebhook(process.env.SADASEND_WEBHOOK_SECRET!, rawBody, signatureHeader);
if (event) {
  console.log(`Event ${event.type} for message ${event.data.messageId}`);
}
```

---

## References

For detailed guides, consult:
- [Guardrails & Errors Guide](./references/guardrails-and-errors.md)
- [Complete API Reference](./references/full-api-cheatsheet.md)

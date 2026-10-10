import { SadaSend, verifyWebhook, parseWebhook } from '../src/index.js';
import { createHmac } from 'node:crypto';

function signPayload(secret: string, body: string, atMs: number = Date.now()): string {
  const t = Math.floor(atMs / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

const BASE_URL = process.env.SADASEND_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.SADASEND_API_KEY;
if (!API_KEY) {
  console.error('Error: SADASEND_API_KEY environment variable is required.');
  process.exit(1);
}
const TEST_RECIPIENT = process.env.TEST_RECIPIENT || 'recipient@example.com';

console.log(`\n======================================================`);
console.log(`SadaSend TypeScript SDK Live End-to-End Verification`);
console.log(`Target Base URL: ${BASE_URL}`);
console.log(`API Key:         [configured]`);
console.log(`======================================================\n`);

const client = new SadaSend(API_KEY, { baseUrl: BASE_URL });

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void>) {
  process.stdout.write(`• Testing [${name}] ... `);
  try {
    await fn();
    console.log(`\x1b[32mPASS\x1b[0m`);
    passed++;
  } catch (err: any) {
    console.log(`\x1b[31mFAIL\x1b[0m: ${err.message || err}`);
    if (err.body) console.log(`   Response Body:`, JSON.stringify(err.body));
    failed++;
  }
}

// 1. Account Operations
let domainId = '';
let templateId = '';
let sentMessageId = '';

await check('account.get()', async () => {
  const res = await client.account.get();
  if (!res.ok) throw res.error;
  if (!res.data.org || !res.data.plan) throw new Error('Missing org or plan in account info');
});

await check('account.stats()', async () => {
  const res = await client.account.stats({ window: '14d' });
  if (!res.ok) throw res.error;
  if (typeof res.data.sent !== 'number') throw new Error('Missing sent count in account stats');
});

await check('account.volume()', async () => {
  const res = await client.account.volume({ window: '7d' });
  if (!res.ok) throw res.error;
  if (!Array.isArray(res.data.days)) throw new Error('Missing days array in account volume');
});

await check('account.checklist()', async () => {
  const res = await client.account.checklist();
  if (!res.ok) throw res.error;
  if (!Array.isArray(res.data.items)) throw new Error('Missing items in account checklist');
});

// 2. Domain Operations
await check('domains.list()', async () => {
  const res = await client.domains.list();
  if (!res.ok) throw res.error;
  if (!Array.isArray(res.data.domains)) throw new Error('Missing domains array');
  if (res.data.domains.length > 0) {
    domainId = res.data.domains[0]!.id;
  }
});

if (domainId) {
  await check('domains.records()', async () => {
    const res = await client.domains.records(domainId);
    if (!res.ok) throw res.error;
    if (!Array.isArray(res.data.records)) throw new Error('Missing records array');
  });

  await check('domains.verify()', async () => {
    const res = await client.domains.verify(domainId);
    if (!res.ok) throw res.error;
    if (!res.data.status) throw new Error('Missing status in verify response');
  });
}

// 3. Email Operations
await check('emails.send() with attachment and tags', async () => {
  const res = await client.emails.send({
    from: 'noreply@onboarding.sadasend.com',
    to: TEST_RECIPIENT,
    subject: 'TypeScript SDK Live E2E Test',
    html: '<p>Live test from updated TypeScript SDK with full feature set.</p>',
    tags: ['sdk', 'live-test'],
    attachments: [
      {
        filename: 'report.txt',
        content: Buffer.from('Live test content').toString('base64'),
        contentType: 'text/plain',
      },
    ],
  });
  if (!res.ok) throw res.error;
  if (!res.id || res.status !== 'queued') throw new Error(`Unexpected send status: ${res.status}`);
  sentMessageId = res.id;
});

if (sentMessageId) {
  await check('emails.get()', async () => {
    const res = await client.emails.get(sentMessageId);
    if (!res.ok) throw res.error;
    if (res.data.id !== sentMessageId) throw new Error(`Message id mismatch: ${res.data.id}`);
    if (!Array.isArray(res.data.to)) throw new Error('Normalized to field must be an array');
  });

  await check('emails.resend()', async () => {
    const res = await client.emails.resend(sentMessageId);
    if (!res.ok) throw res.error;
    if (!res.data.id || res.data.status !== 'queued') throw new Error(`Unexpected resend status: ${res.data.status}`);
  });
}

await check('emails.list()', async () => {
  const res = await client.emails.list({ limit: 5 });
  if (!res.ok) throw res.error;
  if (!Array.isArray(res.data.messages)) throw new Error('Missing messages array');
});

await check('emails.batch()', async () => {
  const res = await client.emails.batch([
    {
      from: 'noreply@onboarding.sadasend.com',
      to: TEST_RECIPIENT,
      subject: 'Batch Item 1',
      text: 'Batch item 1 content',
    },
    {
      from: 'noreply@onboarding.sadasend.com',
      to: TEST_RECIPIENT,
      subject: 'Batch Item 2',
      text: 'Batch item 2 content',
    },
  ]);
  if (!res.ok) throw res.error;
  if (res.data.total !== 2 || res.data.results.length !== 2) {
    throw new Error(`Unexpected batch result count: ${res.data.total}`);
  }
});

await check('emails.cancel() on scheduled email', async () => {
  const scheduledTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour future
  const sendRes = await client.emails.send({
    from: 'noreply@onboarding.sadasend.com',
    to: TEST_RECIPIENT,
    subject: 'To Be Cancelled',
    text: 'This email should be cancelled',
    scheduledAt: scheduledTime,
  });
  if (!sendRes.ok) throw sendRes.error;

  const cancelRes = await client.emails.cancel(sendRes.id);
  if (!cancelRes.ok) throw cancelRes.error;
  if (cancelRes.data.status !== 'cancelled') throw new Error(`Expected cancelled status, got: ${cancelRes.data.status}`);
});

// 4. Template Operations
await check('templates.list()', async () => {
  const res = await client.templates.list();
  if (!res.ok) throw res.error;
  if (!Array.isArray(res.data.templates)) throw new Error('Missing templates array');
  if (res.data.templates.length > 0) {
    templateId = res.data.templates[0]!.id;
  }
});

if (templateId) {
  await check('templates.get()', async () => {
    const res = await client.templates.get(templateId);
    if (!res.ok) throw res.error;
    if (res.data.id !== templateId) throw new Error(`Template ID mismatch: ${res.data.id}`);
  });

  await check('templates.render()', async () => {
    const res = await client.templates.render(templateId, { customer_name: 'Customer', order_id: '12345', total: '$99.00' });
    if (!res.ok) throw res.error;
  });
}

// 5. Suppression Operations
const testSuppressionAddr = `live-test-suppress-${Date.now()}@example.com`;
await check('suppressions.add()', async () => {
  const res = await client.suppressions.add(testSuppressionAddr, 'manual');
  if (!res.ok) throw res.error;
  if (res.data.address !== testSuppressionAddr) throw new Error(`Expected address ${testSuppressionAddr}, got: ${res.data.address}`);
});

await check('suppressions.list()', async () => {
  const res = await client.suppressions.list({ q: testSuppressionAddr });
  if (!res.ok) throw res.error;
  if (!Array.isArray(res.data.suppressions)) throw new Error('Missing suppressions array');
  const found = res.data.suppressions.some((s) => s.address === testSuppressionAddr);
  if (!found) throw new Error(`Added suppression address not found in list query`);
});

// 6. Webhook Operations
await check('webhooks.list()', async () => {
  const res = await client.webhooks.list();
  if (!res.ok) throw res.error;
  if (!Array.isArray(res.data.webhooks)) throw new Error('Missing webhooks array');
  if (res.data.webhooks.length > 0) {
    const wid = res.data.webhooks[0]!.id;
    const delivRes = await client.webhooks.deliveries(wid, { limit: 5 });
    if (!delivRes.ok) throw delivRes.error;
    if (!Array.isArray(delivRes.data.deliveries)) throw new Error('Missing deliveries array');
  }
});

await check('webhooks.verifyWebhook() HMAC cryptographic signature verification', async () => {
  const secret = 'whsec_test_secret_for_live_verification_123456';
  const payload = JSON.stringify({
    id: 'evt_test_123',
    type: 'message.delivered',
    createdAt: new Date().toISOString(),
    data: { id: 'msg_123' },
  });
  const header = signPayload(secret, payload);

  const isValid = await verifyWebhook(secret, payload, header);
  if (!isValid) throw new Error('Expected valid HMAC signature to verify successfully');

  const parsed = await parseWebhook(secret, payload, header);
  if (!parsed || parsed.id !== 'evt_test_123') throw new Error('parseWebhook failed to return expected event');

  const tampered = await verifyWebhook(secret, payload + '!', header);
  if (tampered) throw new Error('Tampered payload should have failed signature verification');
});

console.log(`\n------------------------------------------------------`);
console.log(`Results: \x1b[32m${passed} PASSED\x1b[0m | \x1b[31m${failed} FAILED\x1b[0m out of ${passed + failed} checks`);
console.log(`------------------------------------------------------\n`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log(`\x1b[32mAll TypeScript SDK operations verified and 100% operational!\x1b[0m\n`);
  process.exit(0);
}

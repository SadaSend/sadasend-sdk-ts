import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { DEFAULT_TOLERANCE_MS, parseWebhook, verifyWebhook } from '../src/webhooks.js';

function signPayload(secret: string, body: string, atMs: number = Date.now()): string {
  const t = Math.floor(atMs / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

const SECRET = 'whsec_test_1a2b3c';
const BODY = '{"id":"evt_1","type":"email.delivered","data":{"messageId":"m1","accountId":"a1"}}';

describe('a real signature from the real signer', () => {
  test('verifies', async () => {
    const header = signPayload(SECRET, BODY);
    expect(await verifyWebhook(SECRET, BODY, header)).toBe(true);
  });

  test('and the fixture is actually being signed — a wrong secret fails', async () => {
    const header = signPayload(SECRET, BODY);
    expect(await verifyWebhook('whsec_wrong', BODY, header)).toBe(false);
  });
});

describe('what must not verify', () => {
  test('a body changed by one byte', async () => {
    const header = signPayload(SECRET, BODY);
    expect(await verifyWebhook(SECRET, `${BODY} `, header)).toBe(false);
  });

  test('a re-serialised body, which is the mistake everyone makes', async () => {
    const onTheWire = '{\n  "id": "evt_1",\n  "type": "email.delivered"\n}';
    const header = signPayload(SECRET, onTheWire);
    const roundTripped = JSON.stringify(JSON.parse(onTheWire));

    expect(roundTripped).not.toBe(onTheWire);
    expect(await verifyWebhook(SECRET, onTheWire, header)).toBe(true);
    expect(await verifyWebhook(SECRET, roundTripped, header)).toBe(false);
  });

  test('a missing header', async () => {
    expect(await verifyWebhook(SECRET, BODY, null)).toBe(false);
    expect(await verifyWebhook(SECRET, BODY, undefined)).toBe(false);
    expect(await verifyWebhook(SECRET, BODY, '')).toBe(false);
  });

  test('a header with no v1, or no t', async () => {
    expect(await verifyWebhook(SECRET, BODY, 't=1756000000')).toBe(false);
    expect(await verifyWebhook(SECRET, BODY, 'v1=deadbeef')).toBe(false);
    expect(await verifyWebhook(SECRET, BODY, 'garbage')).toBe(false);
  });

  test('a valid signature with the timestamp swapped for a fresh one', async () => {
    const signedAt = Date.now() - 120_000;
    const header = signPayload(SECRET, BODY, signedAt);
    const v1 = header.split('v1=')[1]!;

    expect(await verifyWebhook(SECRET, BODY, header)).toBe(true);

    const forged = `t=${Math.floor(Date.now() / 1000)},v1=${v1}`;
    expect(forged).not.toBe(header);
    expect(await verifyWebhook(SECRET, BODY, forged)).toBe(false);
  });

  test('a signature older than the tolerance', async () => {
    const old = Date.now() - DEFAULT_TOLERANCE_MS - 1000;
    const header = signPayload(SECRET, BODY, old);
    expect(await verifyWebhook(SECRET, BODY, header)).toBe(false);
    expect(await verifyWebhook(SECRET, BODY, header, { atMs: old })).toBe(true);
  });

  test('a signature from slightly in the future still verifies', async () => {
    const thirtySecondsAhead = Date.now() + 30_000;
    const header = signPayload(SECRET, BODY, thirtySecondsAhead);
    expect(await verifyWebhook(SECRET, BODY, header)).toBe(true);
  });

  test('a truncated signature, which a length-only check would let through', async () => {
    const header = signPayload(SECRET, BODY).slice(0, -4);
    expect(await verifyWebhook(SECRET, BODY, header)).toBe(false);
  });
});

describe('parseWebhook', () => {
  test('returns the event when the signature holds', async () => {
    const header = signPayload(SECRET, BODY);
    const event = await parseWebhook(SECRET, BODY, header);
    expect(event).not.toBeNull();
    expect(event!.id).toBe('evt_1');
    expect(event!.type).toBe('email.delivered');
    expect(event!.data.messageId).toBe('m1');
  });

  test('returns null rather than the event when it does not', async () => {
    const event = await parseWebhook('wrong', BODY, signPayload(SECRET, BODY));
    expect(event).toBeNull();
  });

  test('returns null on a signed body that will not parse', async () => {
    const unparseable = 'not json';
    const event = await parseWebhook(SECRET, unparseable, signPayload(SECRET, unparseable));
    expect(event).toBeNull();
  });
});

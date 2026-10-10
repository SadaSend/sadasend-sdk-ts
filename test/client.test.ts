 import { describe, expect, test } from 'bun:test';
import { SadaSend } from '../src/client.js';
import {
  ConnectionError, DomainNotVerifiedError, IdempotencyInProgressError, InsufficientScopeError,
  RateLimitError, RecipientNotAllowlistedError, RecipientSuppressedError, SadaSendError,
  ServerError, isRetryable,
} from '../src/errors.js';
import { DEFAULT_RETRY, delayFor } from '../src/retry.js';

/**
 * The transport, driven with a fake `fetch`.
 *
 * Retry behaviour is the part of a client that is never exercised in
 * development — everything works, so nothing retries — and is then load-bearing
 * the first time a provider has a bad ten minutes. So it is tested against
 * scripted responses rather than hoped about.
 */

type Scripted = { status: number; body?: unknown; headers?: Record<string, string> } | { throw: unknown };

function scriptedFetch(script: Scripted[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = script[calls.length - 1] ?? script.at(-1)!;
    if ('throw' in next) throw next.throw;
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json', ...next.headers },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fn, calls };
}

const client = (script: Scripted[], opts = {}) => {
  const f = scriptedFetch(script);
  return {
    calls: f.calls,
    sdk: new SadaSend('sada_live_sk_test', {
      baseUrl: 'http://api.test', fetch: f.fn,
      // Retries are exercised; the delay is not what is under test.
      retry: { baseDelayMs: 0, maxDelayMs: 0, ...opts },
    }),
  };
};

const OK = { status: 202, body: { id: 'e1', status: 'queued' } };
const SEND = { from: 'a@b.test', to: 'c@d.test', subject: 's', html: 'h' };

describe('what comes back', () => {
  test('a send that works is a success union, not a thrown value', async () => {
    const { sdk } = client([OK]);
    const r = await sdk.emails.send(SEND);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.id).toBe('e1');
  });

  /**
   * A held message is a *success*. The send was accepted; a person has to
   * release it. A client that treated approval mode as an error would make the
   * flagship guardrail look like a malfunction to everything downstream.
   */
  test('approval mode is a success with a status, not an error', async () => {
    const { sdk } = client([{ status: 202, body: { id: 'e2', status: 'pending_approval' } }]);
    const r = await sdk.emails.send(SEND);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe('pending_approval');
  });

  test('a guardrail refusal is returned, never thrown', async () => {
    const { sdk } = client([{
      status: 403, body: {
        error: 'recipient_not_allowlisted',
        message: 'Key allowlist is [@allowed.example]. Recipient is outside it.',
        allowlist: ['@allowed.example'], recipient: 'stranger@elsewhere.test',
      },
    }]);

    // No try/catch here on purpose — if this threw, the test would fail.
    const r = await sdk.emails.send(SEND);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(RecipientNotAllowlistedError);
      expect((r.error as RecipientNotAllowlistedError).allowlist).toEqual(['@allowed.example']);
      expect((r.error as RecipientNotAllowlistedError).recipient).toBe('stranger@elsewhere.test');
    }
  });

  /** The error names the fix, which for an unverified domain means the records. */
  test('an unverified domain arrives with its DNS records attached', async () => {
    const records = [{ type: 'TXT', host: '@', value: 'v=spf1 …', verdict: 'fail', note: 'Not published.' }];
    const { sdk } = client([{
      status: 403, body: { error: 'domain_not_verified', message: 'x has not passed DNS verification yet.', records },
    }]);

    const r = await sdk.emails.send(SEND);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(DomainNotVerifiedError);
      expect((r.error as DomainNotVerifiedError).records).toEqual(records as never);
    }
  });

  test('a suppression carries the reason, which is the part that decides what to do', async () => {
    const { sdk } = client([{
      status: 422, body: {
        error: 'recipient_suppressed', message: 'x is on your suppression list (unsubscribe).',
        recipient: 'quiet@example.test', reason: 'unsubscribe',
      },
    }]);
    const r = await sdk.emails.send(SEND);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(RecipientSuppressedError);
      expect((r.error as RecipientSuppressedError).reason).toBe('unsubscribe');
    }
  });

  /**
   * An SDK a version behind the API should get *less specific*, never break.
   * A code it has never heard of is still a `SadaSendError` with the body on it.
   */
  test('an unknown error code degrades to the base class with the body intact', async () => {
    const { sdk } = client([{
      status: 400, body: { error: 'invented_next_year', message: 'Something new.', hint: 'useful' },
    }]);
    const r = await sdk.emails.send(SEND);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(SadaSendError);
      expect(r.error.code).toBe('invented_next_year');
      expect(r.error.body.hint).toBe('useful');
    }
  });

  /**
   * A proxy's HTML error page is not JSON. The old failure mode is a parse
   * exception mentioning `<`, which tells the reader nothing about the 502 they
   * actually got.
   */
  test('a non-JSON body is an error about the status, not a parse crash', async () => {
    const f = scriptedFetch([{ status: 502 }]);
    const sdk = new SadaSend('k', {
      baseUrl: 'http://api.test',
      fetch: (async () => new Response('<html>502 Bad Gateway</html>', {
        status: 502, headers: { 'content-type': 'text/html' },
      })) as unknown as typeof globalThis.fetch,
      retry: { maxRetries: 0 },
    });
    void f;
    const r = await sdk.emails.send(SEND);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(ServerError);
      expect(r.error.status).toBe(502);
    }
  });
});

describe('idempotency', () => {
  /**
   * The default that matters. Without a key, a retry after a timeout is a
   * second email to a real person — and the timeout is exactly when a client
   * retries.
   */
  test('a key is generated when none is given', async () => {
    const { sdk, calls } = client([OK]);
    await sdk.emails.send(SEND);
    const key = (calls[0]!.init.headers as Record<string, string>)['idempotency-key'];
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('a key you supply is the one sent', async () => {
    const { sdk, calls } = client([OK]);
    await sdk.emails.send({ ...SEND, idempotencyKey: 'order-4417' });
    expect((calls[0]!.init.headers as Record<string, string>)['idempotency-key']).toBe('order-4417');
  });

  /**
   * The property that makes retrying safe at all. A key regenerated per attempt
   * is no key: the server sees three unrelated requests and sends three emails.
   */
  test('every retry carries the same key', async () => {
    const { sdk, calls } = client([
      { status: 500, body: { error: 'internal', message: 'x' } },
      { status: 500, body: { error: 'internal', message: 'x' } },
      OK,
    ]);
    await sdk.emails.send(SEND);
    expect(calls).toHaveLength(3);
    const keys = calls.map((c) => (c.init.headers as Record<string, string>)['idempotency-key']);
    expect(new Set(keys).size).toBe(1);
  });

  /**
   * `idempotency_key_in_progress` means the first request has not finished.
   * Retrying returns *its* result rather than sending again, so this is one of
   * the few 4xx worth retrying.
   */
  test('an in-progress idempotent request is retried, and gets the first result', async () => {
    const { sdk, calls } = client([
      { status: 409, body: { error: 'idempotency_key_in_progress', message: 'Still in progress.' } },
      OK,
    ]);
    const r = await sdk.emails.send(SEND);
    expect(calls).toHaveLength(2);
    expect(r.ok).toBe(true);
  });
});

describe('retrying', () => {
  test('a 5xx is retried and the success is returned', async () => {
    const { sdk, calls } = client([{ status: 503, body: { error: 'unavailable', message: 'x' } }, OK]);
    const r = await sdk.emails.send(SEND);
    expect(calls).toHaveLength(2);
    expect(r.ok).toBe(true);
  });

  /**
   * The rule this whole file exists for. The API sends `Retry-After`, and
   * nothing read it until now. A client that guesses shorter makes the limit
   * worse; one that guesses longer wastes the customer's time.
   */
  test('Retry-After is obeyed exactly, not backed off from', () => {
    const err = new RateLimitError('rate_limit_exceeded', 429, 'x', {}, 7);
    // Same answer on every attempt: the server named a time, so there is
    // nothing to escalate.
    expect(delayFor(1, err, DEFAULT_RETRY)).toBe(7000);
    expect(delayFor(2, err, DEFAULT_RETRY)).toBe(7000);
  });

  test('the header is read off the response, not only out of the body', async () => {
    const { sdk } = client([{
      status: 429, body: { error: 'rate_limit_exceeded', message: 'x' },
      headers: { 'retry-after': '900' },
    }], { maxRetries: 0 });

    const r = await sdk.emails.send(SEND);
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.error as RateLimitError).retryAfterSeconds).toBe(900);
  });

  /**
   * An account throttled for reputation can be told to come back in an hour.
   * Blocking a request handler for an hour is worse than returning the error,
   * so the policy declines and the header rides along for the caller to act on.
   */
  test('a Retry-After longer than we will block for is returned, not slept on', async () => {
    const { sdk, calls } = client([{
      status: 429, body: { error: 'account_throttled', message: 'x', retryAfterSeconds: 3600 },
      headers: { 'retry-after': '3600' },
    }]);

    const started = Date.now();
    const r = await sdk.emails.send(SEND);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(calls).toHaveLength(1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect((r.error as RateLimitError).isAccountThrottle).toBe(true);
      expect((r.error as RateLimitError).retryAfterSeconds).toBe(3600);
    }
  });

  /**
   * Full jitter, not fixed backoff. Every client refused in the same second
   * otherwise returns in the same second and is refused together — the
   * thundering herd that turns a brief limit into a long one.
   */
  test('backoff is jittered across the window rather than fixed', () => {
    const err = new ServerError('internal', 500, 'x', {});
    const lo = delayFor(3, err, DEFAULT_RETRY, () => 0);
    const hi = delayFor(3, err, DEFAULT_RETRY, () => 0.999);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(1000);
    // And it grows: attempt 1's ceiling is below attempt 3's.
    expect(delayFor(1, err, DEFAULT_RETRY, () => 0.999)!)
      .toBeLessThan(delayFor(3, err, DEFAULT_RETRY, () => 0.999)!);
  });

  /**
   * The absence that matters more than any retry. An agent that retries past an
   * allowlist is an agent that eventually gets through, and a client retrying
   * `recipient_suppressed` would automate the one thing suppression exists to
   * stop.
   */
  test('no guardrail refusal is ever retried', async () => {
    for (const body of [
      { error: 'recipient_not_allowlisted', message: 'x' },
      { error: 'recipient_suppressed', message: 'x' },
      { error: 'insufficient_scope', message: 'x' },
      { error: 'domain_not_verified', message: 'x' },
      { error: 'idempotency_key_reused', message: 'x' },
    ]) {
      const { sdk, calls } = client([{ status: 403, body }, OK]);
      const r = await sdk.emails.send(SEND);
      expect(calls, `${body.error} was retried`).toHaveLength(1);
      expect(r.ok).toBe(false);
    }
  });

  test('isRetryable agrees with what the client actually does', () => {
    expect(isRetryable(new ServerError('x', 500, 'm', {}))).toBe(true);
    expect(isRetryable(new RateLimitError('x', 429, 'm', {}))).toBe(true);
    expect(isRetryable(new IdempotencyInProgressError('x', 409, 'm', {}))).toBe(true);
    expect(isRetryable(new InsufficientScopeError('x', 403, 'm', {}))).toBe(false);
    expect(isRetryable(new RecipientSuppressedError('x', 422, 'm', {}))).toBe(false);
  });

  test('retries are bounded, and the last error is what comes back', async () => {
    const { sdk, calls } = client([{ status: 500, body: { error: 'internal', message: 'still broken' } }]);
    const r = await sdk.emails.send(SEND);
    expect(calls).toHaveLength(DEFAULT_RETRY.maxRetries + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe('still broken');
  });
});

describe('when there is no answer at all', () => {
  /**
   * Thrown rather than returned, and deliberately. Not knowing whether the API
   * saw the request is a different situation from being told no, and flattening
   * the two into one union member would hide it.
   */
  test('an unreachable API throws ConnectionError after exhausting retries', async () => {
    const { sdk, calls } = client([{ throw: new TypeError('fetch failed') }]);
    await expect(sdk.emails.send(SEND)).rejects.toBeInstanceOf(ConnectionError);
    expect(calls).toHaveLength(DEFAULT_RETRY.maxRetries + 1);
  });

  test('the thrown error keeps the cause and the attempt count', async () => {
    const cause = new TypeError('ECONNREFUSED');
    const { sdk } = client([{ throw: cause }]);
    try {
      await sdk.emails.send(SEND);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConnectionError);
      expect((e as ConnectionError).cause).toBe(cause);
      expect((e as ConnectionError).attempts).toBe(DEFAULT_RETRY.maxRetries + 1);
    }
  });

  /** A connection fault on the first attempt still carries the idempotency key. */
  test('a recovered connection fault does not send twice', async () => {
    const { sdk, calls } = client([{ throw: new TypeError('fetch failed') }, OK]);
    const r = await sdk.emails.send(SEND);
    expect(r.ok).toBe(true);
    const keys = calls.map((c) => (c.init.headers as Record<string, string>)['idempotency-key']);
    expect(new Set(keys).size).toBe(1);
  });
});

describe('construction', () => {
  test('a missing key fails at construction with the place to get one', () => {
    const saved = process.env.SADASEND_API_KEY;
    delete process.env.SADASEND_API_KEY;
    try {
      expect(() => new SadaSend()).toThrow(/SADASEND_API_KEY/);
      expect(() => new SadaSend()).toThrow(/dashboard/);
    } finally {
      if (saved !== undefined) process.env.SADASEND_API_KEY = saved;
    }
  });

  test('a trailing slash on the base URL does not become a double slash', async () => {
    const f = scriptedFetch([OK]);
    const sdk = new SadaSend('k', { baseUrl: 'http://api.test/', fetch: f.fn });
    await sdk.emails.send(SEND);
    expect(f.calls[0]!.url).toBe('http://api.test/emails');
  });

  test('a single recipient is sent as an array, as the API expects', async () => {
    const { sdk, calls } = client([OK]);
    await sdk.emails.send({ ...SEND, to: 'one@example.test' });
    expect(JSON.parse(String(calls[0]!.init.body)).to).toEqual(['one@example.test']);
  });

  test('a Date scheduledAt is serialised as ISO, not as [object Object]', async () => {
    const { sdk, calls } = client([OK]);
    const at = new Date('2026-09-01T10:00:00.000Z');
    await sdk.emails.send({ ...SEND, scheduledAt: at });
    expect(JSON.parse(String(calls[0]!.init.body)).scheduledAt).toBe('2026-09-01T10:00:00.000Z');
  });
});

describe('the wire format, smoothed over', () => {
  /**
   * Found by running the SDK against the real API rather than against a mock of
   * it. `GET /emails/:id` returns `to` as a bare string when there is one
   * recipient and an array when there are several — so `to[0]` on a
   * single-recipient message silently returns `"d"`, and `to.join` is not a
   * function. Neither failure says what went wrong.
   */
  test('a single recipient comes back as an array, not a bare string', async () => {
    const { sdk } = client([{
      status: 200,
      body: { id: 'e1', from: 'a@b.test', to: 'one@example.test', subject: 's', status: 'queued', at: 'x' },
    }]);
    const r = await sdk.emails.get('e1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.to).toEqual(['one@example.test']);
  });

  test('several recipients are left alone', async () => {
    const { sdk } = client([{
      status: 200,
      body: { id: 'e1', from: 'a@b.test', to: ['x@e.test', 'y@e.test'], subject: 's', status: 'queued', at: 'x' },
    }]);
    const r = await sdk.emails.get('e1');
    if (r.ok) expect(r.data.to).toEqual(['x@e.test', 'y@e.test']);
  });

  test('and the list is normalised the same way, message by message', async () => {
    const { sdk } = client([{
      status: 200,
      body: {
        messages: [
          { id: 'a', from: 'f@e.test', to: 'one@example.test', subject: null, status: 'sent', at: 'x' },
          { id: 'b', from: 'f@e.test', to: ['x@e.test', 'y@e.test'], subject: null, status: 'sent', at: 'x' },
        ],
        nextCursor: null,
      },
    }]);
    const r = await sdk.emails.list();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.messages[0]!.to).toEqual(['one@example.test']);
      expect(r.data.messages[1]!.to).toEqual(['x@e.test', 'y@e.test']);
      // Every recipient field is an array, which is the property callers rely on.
      for (const m of r.data.messages) expect(Array.isArray(m.to)).toBe(true);
    }
  });
});

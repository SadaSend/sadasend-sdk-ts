/**
 * An error class per failure mode, and every one of them carries the fix.
 *
 * The standard is the one the free tools hold themselves to: a message that
 * says what is wrong and nothing about what to do is a message that generates a
 * support ticket. `DomainNotVerifiedError` carries the DNS records that are
 * missing, because the person reading it is about to go and look them up.
 *
 * These are **not thrown** for guardrail refusals. A refusal is the product
 * working — an agent stopped from mailing someone it should not — and throwing
 * turns the normal case into an exception. They arrive inside the result union,
 * where `instanceof` narrows them and the compiler makes you handle them.
 */

/** The DNS record shape `GET /domains/:id/records` and this error both use. */
export type DnsRecord = {
  type: string;
  host: string;
  value: string;
  verdict?: 'pass' | 'fail' | 'pending' | 'inconclusive';
  note?: string;
};

export class SadaSendError extends Error {
  /** The machine-readable code. Stable; the message is not. */
  readonly code: string;
  readonly status: number;
  /** `https://sadasend.com/docs/errors#<code>`, sent by the API. */
  readonly docs?: string;
  /** The whole body, for codes newer than this SDK. */
  readonly body: Record<string, unknown>;

  constructor(code: string, status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.docs = typeof body.docs === 'string' ? body.docs : undefined;
    this.body = body;
  }
}

/** The key is not valid, or was revoked. Nothing to retry. */
export class AuthenticationError extends SadaSendError { }

/**
 * The key has scopes, and `send` is not among them.
 *
 * Deliberately not retryable and deliberately not fixable in code: widening a
 * key is a decision someone makes in the dashboard, on purpose.
 */
export class InsufficientScopeError extends SadaSendError { }

/** The `from` address did not parse as an email address. */
export class InvalidFromError extends SadaSendError { }

export class DomainNotFoundError extends SadaSendError { }

/**
 * The domain exists but has not passed DNS verification — and the records are
 * attached, so the fix is in the error rather than a page away.
 */
export class DomainNotVerifiedError extends SadaSendError {
  get records(): DnsRecord[] {
    return Array.isArray(this.body.records) ? (this.body.records as DnsRecord[]) : [];
  }
}

/**
 * The guardrail that makes an agent safe to hand a key to. The allowlist is on
 * the error because the interesting question is always "what *is* it allowed to
 * mail, then".
 */
export class RecipientNotAllowlistedError extends SadaSendError {
  get recipient(): string | undefined {
    return typeof this.body.recipient === 'string' ? this.body.recipient : undefined;
  }

  get allowlist(): string[] {
    return Array.isArray(this.body.allowlist) ? (this.body.allowlist as string[]) : [];
  }
}

/**
 * The address is on the suppression list. The reason carries a judgement the
 * caller should not make on its own: `unsubscribe` is a person's decision, and
 * `hard_bounce` is an address that does not exist. Neither is "retry later",
 * which is why this is not retryable.
 */
export class RecipientSuppressedError extends SadaSendError {
  get recipient(): string | undefined {
    return typeof this.body.recipient === 'string' ? this.body.recipient : undefined;
  }

  get reason(): 'hard_bounce' | 'complaint' | 'unsubscribe' | 'manual' | undefined {
    return this.body.reason as never;
  }
}

/** The same key with a different body. The first request stands. */
export class IdempotencyKeyReusedError extends SadaSendError { }

/**
 * The first request with this key has not finished. Retrying returns *its*
 * result rather than sending twice, so this one **is** retryable — and the
 * client does retry it, which is the whole point of sending the key.
 */
export class IdempotencyInProgressError extends SadaSendError { }

/**
 * Rate limited — by this key's own limit, or by the account-wide throttle that
 * a bounce or complaint rate above the published threshold applies.
 *
 * `retryAfterSeconds` comes from the `Retry-After` header the API already
 * sends. The client waits exactly that long rather than guessing, because a
 * guess that is too short is what turns a limit into an outage.
 */
export class RateLimitError extends SadaSendError {
  readonly retryAfterSeconds?: number;

  constructor(code: string, status: number, message: string, body: Record<string, unknown>, retryAfterSeconds?: number) {
    super(code, status, message, body);
    this.retryAfterSeconds = retryAfterSeconds
      ?? (typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : undefined);
  }

  /** True when the account is throttled for reputation, not merely over a key limit. */
  get isAccountThrottle(): boolean {
    return this.code === 'account_throttled';
  }
}

/** 5xx, or a body that was not the error envelope. Retryable. */
export class ServerError extends SadaSendError { }

/**
 * The request never got an answer — DNS, TLS, a dropped socket, a timeout.
 *
 * This one **is thrown** rather than returned. It is not the API refusing
 * anything; it is not knowing whether the API saw the request at all, and that
 * is a genuinely different situation from a refusal with a reason.
 */
export class ConnectionError extends Error {
  readonly cause: unknown;
  readonly attempts: number;

  constructor(message: string, cause: unknown, attempts: number) {
    super(message);
    this.name = 'ConnectionError';
    this.cause = cause;
    this.attempts = attempts;
  }
}

/**
 * Codes to classes. A code this SDK has not heard of becomes a plain
 * `SadaSendError` with the body intact — an SDK a version behind should degrade
 * to "less specific", never to "throws on parse".
 */
const BY_CODE: Record<string, new (c: string, s: number, m: string, b: Record<string, unknown>) => SadaSendError> = {
  missing_api_key: AuthenticationError,
  invalid_api_key: AuthenticationError,
  unauthenticated: AuthenticationError,
  insufficient_scope: InsufficientScopeError,
  invalid_from: InvalidFromError,
  domain_not_found: DomainNotFoundError,
  domain_not_verified: DomainNotVerifiedError,
  recipient_not_allowlisted: RecipientNotAllowlistedError,
  recipient_suppressed: RecipientSuppressedError,
  idempotency_key_reused: IdempotencyKeyReusedError,
  idempotency_key_in_progress: IdempotencyInProgressError,
};

export function toError(
  status: number,
  body: Record<string, unknown>,
  retryAfterSeconds?: number,
): SadaSendError {
  const code = typeof body.error === 'string' ? body.error : `http_${status}`;
  const message = typeof body.message === 'string'
    ? body.message
    : `The API returned ${status} with no error message.`;

  if (status === 429) return new RateLimitError(code, status, message, body, retryAfterSeconds);
  if (status >= 500) return new ServerError(code, status, message, body);

  const Cls = BY_CODE[code];
  return Cls ? new Cls(code, status, message, body) : new SadaSendError(code, status, message, body);
}

/**
 * What is worth trying again.
 *
 * Every guardrail refusal is absent by design: an agent that retries past an
 * allowlist is an agent that eventually gets through, and a client that retried
 * `recipient_suppressed` would be automating the one thing the suppression list
 * exists to stop.
 */
export function isRetryable(e: SadaSendError): boolean {
  return e instanceof ServerError
    || e instanceof RateLimitError
    || e instanceof IdempotencyInProgressError;
}

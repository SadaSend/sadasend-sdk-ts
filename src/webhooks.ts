/**
 * The webhook signature verifier.
 *
 * This is the one piece of our security every customer has to reimplement, and
 * the one most likely to be got subtly wrong — the usual mistakes are comparing
 * with `===`, forgetting the timestamp is inside the signed material, and
 * verifying the parsed object instead of the raw body. Shipping it means nobody
 * has to make them.
 *
 * **WebCrypto, not `node:crypto`.** Webhook handlers live on Vercel Edge and
 * Cloudflare Workers as often as they live on a Node server, and an
 * unimportable verifier is a verifier those customers write themselves. The
 * cost is that this is async; the handler already is.
 */

const encoder = new TextEncoder();

/** Matches the server: `t=<unix-seconds>,v1=<hex>`. */
export const SIGNATURE_HEADER = 'sadasend-signature';

/**
 * Five minutes, matching the server. Without a timestamp in the signed material
 * a captured request is a permanent credential; with one, it expires.
 */
export const DEFAULT_TOLERANCE_MS = 5 * 60_000;

export type VerifyOptions = {
  /** For tests, and for a handler that has its own clock. */
  atMs?: number;
  toleranceMs?: number;
};

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time over the *content*.
 *
 * `===` on strings exits at the first differing byte, and how long that takes
 * is enough to build a valid signature a byte at a time. The length is compared
 * first and separately: both sides here are fixed-length SHA-256 hex, so a
 * length mismatch is a malformed header rather than a guess in progress, and
 * leaking that fact costs nothing.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a webhook.
 *
 * `body` must be the **raw request body as a string**, byte for byte as it
 * arrived. `JSON.stringify(await req.json())` is not the same string — key
 * order and whitespace survive the wire and do not survive a round trip — and
 * every signature will fail in a way that looks like a wrong secret.
 *
 * ```ts
 * const raw = await req.text();
 * if (!await verifyWebhook(process.env.SADASEND_WEBHOOK_SECRET!, raw, req.headers.get('sadasend-signature'))) {
 *   return new Response('bad signature', { status: 400 });
 * }
 * const event = JSON.parse(raw);
 * ```
 */
export async function verifyWebhook(
  secret: string,
  body: string,
  header: string | null | undefined,
  opts: VerifyOptions = {},
): Promise<boolean> {
  if (!header) return false;
  const { atMs = Date.now(), toleranceMs = DEFAULT_TOLERANCE_MS } = opts;

  const parts = new Map<string, string>();
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i > 0) parts.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }

  const t = Number(parts.get('t'));
  const given = parts.get('v1');
  if (!Number.isFinite(t) || !given) return false;

  // Checked before the HMAC, so an expired signature costs no crypto at all.
  if (Math.abs(atMs - t * 1000) > toleranceMs) return false;

  return timingSafeEqualHex(await hmacHex(secret, `${t}.${body}`), given);
}

/**
 * The events an endpoint can subscribe to — all of them, and only them.
 *
 * `email.opened` and `email.clicked` were listed here and are not subscribable:
 * open and click tracking is not shipped, and `POST /webhooks` refuses both by
 * name. A type that offers an event the API rejects sends the customer to write
 * a handler for something they cannot receive.
 */
export type WebhookEventType =
  | 'email.sent' | 'email.delivered' | 'email.bounced'
  | 'email.complained' | 'email.refused';

export type WebhookEvent = {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  data: { messageId: string; accountId: string; to?: string[]; detail?: string };
};

/**
 * Verify and parse in one call, returning the event or `null`.
 *
 * The shape most handlers want, and it makes the dangerous mistake harder: the
 * raw body goes in, and there is no version of this that takes an object.
 */
export async function parseWebhook(
  secret: string,
  body: string,
  header: string | null | undefined,
  opts: VerifyOptions = {},
): Promise<WebhookEvent | null> {
  if (!await verifyWebhook(secret, body, header, opts)) return null;
  try {
    return JSON.parse(body) as WebhookEvent;
  } catch {
    return null;
  }
}

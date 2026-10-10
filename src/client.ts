import {
  ConnectionError, SadaSendError, isRetryable, toError,
  type DnsRecord,
} from './errors.js';
import { DEFAULT_RETRY, delayFor, sleep, type RetryPolicy } from './retry.js';

/**
 * The SadaSend client.
 *
 * **Results are a union, not exceptions.** Every guardrail refusal — an agent
 * stopped from mailing outside its allowlist, a send held for approval, a
 * suppressed recipient — is the product working as designed. Throwing on those
 * makes the normal case an exception, and `catch` blocks are where errors go to
 * be swallowed. So `{ ok: true, ... } | { ok: false, error }`, and the compiler
 * makes you look at it.
 *
 * The one thing that *does* throw is `ConnectionError`: not knowing whether the
 * API saw the request is a different situation from being told no.
 */

export type Attachment = {
  filename: string;
  content: string;
  contentType?: string;
  contentId?: string;
};

export type SendInput = {
  from: string;
  to: string | string[];
  subject?: string;
  html?: string;
  text?: string;
  /** Template name or id, rendered server-side with `variables`. */
  template?: string;
  variables?: Record<string, unknown>;
  /**
   * Where replies go. Not a recipient: it costs no quota and is checked against
   * neither the key's allowlist nor your suppression list.
   */
  replyTo?: string | string[];
  /**
   * Copied recipients, and recipients in every sense the guardrails care about.
   *
   * They count against quota and are checked against the key's allowlist and
   * your suppression list exactly as `to` is. Putting an address in `bcc` is not
   * a way around a guardrail — it only changes who can see it.
   */
  cc?: string | string[];
  bcc?: string | string[];
  /**
   * Up to ten labels for the log and the stats.
   *
   * Lowercased and de-duplicated server-side, so `Welcome` and `welcome` are one
   * tag rather than two rows in a breakdown nobody can read. `GET
   * /account/stats?by_tag=true` then gives each its own bounce and complaint
   * rate, against its own send count.
   */
  tags?: string[];
  headers?: Record<string, string>;
  attachments?: Attachment[];
  scheduledAt?: Date | string;
  /**
   * Run every check and send nothing. The cheapest way to be sure, and the
   * same code path as a real send — a preview down a different path would be a
   * preview of something else.
   */
  dryRun?: boolean;
  /**
   * Sent as `Idempotency-Key`. **Generated for you if you leave it out**, so a
   * retried request cannot become two emails. Pass your own when the natural
   * key is in your domain — an order id makes "send this receipt once" true
   * across process restarts, which a generated one cannot.
   */
  idempotencyKey?: string;
  /** Ingress channel override: `sdk` (default), `api`, `mcp`, `smtp`. */
  channel?: string;
  /** Sending source persona: `backend`, `agent`, `automation`, `system`. */
  source?: string;
  /** Associated AI agent identifier or name (e.g. `billing-bot`, `claude-code`). */
  agentName?: string;
  agent_name?: string;
};

export type SendResult =
  | { ok: true; id: string; status: 'queued' | 'pending_approval'; dryRun?: true; rendered?: unknown }
  | { ok: false; error: SadaSendError };

export type BatchItemResult = {
  index: number;
  ok: boolean;
  id?: string;
  status?: string;
  error?: string;
  message?: string;
  allowlist?: string[];
};

export type BatchResult = {
  results: BatchItemResult[];
  accepted: number;
  refused: number;
  total: number;
};

export type MessageStatus =
  'queued' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'refused' | 'cancelled' | 'pending_approval';

export type Message = {
  id: string;
  to: string[];
  from: string;
  subject: string | null;
  status: MessageStatus;
  at: string;
  events?: { type: string; at: string; detail?: string }[];
  channel?: string;
  source?: string;
  agentName?: string | null;
};

export type AccountInfo = {
  org: string;
  plan: string;
  state: string;
  emailsUsed: number;
  emailQuota: number;
  domainsUsed: number;
  domainQuota: number;
  retentionDays: number;
  trackOpens: boolean;
  trackClicks: boolean;
  seatsUsed: number;
  seatQuota: number;
  quotaPeriodStart?: string | null;
  quotaPeriodEnd?: string | null;
  nextResetAt?: string | null;
  daysUntilReset?: number | null;
  dailySendLimit?: number | null;
  dailySendsUsed?: number | null;
  dailyResetAt?: string | null;
  dailyResetSeconds?: number | null;
  reputationLevel?: string;
  warmup?: {
    applies: boolean;
    day: number;
    totalDays: number;
    dailyLimit: number;
    dailyUsed: number | null;
    nextDayLimit: number | null;
    resetSeconds: number | null;
    dailyResetAt?: string | null;
  };
};

export type AccountStats = {
  window: string;
  sent: number;
  delivered: number;
  deliveryRate: number;
  bounced: number;
  bounceRate: number;
  complained: number;
  complaintRate: number;
};

export type AccountVolumeDay = {
  date: string;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
};

export type AccountVolume = {
  window: string;
  days: AccountVolumeDay[];
};

export type ChecklistItem = {
  key: string;
  title: string;
  completed: boolean;
};

export type AccountChecklist = {
  items: ChecklistItem[];
  completed: number;
  total: number;
};

export type TemplateSummary = {
  id: string;
  name: string;
  version: number;
};

export type TemplateDetail = {
  id: string;
  name: string;
  subject: string;
  html?: string;
  text?: string;
  version: number;
};

export type WebhookEndpoint = {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
};

export type WebhookDelivery = {
  id: string;
  event: string;
  status: number;
  success: boolean;
};

export type CircuitBreaker = {
  agentIdentifier: string;
  agentName: string;
  channel: string;
  trippedAt: string;
  reason: string;
};

export type StaffAccess = {
  id: string;
  at: string;
  staff: string;
  role: string;
  reason: string;
  reference?: string;
  messageId?: string;
  subject?: string;
};

export type ApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  mode: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string | null;
};

export type HeldApproval = {
  id: string;
  to: string;
  subject: string;
  requestedBy: string;
  at: string;
};

export type SupportTicketSummary = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type DeliverabilityTool = {
  id: string;
  name: string;
  description: string;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: SadaSendError };

export type ClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  /** Per attempt, not for the whole call including retries. */
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  /** For tests and for a runtime with its own instrumented fetch. */
  fetch?: typeof globalThis.fetch;
  /** Default ingress channel: `sdk` (default), `api`, `mcp`, `smtp`. */
  channel?: string;
  /** Default sending source persona: `backend`, `agent`, `automation`, `system`. */
  source?: string;
  /** Default AI agent identifier or name. */
  agentName?: string;
};

const VERSION = '0.1.0';

/**
 * `process.env`, read without assuming it exists.
 *
 * This package runs in Cloudflare Workers, Vercel Edge and the browser, where
 * there is no `process` at all — and it is compiled without Node or Bun's
 * ambient types on purpose, so nothing here can quietly depend on a global the
 * customer's runtime does not have.
 */
const env = (name: string): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[name];

export class SadaSend {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #retry: RetryPolicy;
  readonly #fetch: typeof globalThis.fetch;
  readonly #channel?: string;
  readonly #source?: string;
  readonly #agentName?: string;

  constructor(apiKeyOrOptions?: string | ClientOptions, options: ClientOptions = {}) {
    const opts = typeof apiKeyOrOptions === 'object' && apiKeyOrOptions !== null
      ? apiKeyOrOptions
      : options;
    const key = (typeof apiKeyOrOptions === 'string' ? apiKeyOrOptions : undefined)
      ?? opts.apiKey
      ?? env('SADASEND_API_KEY');
    if (!key) {
      throw new Error(
        'No API key. Pass one to `new SadaSend(key)` or set SADASEND_API_KEY. '
        + 'Keys are created in the dashboard under Keys and shown once.',
      );
    }
    this.#apiKey = key;
    this.#baseUrl = (opts.baseUrl ?? env('SADASEND_BASE_URL') ?? 'https://api.sadasend.com')
      .replace(/\/+$/, '');
    this.#timeoutMs = opts.timeoutMs ?? 30_000;
    this.#retry = { ...DEFAULT_RETRY, ...opts.retry };
    this.#fetch = opts.fetch ?? globalThis.fetch;
    this.#channel = opts.channel ?? env('SADASEND_CHANNEL');
    this.#source = opts.source ?? env('SADASEND_SOURCE');
    this.#agentName = opts.agentName ?? env('SADASEND_AGENT_NAME');
  }

  /**
   * Send an email.
   *
   * ```ts
   * const r = await sadasend.emails.send({ from, to, subject, html });
   * if (!r.ok) return console.error(r.error.message);
   * ```
   *
   * `r.status` is `'pending_approval'` when the key is in approval mode — the
   * message is real and waiting for a person, not lost. Treating that as a
   * success is correct: the send was accepted.
   */
  readonly emails = {
    send: async (input: SendInput): Promise<SendResult> => {
      const { idempotencyKey, channel, source, agentName, agent_name, headers, ...rest } = input;
      const resolvedChannel = channel ?? this.#channel;
      const resolvedSource = source ?? this.#source;
      const resolvedAgent = agentName ?? agent_name ?? this.#agentName;

      const outgoingHeaders: Record<string, string> = { ...(headers ?? {}) };
      if (resolvedAgent) outgoingHeaders['x-sadasend-agent'] = resolvedAgent;
      if (resolvedSource) outgoingHeaders['x-sadasend-source'] = resolvedSource;

      const r = await this.#request<{ id: string; status: 'queued' | 'pending_approval'; dryRun?: true; rendered?: unknown }>(
        'POST', '/emails', {
        headers: outgoingHeaders,
        body: {
          ...rest,
          ...(resolvedChannel ? { channel: resolvedChannel } : {}),
          ...(resolvedSource ? { source: resolvedSource } : {}),
          ...(resolvedAgent ? { agent_name: resolvedAgent } : {}),
          to: Array.isArray(rest.to) ? rest.to : [rest.to],
          scheduledAt: rest.scheduledAt instanceof Date ? rest.scheduledAt.toISOString() : rest.scheduledAt,
        },
        // Generated when absent, which is the point: without one, a retry
        // after a timeout is a second email to a real person.
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      },
      );
      return r.ok ? { ok: true, ...r.data } : r;
    },

    batch: async (
      items: SendInput[],
      options: { idempotencyKey?: string } = {},
    ): Promise<Result<BatchResult>> => {
      const body = {
        emails: items.map((item) => {
          const { idempotencyKey, channel, source, agentName, agent_name, ...rest } = item;
          const resolvedChannel = channel ?? this.#channel;
          const resolvedSource = source ?? this.#source;
          const resolvedAgent = agentName ?? agent_name ?? this.#agentName;
          return {
            ...rest,
            ...(resolvedChannel ? { channel: resolvedChannel } : {}),
            ...(resolvedSource ? { source: resolvedSource } : {}),
            ...(resolvedAgent ? { agent_name: resolvedAgent } : {}),
            to: Array.isArray(rest.to) ? rest.to : [rest.to],
            scheduledAt: rest.scheduledAt instanceof Date ? rest.scheduledAt.toISOString() : rest.scheduledAt,
          };
        }),
      };
      return this.#request<BatchResult>('POST', '/emails/batch', {
        body,
        idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
      });
    },

    get: async (id: string): Promise<Result<Message>> => {
      const r = await this.#request<Message>('GET', `/emails/${encodeURIComponent(id)}`);
      return r.ok ? { ok: true, data: normalise(r.data) } : r;
    },

    resend: (id: string, options: { idempotencyKey?: string } = {}): Promise<Result<{ id: string; status: MessageStatus }>> =>
      this.#request('POST', `/emails/${encodeURIComponent(id)}/resend`, {
        idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
      }),

    list: async (params: {
      status?: MessageStatus;
      q?: string;
      tag?: string;
      channel?: string;
      source?: string;
      agentName?: string;
      agent_name?: string;
      limit?: number;
      cursor?: string;
    } = {}) => {
      const { agentName, agent_name, ...rest } = params;
      const r = await this.#request<{ messages: Message[]; total?: number; nextCursor: string | null }>(
        'GET',
        `/emails${query({ ...rest, ...(agentName || agent_name ? { agent_name: agentName ?? agent_name } : {}) })}`,
      );
      return r.ok
        ? { ok: true as const, data: { ...r.data, messages: r.data.messages.map(normalise) } }
        : r;
    },

    cancel: (id: string): Promise<Result<{ id: string; status: MessageStatus; scheduledAt?: string | null }>> =>
      this.#request('DELETE', `/emails/${encodeURIComponent(id)}`),
  };

  readonly account = {
    get: () => this.#request<AccountInfo>('GET', '/account'),
    stats: (params: { window?: string; by_tag?: boolean } = {}) =>
      this.#request<AccountStats>('GET', `/account/stats${query(params)}`),
    volume: (params: { window?: string } = {}) =>
      this.#request<AccountVolume>('GET', `/account/volume${query(params)}`),
    checklist: () =>
      this.#request<AccountChecklist>('GET', '/account/checklist'),
    circuitBreakers: () =>
      this.#request<{ circuitBreakers: CircuitBreaker[] }>('GET', '/account/circuit-breakers'),
    staffAccess: (params: { limit?: number } = {}) =>
      this.#request<{ accesses: StaffAccess[]; note?: string }>('GET', `/account/staff-access${query(params)}`),
  };

  readonly domains = {
    list: () => this.#request<{ domains: { id: string; name: string; status: string }[] }>('GET', '/domains'),
    records: (id: string) => this.#request<{ records: DnsRecord[] }>('GET', `/domains/${encodeURIComponent(id)}/records`),
    verify: (id: string) => this.#request<{ status: string; verified?: boolean; inconclusive?: boolean; checks?: DnsRecord[]; records?: DnsRecord[] }>('POST', `/domains/${encodeURIComponent(id)}/verify`),
  };

  readonly suppressions = {
    list: (params: { q?: string; reason?: string; limit?: number } = {}) =>
      this.#request<{ suppressions: { address: string; reason: string; createdAt: string }[]; total: number }>(
        'GET', `/suppressions${query(params)}`),
    add: (address: string, reason = 'manual') =>
      this.#request<{ address: string; reason: string; already?: boolean }>('POST', '/suppressions', { body: { address, reason } }),
  };

  readonly templates = {
    list: () => this.#request<{ templates: TemplateSummary[] }>('GET', '/templates'),
    get: (id: string) =>
      this.#request<TemplateDetail>('GET', `/templates/${encodeURIComponent(id)}`),
    render: (id: string, variables: Record<string, unknown> = {}) =>
      this.#request<{ subject?: string; html?: string; text?: string }>(
        'POST', `/templates/${encodeURIComponent(id)}/render`, { body: { variables } }),
    test: (id: string, options: { to: string; variables?: Record<string, unknown> }) =>
      this.#request<{ ok: boolean; messageId: string }>(
        'POST', `/templates/${encodeURIComponent(id)}/test`, { body: options }),
  };

  readonly keys = {
    list: () => this.#request<{ keys: ApiKeySummary[] }>('GET', '/keys'),
    approvals: () => this.#request<{ pending: HeldApproval[] }>('GET', '/keys/approvals'),
  };

  readonly support = {
    tickets: (params: { limit?: number } = {}) =>
      this.#request<{ tickets: SupportTicketSummary[] }>('GET', `/support/tickets${query(params)}`),
    ticket: (id: string) =>
      this.#request<any>('GET', `/support/tickets/${encodeURIComponent(id)}`),
  };

  readonly team = {
    get: () => this.#request<{ members: TeamMember[]; invitations?: any[] }>('GET', '/team'),
  };

  readonly tools = {
    list: () => this.#request<{ tools: DeliverabilityTool[] }>('GET', '/tools'),
    check: (check: string, subject: string, selector?: string) =>
      this.#request<any>('POST', `/tools/${encodeURIComponent(check)}`, { body: { subject, selector } }),
  };

  readonly webhooks = {
    list: () => this.#request<{ webhooks: WebhookEndpoint[] }>('GET', '/webhooks'),
    deliveries: (id: string, params: { limit?: number; event?: string } = {}) =>
      this.#request<{ deliveries: WebhookDelivery[] }>(
        'GET', `/webhooks/${encodeURIComponent(id)}/deliveries${query(params)}`),
  };

  /* ------------------------------------------------------------ transport */

  async #request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; idempotencyKey?: string; headers?: Record<string, string> } = {},
  ): Promise<Result<T>> {
    const url = `${this.#baseUrl}${path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#apiKey}`,
      'user-agent': `sadasend-js/${VERSION}`,
      ...(this.#agentName ? { 'x-sadasend-agent': this.#agentName } : {}),
      ...(this.#source ? { 'x-sadasend-source': this.#source } : {}),
      ...(opts.headers ?? {}),
    };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    // The same key on every attempt, which is what makes retrying safe. A key
    // regenerated per attempt is no key at all.
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);

    let lastConnectionFault: unknown;
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method,
          headers,
          body: payload,
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (cause) {
        /**
         * No answer. Retried like a 5xx — with the idempotency key intact, so
         * an attempt that did reach the server returns its original result
         * instead of sending twice.
         */
        lastConnectionFault = cause;
        if (attempt > this.#retry.maxRetries) {
          throw new ConnectionError(
            `Could not reach ${this.#baseUrl} after ${attempt} attempt${attempt === 1 ? '' : 's'}.`,
            cause, attempt,
          );
        }
        await sleep(delayFor(attempt, new SadaSendError('connection', 0, ''), this.#retry) ?? 0);
        continue;
      }

      const text = await response.text();
      const body = parseJson(text);

      if (response.ok) return { ok: true, data: body as T };

      const error = toError(response.status, body, retryAfterSeconds(response));

      if (!isRetryable(error) || attempt > this.#retry.maxRetries) return { ok: false, error };

      const wait = delayFor(attempt, error, this.#retry);
      // `null` means the policy declined — a `Retry-After` longer than we will
      // block for. The error carries the header, so the caller can schedule it.
      if (wait === null) return { ok: false, error };
      await sleep(wait);
    }
    // Unreachable; the loop returns or throws. Referenced so a future edit that
    // breaks out of the loop fails to compile rather than returning undefined.
    void lastConnectionFault;
  }
}

/**
 * `to` is a union on the wire: the API returns a bare string for one recipient
 * and an array for several (`m.to.length === 1 ? m.to[0] : m.to`). The contract
 * fixed that shape from a UI that only ever renders one, and the dashboard
 * consumes it as it is — so it is not the SDK's place to change the wire.
 *
 * It *is* the SDK's place not to pass the wart on. A union-typed field is a
 * paper cut at every call site, and the bug it causes is silent: `to[0]` on a
 * single-recipient message returns `"d"`. Always an array here.
 */
function normalise(m: Message): Message {
  return { ...m, to: Array.isArray(m.to) ? m.to : [m.to as unknown as string] };
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text);
    return v !== null && typeof v === 'object' ? v as Record<string, unknown> : { value: v };
  } catch {
    // A proxy's HTML error page, or an empty 502. Kept so the error message can
    // show what actually arrived rather than "unexpected token < in JSON".
    return { error: 'invalid_response', message: text.slice(0, 200) || 'The API returned an empty body.' };
  }
}

function retryAfterSeconds(r: Response): number | undefined {
  const raw = r.headers.get('retry-after');
  if (!raw) return undefined;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  // The header may also be an HTTP-date. Rare from our API, valid per RFC 9110.
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function query(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

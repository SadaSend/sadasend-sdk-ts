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

export type UtmOptions = {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  override_existing?: boolean;
};

export type UtmBuildInput = {
  url: string;
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  override_existing?: boolean;
};

export type UtmBuildResult = {
  ok: boolean;
  original: string;
  tagged: string;
  /** Normalized URL (alias of `tagged`) */
  url?: string;
  params: Record<string, string>;
};


export type VerificationCheckResult = {
  label: string;
  value: string;
  verdict: 'pass' | 'warn' | 'fail';
  note?: string;
};

export type VerificationResult = {
  email: string;
  user: string;
  domain: string;
  status: 'deliverable' | 'undeliverable' | 'risky';
  verdict: 'pass' | 'warn' | 'fail';
  score: number;
  reasons?: string[];
  suggestion?: string | null;
  checks: {
    syntax: { valid: boolean; error?: string };
    mx: { valid: boolean; records?: string[]; hasFallbackA?: boolean };
    disposable: { isDisposable: boolean };
    role: { isRole: boolean };
    typo?: { hasTypo: boolean; suggestion?: string; suggestedDomain?: string };
  };
  rows: VerificationCheckResult[];
  summary: string;
};

export type BatchVerificationResult = {
  ok: boolean;
  total: number;
  deliverable: number;
  undeliverable: number;
  disposable: number;
  role_account: number;
  results: VerificationResult[];
};

export type ReactEmailElement =
  | { type: unknown; props: unknown; key?: unknown }
  | Record<string, unknown>
  | unknown;

export type RenderedEmail = {
  html: string;
  text?: string;
};

export type ReactEmailRenderOptions = {
  plainText?: boolean;
  pretty?: boolean;
  renderer?: (
    element: unknown,
    options?: { plainText?: boolean; pretty?: boolean },
  ) => Promise<RenderedEmail> | RenderedEmail;
};

export type SendInput = {
  from: string;
  to: string | string[];
  subject?: string;
  html?: string;
  text?: string;
  /**
   * First-class React Email component (e.g. `<WelcomeEmail />`).
   * Automatically rendered to HTML (and plain-text if `text` is omitted)
   * via `@react-email/render` or `react-dom/server`.
   */
  react?: ReactEmailElement;
  /** Optional custom renderer options for React Email components. */
  reactRenderOptions?: ReactEmailRenderOptions;
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
  utm?: UtmOptions;
  attachments?: Attachment[];
  scheduledAt?: Date | string;
  /**
   * Real-time recipient deliverability verification before enqueue.
   * Refuses undeliverable recipients with 422 UndeliverableRecipientError and debits zero quota.
   */
  verifyBeforeSend?: boolean;
  verify_before_send?: boolean;
  /**
   * RFC 8058 One-Click List-Unsubscribe Header.
   * Automatically injects List-Unsubscribe and List-Unsubscribe-Post headers.
   */
  marketing?: boolean;
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
  /** Associated AI agent identifier or name (e.g. `finance-bot`, `claude-code`). */
  agentName?: string;
  agent_name?: string;
  /** Structured provenance & agent arbitration priority metadata. */
  provenance?: MessageProvenance;
  /** Bypass 5-minute rolling loop circuit breaker deduplication. */
  allowDuplicate?: boolean;
  allow_duplicate?: boolean;
  bypassLoopBreaker?: boolean;
  bypass_loop_breaker?: boolean;
  /** Outbound DLP secret & PII scanning toggle (defaults to true). Set false to explicitly bypass. */
  dlp?: boolean;
  /** Contact cooldown for destination recipient (e.g. `24h`, `30m`). */
  crossAgentCooldown?: string | number | boolean;
  cross_agent_cooldown?: string | number | boolean;
  /** Priority level for agent arbitration: `critical`, `alert`, `standard`, `bulk`, `follow_up`. */
  priority?: 'critical' | 'alert' | 'standard' | 'bulk' | 'follow_up' | string;
  /** Whether to respect open customer support ticket outreach holds. Defaults to true. */
  ticketAware?: boolean;
  ticket_aware?: boolean;
};

export type MessageProvenance = {
  channel?: 'transactional' | 'marketing' | 'agent' | 'operations' | 'support' | 'notification' | string;
  source?: 'api' | 'smtp' | 'mcp' | 'dashboard' | 'workflow' | string;
  agentName?: string;
  priority?: 'critical' | 'alert' | 'standard' | 'bulk' | 'follow_up' | string;
};

export type SendResult =
  | { ok: true; id: string; status: 'queued' | 'pending_approval'; held?: boolean; holdType?: 'tenant' | 'security' | null; holdReason?: string | null; dryRun?: true; rendered?: unknown }
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
  held?: boolean;
  holdType?: 'tenant' | 'security' | null;
  holdReason?: string | null;
  at: string;
  events?: { type: string; at: string; detail?: string }[];
  channel?: string;
  source?: string;
  agentName?: string | null;
  provenance?: MessageProvenance;
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

export type InboundRoute = {
  id: string;
  pattern: string;
  targetUrl: string;
  enabled: boolean;
  priority: number;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

export type InboundRouteInput = {
  pattern: string;
  targetUrl: string;
  enabled?: boolean;
  priority?: number;
  description?: string;
};

export type InboundMessageSummary = {
  id: string;
  from: string;
  to: string[];
  subject: string | null;
  routeId?: string;
  status: string;
  receivedAt: string;
};

export type InboundParseInput = {
  rawMime?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  headers?: Record<string, string>;
};

export type InboundParseResult = {
  ok: boolean;
  quarantined: boolean;
  from?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  thread?: {
    threadId: string;
    cleanSubject: string;
    isThreadRoot: boolean;
    threadDepth: number;
    messageId?: string;
    rootMessageId?: string;
    parentMessageId?: string;
    references?: string[];
  };
  content: {
    cleanMarkdown: string;
    hasQuotedHistory: boolean;
    quotedHistory?: string;
    hasSignature: boolean;
    signature?: string;
    telemetry?: {
      originalBytes: number;
      cleanedBytes: number;
      originalTokensEst: number;
      cleanedTokensEst: number;
      tokenReductionPercent: number;
    };
  };
  security: {
    injectionRiskScore: number;
    riskLevel: 'clean' | 'low' | 'medium' | 'critical' | string;
    recommendedAction: 'pass' | 'flag' | 'quarantine' | string;
    quarantineRecommended: boolean;
    hiddenContentDetected: boolean;
    detections: {
      category: string;
      pattern?: string;
      preview?: string;
      severity: number;
      description?: string;
    }[];
  };
};

export type InboundSimulateResult = {
  matched: boolean;
  route?: InboundRoute;
  targetUrl?: string;
};

export type DmarcReportSummary = {
  id: string;
  org: string;
  reportId: string;
  dateRangeBegin: string;
  dateRangeEnd: string;
  domain: string;
  policy: string;
  totalMessages: number;
  spfPassCount: number;
  dkimPassCount: number;
  fullyAlignedCount: number;
  passRate: number;
  createdAt: string;
};

export type DmarcDomainSummary = {
  domain: string;
  totalReports: number;
  totalMessages: number;
  overallPassRate: number;
  dkimAlignmentPct: number;
  spfAlignmentPct: number;
  currentPolicy: string;
  recommendedPolicy: string;
};

export type DmarcThreat = {
  ip: string;
  domain: string;
  messageCount: number;
  country?: string;
  lastSeenAt: string;
};

export type ArbiterStats = {
  ok: boolean;
  activeCooldownsCount: number;
  openTicketsCount: number;
  collisionsPrevented: number;
};

export type CooldownResult = {
  ok: boolean;
  cooldown: boolean;
  recipient: string;
  durationSeconds: number;
  reason?: string;
  expiresAt: string;
};

export type CooldownStatus = {
  ok: boolean;
  recipient: string;
  cooldownActive: boolean;
  remainingSeconds: number;
  reason?: string;
  expiresAt?: string;
};

export type EphemeralInbox = {
  id: string;
  email: string;
  alias: string;
  domain: string;
  ttlSeconds: number;
  createdAt: string;
  expiresAt: string;
  messageCount: number;
  latestOtp?: string | null;
  latestMagicLink?: string | null;
};

export type EphemeralInboxCreateInput = {
  alias?: string;
  domain?: string;
  ttlSeconds?: number;
  description?: string;
  metadata?: Record<string, unknown>;
};

export type InboxOtpResult = {
  ok: boolean;
  inboxId: string;
  email: string;
  code?: string;
  otp?: string;
  magicLink?: string | null;
  pending?: boolean;
  message?: {
    id: string;
    from: string;
    subject: string;
    receivedAt: string;
  };
};

export type InboxMessage = {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  otp?: string | null;
  magicLink?: string | null;
};

export type TestingInboundInput = {
  to: string;
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
};

export type WaitForCodeInput = {
  to: string;
  timeoutMs?: number;
  since?: string;
};

export type WaitForCodeResult = {
  ok: boolean;
  code: string;
  otp?: string | null;
  magicLink?: string | null;
  allOtps?: string[];
  allMagicLinks?: string[];
  messageId?: string;
  to?: string;
  subject?: string;
  receivedAt?: string;
};

export type InboxStreamConnectedEvent = {
  event: 'connected';
  data: { ok: boolean; inboxId: string; email: string; expiresAt: string };
};

export type InboxStreamOtpEvent = {
  event: 'otp';
  data: { inboxId: string; otp: string; code?: string; magicLink?: string | null; receivedAt: string };
};

export type InboxStreamMessageEvent = {
  event: 'message';
  data: InboxMessage;
};

export type InboxStreamHeartbeatEvent = {
  event: 'heartbeat';
  data: { timestamp: number };
};

export type InboxStreamEvent =
  | InboxStreamConnectedEvent
  | InboxStreamOtpEvent
  | InboxStreamMessageEvent
  | InboxStreamHeartbeatEvent
  | { event: string; data: unknown };

export type InboxStreamResponse = {
  url: string;
  response: Response;
  body: ReadableStream<Uint8Array> | null;
  [Symbol.asyncIterator]: () => AsyncGenerator<InboxStreamEvent>;
};

export type SlackIntegrationStatus = {
  connected: boolean;
  integration?: {
    id: string;
    channel: string;
    name: string;
    enabled: boolean;
    channelName?: string;
    teamName?: string;
    hasSigningSecret: boolean;
    webhookUrlMasked?: string;
    createdAt: string;
    updatedAt: string;
  };
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

const VERSION = '0.1.4';

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
      const {
        react,
        reactRenderOptions,
        idempotencyKey,
        channel,
        source,
        agentName,
        agent_name,
        verifyBeforeSend,
        verify_before_send,
        marketing,
        provenance,
        headers,
        allowDuplicate,
        allow_duplicate,
        bypassLoopBreaker,
        bypass_loop_breaker,
        dlp,
        crossAgentCooldown,
        cross_agent_cooldown,
        priority,
        ticketAware,
        ticket_aware,
        ...rest
      } = input;
      const resolvedChannel = provenance?.channel ?? channel ?? this.#channel;
      const resolvedSource = provenance?.source ?? source ?? this.#source;
      const resolvedAgent = provenance?.agentName ?? agentName ?? agent_name ?? this.#agentName;
      const resolvedPriority = provenance?.priority ?? priority;
      const resolvedVerify = verifyBeforeSend ?? verify_before_send;
      const resolvedAllowDup = allowDuplicate ?? allow_duplicate ?? bypassLoopBreaker ?? bypass_loop_breaker;
      const resolvedCooldown = crossAgentCooldown ?? cross_agent_cooldown;
      const resolvedTicketAware = ticketAware ?? ticket_aware;

      let resolvedHtml = rest.html;
      let resolvedText = rest.text;

      if (!resolvedHtml && react) {
        const rendered = await renderReactEmail(react, {
          plainText: !resolvedText,
          ...reactRenderOptions,
        });
        resolvedHtml = rendered.html;
        if (!resolvedText && rendered.text) {
          resolvedText = rendered.text;
        }
      }

      const outgoingHeaders: Record<string, string> = { ...(headers ?? {}) };
      if (resolvedAgent) outgoingHeaders['x-sadasend-agent'] = resolvedAgent;
      if (resolvedSource) outgoingHeaders['x-sadasend-source'] = resolvedSource;
      if (resolvedPriority) outgoingHeaders['x-sadasend-priority'] = resolvedPriority;

      const r = await this.#request<{ id: string; status: 'queued' | 'pending_approval'; held?: boolean; holdType?: 'tenant' | 'security' | null; holdReason?: string | null; dryRun?: true; rendered?: unknown }>(
        'POST', '/emails', {
        headers: outgoingHeaders,
        body: {
          ...rest,
          ...(resolvedHtml ? { html: resolvedHtml } : {}),
          ...(resolvedText ? { text: resolvedText } : {}),
          ...(resolvedChannel ? { channel: resolvedChannel } : {}),
          ...(resolvedSource ? { source: resolvedSource } : {}),
          ...(resolvedAgent ? { agent_name: resolvedAgent } : {}),
          ...(resolvedPriority ? { priority: resolvedPriority } : {}),
          ...(provenance ? { provenance } : {}),
          ...(typeof resolvedVerify === 'boolean' ? { verify_before_send: resolvedVerify } : {}),
          ...(typeof marketing === 'boolean' ? { marketing } : {}),
          ...(typeof resolvedAllowDup === 'boolean' ? { allow_duplicate: resolvedAllowDup } : {}),
          ...(typeof dlp === 'boolean' ? { dlp } : {}),
          ...(resolvedCooldown !== undefined ? { cross_agent_cooldown: resolvedCooldown } : {}),
          ...(typeof resolvedTicketAware === 'boolean' ? { ticket_aware: resolvedTicketAware } : {}),
          to: Array.isArray(rest.to) ? rest.to : [rest.to],
          scheduledAt: rest.scheduledAt instanceof Date ? rest.scheduledAt.toISOString() : rest.scheduledAt,
        },
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      },
      );
      return r.ok ? { ok: true, ...r.data } : r;
    },

    batch: async (
      items: SendInput[],
      options: { idempotencyKey?: string } = {},
    ): Promise<Result<BatchResult>> => {
      const emails = await Promise.all(
        items.map(async (item) => {
          const {
            react,
            reactRenderOptions,
            idempotencyKey,
            channel,
            source,
            agentName,
            agent_name,
            verifyBeforeSend,
            verify_before_send,
            marketing,
            provenance,
            allowDuplicate,
            allow_duplicate,
            bypassLoopBreaker,
            bypass_loop_breaker,
            dlp,
            crossAgentCooldown,
            cross_agent_cooldown,
            priority,
            ticketAware,
            ticket_aware,
            ...rest
          } = item;
          const resolvedChannel = provenance?.channel ?? channel ?? this.#channel;
          const resolvedSource = provenance?.source ?? source ?? this.#source;
          const resolvedAgent = provenance?.agentName ?? agentName ?? agent_name ?? this.#agentName;
          const resolvedPriority = provenance?.priority ?? priority;
          const resolvedVerify = verifyBeforeSend ?? verify_before_send;
          const resolvedAllowDup = allowDuplicate ?? allow_duplicate ?? bypassLoopBreaker ?? bypass_loop_breaker;
          const resolvedCooldown = crossAgentCooldown ?? cross_agent_cooldown;
          const resolvedTicketAware = ticketAware ?? ticket_aware;

          let resolvedHtml = rest.html;
          let resolvedText = rest.text;

          if (!resolvedHtml && react) {
            const rendered = await renderReactEmail(react, {
              plainText: !resolvedText,
              ...reactRenderOptions,
            });
            resolvedHtml = rendered.html;
            if (!resolvedText && rendered.text) {
              resolvedText = rendered.text;
            }
          }

          return {
            ...rest,
            ...(resolvedHtml ? { html: resolvedHtml } : {}),
            ...(resolvedText ? { text: resolvedText } : {}),
            ...(resolvedChannel ? { channel: resolvedChannel } : {}),
            ...(resolvedSource ? { source: resolvedSource } : {}),
            ...(resolvedAgent ? { agent_name: resolvedAgent } : {}),
            ...(resolvedPriority ? { priority: resolvedPriority } : {}),
            ...(provenance ? { provenance } : {}),
            ...(typeof resolvedVerify === 'boolean' ? { verify_before_send: resolvedVerify } : {}),
            ...(typeof marketing === 'boolean' ? { marketing } : {}),
            ...(typeof resolvedAllowDup === 'boolean' ? { allow_duplicate: resolvedAllowDup } : {}),
            ...(typeof dlp === 'boolean' ? { dlp } : {}),
            ...(resolvedCooldown !== undefined ? { cross_agent_cooldown: resolvedCooldown } : {}),
            ...(typeof resolvedTicketAware === 'boolean' ? { ticket_aware: resolvedTicketAware } : {}),
            to: Array.isArray(rest.to) ? rest.to : [rest.to],
            scheduledAt: rest.scheduledAt instanceof Date ? rest.scheduledAt.toISOString() : rest.scheduledAt,
          };
        }),
      );
      return this.#request<BatchResult>('POST', '/emails/batch', {
        body: { emails },
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
      offset?: number;
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
    buildUtm: (options: UtmBuildInput) =>
      this.#request<UtmBuildResult>('POST', '/tools/utm', { body: options }),
    verify: (email: string) =>
      this.#request<VerificationResult>('POST', '/tools/verify', { body: { email } }),
    verifyBatch: (emails: string[]) =>
      this.#request<BatchVerificationResult>('POST', '/tools/verify/batch', { body: { emails } }),
  };

  readonly webhooks = {
    list: () => this.#request<{ webhooks: WebhookEndpoint[] }>('GET', '/webhooks'),
    deliveries: (id: string, params: { limit?: number; event?: string } = {}) =>
      this.#request<{ deliveries: WebhookDelivery[] }>(
        'GET', `/webhooks/${encodeURIComponent(id)}/deliveries${query(params)}`),
  };

  readonly inbound = {
    routes: {
      list: () => this.#request<{ routes: InboundRoute[]; count: number }>('GET', '/inbound/routes'),
      create: (input: InboundRouteInput) =>
        this.#request<{ ok: boolean; route: InboundRoute }>('POST', '/inbound/routes', { body: input }),
      get: (id: string) =>
        this.#request<{ ok: boolean; route: InboundRoute }>('GET', `/inbound/routes/${encodeURIComponent(id)}`),
      update: (id: string, input: Partial<InboundRouteInput>) =>
        this.#request<{ ok: boolean; route: InboundRoute }>('PATCH', `/inbound/routes/${encodeURIComponent(id)}`, { body: input }),
      delete: (id: string) =>
        this.#request<{ ok: boolean; id: string; deleted: boolean }>('DELETE', `/inbound/routes/${encodeURIComponent(id)}`),
    },
    messages: {
      list: (params: { routeId?: string; limit?: number; offset?: number } = {}) =>
        this.#request<{ messages: InboundMessageSummary[]; count: number }>('GET', `/inbound/messages${query(params)}`),
      get: (id: string) =>
        this.#request<{ ok: boolean; message: any }>('GET', `/inbound/messages/${encodeURIComponent(id)}`),
    },
    parse: (input: InboundParseInput) =>
      this.#request<InboundParseResult>('POST', '/inbound/parse', { body: input }),
    simulate: (recipient: string) =>
      this.#request<InboundSimulateResult>('POST', '/inbound/simulate', { body: { recipient } }),
  };

  readonly dmarc = {
    reports: {
      list: (params: { domain?: string; limit?: number; offset?: number } = {}) =>
        this.#request<{ reports: DmarcReportSummary[]; count: number }>('GET', `/dmarc/reports${query(params)}`),
      create: (body: string | Record<string, unknown>) =>
        this.#request<{ ok: boolean; id: string }>('POST', '/dmarc/reports', { body: typeof body === 'string' ? { xml: body } : body }),
      get: (id: string) =>
        this.#request<{ ok: boolean; report: any }>('GET', `/dmarc/reports/${encodeURIComponent(id)}`),
    },
    summary: (domain: string) =>
      this.#request<DmarcDomainSummary>('GET', `/dmarc/domains/${encodeURIComponent(domain)}/summary`),
    threats: () =>
      this.#request<{ ok: boolean; threats: DmarcThreat[] }>('GET', '/dmarc/threats'),
  };

  readonly arbiter = {
    stats: () => this.#request<ArbiterStats>('GET', '/arbiter/stats'),
    cooldowns: {
      set: (recipient: string, durationSeconds: number, reason?: string) =>
        this.#request<CooldownResult>('POST', `/arbiter/recipients/${encodeURIComponent(recipient)}/cooldown`, {
          body: { durationSeconds, reason },
        }),
      clear: (recipient: string) =>
        this.#request<{ ok: boolean; recipient: string; cleared: boolean }>(
          'DELETE', `/arbiter/recipients/${encodeURIComponent(recipient)}/cooldown`),
      status: (recipient: string) =>
        this.#request<CooldownStatus>('GET', `/arbiter/recipients/${encodeURIComponent(recipient)}/status`),
    },
    tickets: {
      create: (recipient: string, reason?: string) =>
        this.#request<{ ok: boolean; recipient: string; ticketId: string }>('POST', '/arbiter/tickets', { body: { recipient, reason } }),
      delete: (recipient: string) =>
        this.#request<{ ok: boolean; recipient: string; resolved: boolean }>('DELETE', `/arbiter/tickets/${encodeURIComponent(recipient)}`),
    },
  };

  readonly inboxes = {
    list: () => this.#request<{ ok: boolean; inboxes: EphemeralInbox[]; count: number }>('GET', '/inboxes'),
    get: (id: string) => this.#request<{ ok: boolean; inbox: EphemeralInbox }>('GET', `/inboxes/${encodeURIComponent(id)}`),
    delete: (id: string) => this.#request<{ ok: boolean; id: string; deleted: boolean }>('DELETE', `/inboxes/${encodeURIComponent(id)}`),
    create: (options: EphemeralInboxCreateInput = {}) =>
      this.#request<{ ok: boolean; inbox: EphemeralInbox }>('POST', '/inboxes/ephemeral', { body: options }),
    createEphemeral: (options: EphemeralInboxCreateInput = {}) =>
      this.#request<{ ok: boolean; inbox: EphemeralInbox }>('POST', '/inboxes/ephemeral', { body: options }),
    otp: (id: string, params: { waitFor?: boolean; timeoutMs?: number; since?: string } = {}) =>
      this.#request<InboxOtpResult>('GET', `/inboxes/${encodeURIComponent(id)}/otp${query(params)}`),
    messages: (id: string) =>
      this.#request<{ ok: boolean; messages: InboxMessage[] }>('GET', `/inboxes/${encodeURIComponent(id)}/messages`),
    streamUrl: (id: string): string =>
      `${this.#baseUrl}/inboxes/${encodeURIComponent(id)}/stream`,
    stream: async (id: string, options?: { signal?: AbortSignal }): Promise<Result<InboxStreamResponse>> => {
      const url = `${this.#baseUrl}/inboxes/${encodeURIComponent(id)}/stream`;
      const headers: Record<string, string> = {
        authorization: `Bearer ${this.#apiKey}`,
        'user-agent': `sadasend-js/${VERSION}`,
        accept: 'text/event-stream',
        ...(this.#agentName ? { 'x-sadasend-agent': this.#agentName } : {}),
        ...(this.#source ? { 'x-sadasend-source': this.#source } : {}),
      };

      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: 'GET',
          headers,
          signal: options?.signal,
        });
      } catch (cause) {
        throw new ConnectionError(
          `Could not reach ${this.#baseUrl} for SSE stream after 1 attempt.`,
          cause,
          1,
        );
      }

      if (!response.ok) {
        const text = await response.text();
        const body = parseJson(text);
        const error = toError(response.status, body, retryAfterSeconds(response));
        return { ok: false, error };
      }

      const body = response.body;
      const data: InboxStreamResponse = {
        url,
        response,
        body,
        [Symbol.asyncIterator]: () => {
          if (!body) {
            return (async function* () {})();
          }
          return parseSseStream(body);
        },
      };

      return { ok: true, data };
    },
    inbound: (input: { to: string; from?: string; subject?: string; text?: string; html?: string }) =>
      this.#request<{ ok: boolean; otp?: string; magicLink?: string }>('POST', '/inboxes/inbound', { body: input }),
  };

  readonly testing = {
    inbound: (input: TestingInboundInput) =>
      this.#request<{ ok: boolean; status: string; id: string }>('POST', '/testing/inbound', { body: input }),
    waitForCode: async (input: WaitForCodeInput): Promise<Result<WaitForCodeResult>> => {
      const r = await this.#request<WaitForCodeResult>('POST', '/testing/wait-for-code', { body: input });
      if (!r.ok) return r;
      const d = r.data as any;
      const code = String(d.code ?? d.otp ?? '');
      const otp = d.otp ?? d.code ?? null;
      return {
        ok: true,
        data: {
          ...d,
          code,
          otp,
        },
      };
    },
    inboxes: {
      code: async (email: string): Promise<Result<{ ok: boolean; code: string; otp?: string }>> => {
        const r = await this.#request<{ ok: boolean; code: string; otp?: string }>('GET', `/testing/inboxes/${encodeURIComponent(email)}/code`);
        if (!r.ok) return r;
        const d = r.data as any;
        const code = String(d.code ?? d.otp ?? '');
        const otp = d.otp ?? d.code ?? undefined;
        return {
          ok: true,
          data: {
            ...d,
            code,
            otp,
          },
        };
      },
      latest: (email: string) =>
        this.#request<{ ok: boolean; message: any }>('GET', `/testing/inboxes/${encodeURIComponent(email)}/latest`),
    },
  };

  readonly integrations = {
    slack: () => this.#request<SlackIntegrationStatus>('GET', '/integrations/slack'),
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

/**
 * Standard WHATWG Server-Sent Events (SSE) stream parser.
 *
 * Runs strictly on native Web streams (`ReadableStream<Uint8Array>`, `TextDecoder`)
 * with zero third-party dependencies across Node.js 18+, Bun, Deno, Cloudflare Workers,
 * Next.js Edge, and browser runtimes.
 */
export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<InboxStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? '';

      let currentEvent = 'message';
      let dataLines: string[] = [];

      for (const line of lines) {
        if (line === '') {
          if (dataLines.length > 0) {
            const rawData = dataLines.join('\n');
            let parsedData: unknown = rawData;
            try {
              parsedData = JSON.parse(rawData);
            } catch {}
            yield { event: currentEvent, data: parsedData } as InboxStreamEvent;
            currentEvent = 'message';
            dataLines = [];
          }
          continue;
        }

        if (line.startsWith(':')) {
          continue;
        }

        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) {
          continue;
        }

        const field = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).replace(/^ /, '');

        if (field === 'event') {
          currentEvent = val;
        } else if (field === 'data') {
          dataLines.push(val);
        }
      }
    }

    if (buffer.trim()) {
      const lines = buffer.split(/\r\n|\r|\n/);
      let currentEvent = 'message';
      let dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
      }
      if (dataLines.length > 0) {
        const rawData = dataLines.join('\n');
        let parsedData: unknown = rawData;
        try {
          parsedData = JSON.parse(rawData);
        } catch {}
        yield { event: currentEvent, data: parsedData } as InboxStreamEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function isModuleNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code === 'ERR_MODULE_NOT_FOUND' || e.code === 'MODULE_NOT_FOUND') {
    return true;
  }
  if (typeof e.message === 'string') {
    const msg = e.message.toLowerCase();
    return (
      msg.includes('cannot find module') ||
      msg.includes('cannot find package') ||
      msg.includes('failed to resolve') ||
      msg.includes('module not found') ||
      msg.includes('could not resolve')
    );
  }
  return false;
}

/**
 * Dynamically renders a React Email component to HTML and plain-text.
 *
 * Supports `@react-email/render` (preferred) or `react-dom/server` fallback.
 * Zero compile-time or runtime dependencies: only loads the renderer if invoked.
 */
export async function renderReactEmail(
  element: ReactEmailElement,
  options?: ReactEmailRenderOptions,
): Promise<RenderedEmail> {
  if (!element) {
    throw new Error('renderReactEmail requires a valid React Email element');
  }

  if (typeof options?.renderer === 'function') {
    const customResult = await options.renderer(element, options);
    if (!customResult || typeof customResult.html !== 'string') {
      throw new Error('Custom React Email renderer must return an object with an "html" string property');
    }
    return customResult;
  }

  // 1. Try importing @react-email/render
  let mod: any = null;
  const reactEmailPkg = '@react-email/render';
  try {
    mod = await import(/* webpackIgnore: true */ /* @vite-ignore */ reactEmailPkg);
  } catch (err: unknown) {
    if (!isModuleNotFoundError(err)) {
      throw err;
    }
  }

  if (mod) {
    const renderFn =
      typeof mod.renderAsync === 'function'
        ? mod.renderAsync
        : typeof mod.render === 'function'
          ? mod.render
          : typeof mod.default?.renderAsync === 'function'
            ? mod.default.renderAsync
            : typeof mod.default?.render === 'function'
              ? mod.default.render
              : null;

    if (renderFn) {
      const html = await renderFn(element, { pretty: options?.pretty });
      let text: string | undefined;
      if (options?.plainText !== false) {
        try {
          text = await renderFn(element, { plainText: true });
        } catch {
          // Plain-text extraction fallback
        }
      }
      return { html, ...(text ? { text } : {}) };
    }
  }

  // 2. Fall back to react-dom/server
  let domMod: any = null;
  const reactDomServerPkg = 'react-dom/server';
  try {
    domMod = await import(/* webpackIgnore: true */ /* @vite-ignore */ reactDomServerPkg);
  } catch (err: unknown) {
    if (!isModuleNotFoundError(err)) {
      throw err;
    }
  }

  if (domMod) {
    const renderFn =
      typeof domMod.renderToStaticMarkup === 'function'
        ? domMod.renderToStaticMarkup
        : typeof domMod.renderToString === 'function'
          ? domMod.renderToString
          : typeof domMod.default?.renderToStaticMarkup === 'function'
            ? domMod.default.renderToStaticMarkup
            : typeof domMod.default?.renderToString === 'function'
              ? domMod.default.renderToString
              : null;

    if (renderFn) {
      const html = await renderFn(element);
      return { html };
    }
  }

  throw new Error(
    "To send emails using the 'react' property, please install '@react-email/render' or 'react-dom': npm install @react-email/render",
  );
}

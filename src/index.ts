/**
 * `sadasend` — the SadaSend client.
 *
 * Zero dependencies, and deliberately so: this is the one package a customer
 * installs, and every dependency it carries is one they audit, resolve and
 * eventually get a CVE notice about. Everything here is `fetch` and WebCrypto,
 * both of which are in Node 18+, Bun, Deno, Cloudflare Workers and the browser.
 */

export { SadaSend } from './client.js';
export type {
  AccountChecklist, AccountInfo, AccountStats, AccountVolume, AccountVolumeDay,
  ApiKeySummary, Attachment, BatchItemResult, BatchResult, ChecklistItem,
  CircuitBreaker, ClientOptions, DeliverabilityTool, HeldApproval,
  Message, MessageStatus, Result, SendInput, SendResult, StaffAccess,
  SupportTicketSummary, TeamMember, TemplateDetail, TemplateSummary,
  WebhookDelivery, WebhookEndpoint,
} from './client.js';

export {
  AuthenticationError, ConnectionError, DomainNotFoundError, DomainNotVerifiedError,
  IdempotencyInProgressError, IdempotencyKeyReusedError, InsufficientScopeError,
  InvalidFromError, RateLimitError, RecipientNotAllowlistedError, RecipientSuppressedError,
  SadaSendError, ServerError, isRetryable,
} from './errors.js';
export type { DnsRecord } from './errors.js';

export { DEFAULT_RETRY } from './retry.js';
export type { RetryPolicy } from './retry.js';

export {
  DEFAULT_TOLERANCE_MS, SIGNATURE_HEADER, parseWebhook, verifyWebhook,
} from './webhooks.js';
export type { VerifyOptions, WebhookEvent, WebhookEventType } from './webhooks.js';

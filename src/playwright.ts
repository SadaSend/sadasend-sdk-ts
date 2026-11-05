/**
 * `sadasend/playwright` — Official Playwright drop-in test fixtures for SadaSend.
 *
 * Ephemeral agent inboxes, reactive zero-polling 2FA OTP streams (<150ms),
 * magic link verification, and automatic test lifecycle cleanup.
 *
 * ```ts
 * import { test, expect } from 'sadasend/playwright';
 *
 * test('user can complete 2FA signup', async ({ page, ephemeralInbox }) => {
 *   await page.goto('https://app.example.com/signup');
 *   await page.fill('#email', ephemeralInbox.email);
 *   await page.click('#submit');
 *
 *   const otp = await ephemeralInbox.waitForOtp();
 *   await page.fill('#otp', otp);
 *   await expect(page.locator('#dashboard')).toBeVisible();
 * });
 * ```
 */

import { test as base, expect } from '@playwright/test';
import {
  SadaSend,
  type EphemeralInbox,
  type EphemeralInboxCreateInput,
  type InboxMessage,
} from './client.js';

export interface EphemeralInboxFixture {
  /** The unique UUID identifier of the ephemeral test inbox. */
  id: string;
  /** The fully-qualified email address (e.g. `agent-xyz@sada.email`). */
  email: string;
  /** The local-part alias of the email address. */
  alias: string;
  /** The inbox domain name. */
  domain: string;
  /** The underlying raw EphemeralInbox object. */
  inbox: EphemeralInbox;
  /**
   * Waits for an OTP verification code via reactive Server-Sent Events stream (<150ms).
   * Falls back to polling if SSE is disconnected.
   */
  waitForOtp(options?: { timeoutMs?: number }): Promise<string>;
  /** Bidirectional alias for `waitForOtp`. */
  waitForCode(options?: { timeoutMs?: number }): Promise<string>;
  /** Waits for an authentication or verification magic link URL from the received email. */
  waitForMagicLink(options?: { timeoutMs?: number }): Promise<string>;
  /** Waits for the next inbound message received by this inbox. */
  waitForMessage(options?: { timeoutMs?: number }): Promise<InboxMessage>;
  /** Lists all inbound messages received by this inbox so far. */
  getMessages(): Promise<InboxMessage[]>;
}

export type SadaSendTestOptions = {
  /** API key override. Defaults to `process.env.SADASEND_API_KEY` or `process.env.SADASEND_TEST_API_KEY`. */
  apiKey?: string;
  /** Base URL override. Defaults to `process.env.SADASEND_BASE_URL` or `https://api.sadasend.com`. */
  baseUrl?: string;
  /** Default TTL in seconds for ephemeral inboxes (defaults to 300 = 5 minutes). */
  defaultInboxTtlSeconds?: number;
  /** Custom domain for ephemeral test inboxes. */
  inboxDomain?: string;
};

export type SadaSendFixtures = {
  /** Configurable options for the SadaSend Playwright fixtures. */
  sadasendOptions: SadaSendTestOptions;
  /** Authenticated SadaSend client instance. */
  sadasend: SadaSend;
  /**
   * Factory to create additional isolated ephemeral inboxes during a test.
   * All created inboxes are automatically destroyed during test teardown.
   */
  createInbox: (options?: EphemeralInboxCreateInput) => Promise<EphemeralInboxFixture>;
  /**
   * Pre-provisioned isolated ephemeral inbox for the current test.
   * Automatically created before the test runs and deleted during teardown.
   */
  ephemeralInbox: EphemeralInboxFixture;
};

const getEnv = (key: string): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];

async function waitForOtpFromInbox(
  client: SadaSend,
  inboxId: string,
  email: string,
  timeoutMs: number = 30_000,
): Promise<string> {
  // 1. Check if an OTP was already captured before this call
  try {
    const existing = await client.inboxes.otp(inboxId);
    if (existing.ok) {
      const code = existing.data.code ?? existing.data.otp;
      if (code && !existing.data.pending) return code;
    }
  } catch {}

  // 2. Stream real-time SSE events (<150ms push latency)
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const streamRes = await client.inboxes.stream(inboxId, { signal: controller.signal });
    if (streamRes.ok) {
      for await (const event of streamRes.data) {
        if (event.event === 'otp') {
          const otpData = event.data as { otp?: string; code?: string };
          const code = otpData.code ?? otpData.otp;
          if (code) {
            clearTimeout(timer);
            return code;
          }
        }
        if (event.event === 'message') {
          const msg = event.data as InboxMessage;
          if (msg.otp) {
            clearTimeout(timer);
            return msg.otp;
          }
        }
      }
    }
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out waiting for OTP on inbox ${email} (${inboxId}) after ${timeoutMs}ms`);
    }
  } finally {
    clearTimeout(timer);
  }

  // 3. Fallback: call testing.waitForCode with remaining time
  try {
    const fallback = await client.testing.waitForCode({
      to: email,
      timeoutMs: Math.min(timeoutMs, 5_000),
    });
    if (fallback.ok && fallback.data.code) {
      return fallback.data.code;
    }
  } catch {}

  throw new Error(`Timed out waiting for OTP on inbox ${email} (${inboxId}) after ${timeoutMs}ms`);
}

async function waitForMagicLinkFromInbox(
  client: SadaSend,
  inboxId: string,
  email: string,
  timeoutMs: number = 30_000,
): Promise<string> {
  // 1. Check existing messages first
  try {
    const existing = await client.inboxes.otp(inboxId);
    if (existing.ok && existing.data.magicLink) {
      return existing.data.magicLink;
    }
  } catch {}

  // 2. Stream real-time SSE events
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const streamRes = await client.inboxes.stream(inboxId, { signal: controller.signal });
    if (streamRes.ok) {
      for await (const event of streamRes.data) {
        if (event.event === 'otp') {
          const otpData = event.data as { magicLink?: string | null };
          if (otpData.magicLink) {
            clearTimeout(timer);
            return otpData.magicLink;
          }
        }
        if (event.event === 'message') {
          const msg = event.data as InboxMessage;
          if (msg.magicLink) {
            clearTimeout(timer);
            return msg.magicLink;
          }
        }
      }
    }
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out waiting for magic link on inbox ${email} (${inboxId}) after ${timeoutMs}ms`);
    }
  } finally {
    clearTimeout(timer);
  }

  // 3. Fallback: check messages list
  try {
    const msgs = await client.inboxes.messages(inboxId);
    if (msgs.ok && msgs.data.messages.length > 0) {
      for (const m of msgs.data.messages) {
        if (m.magicLink) return m.magicLink;
      }
    }
  } catch {}

  throw new Error(`Timed out waiting for magic link on inbox ${email} (${inboxId}) after ${timeoutMs}ms`);
}

async function waitForMessageFromInbox(
  client: SadaSend,
  inboxId: string,
  email: string,
  timeoutMs: number = 30_000,
): Promise<InboxMessage> {
  // 1. Check existing messages
  try {
    const existing = await client.inboxes.messages(inboxId);
    if (existing.ok && existing.data.messages.length > 0) {
      return existing.data.messages[0];
    }
  } catch {}

  // 2. Stream real-time SSE events
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const streamRes = await client.inboxes.stream(inboxId, { signal: controller.signal });
    if (streamRes.ok) {
      for await (const event of streamRes.data) {
        if (event.event === 'message') {
          clearTimeout(timer);
          return event.data as InboxMessage;
        }
      }
    }
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out waiting for message on inbox ${email} (${inboxId}) after ${timeoutMs}ms`);
    }
  } finally {
    clearTimeout(timer);
  }

  throw new Error(`Timed out waiting for message on inbox ${email} (${inboxId}) after ${timeoutMs}ms`);
}

export function createInboxFixture(
  client: SadaSend,
  inboxData: EphemeralInbox,
): EphemeralInboxFixture {
  return {
    id: inboxData.id,
    email: inboxData.email,
    alias: inboxData.alias,
    domain: inboxData.domain,
    inbox: inboxData,
    waitForOtp: (options) => waitForOtpFromInbox(client, inboxData.id, inboxData.email, options?.timeoutMs),
    waitForCode: (options) => waitForOtpFromInbox(client, inboxData.id, inboxData.email, options?.timeoutMs),
    waitForMagicLink: (options) => waitForMagicLinkFromInbox(client, inboxData.id, inboxData.email, options?.timeoutMs),
    waitForMessage: (options) => waitForMessageFromInbox(client, inboxData.id, inboxData.email, options?.timeoutMs),
    getMessages: async () => {
      const res = await client.inboxes.messages(inboxData.id);
      return res.ok ? res.data.messages : [];
    },
  };
}

/**
 * SadaSend Playwright fixtures definition.
 * Can be passed to `base.extend(sadasendFixtures)` to extend custom test runners.
 */
export const sadasendFixtures = {
  sadasendOptions: [{}, { option: true }] as [SadaSendTestOptions, { option: true }],

  sadasend: async (
    { sadasendOptions }: { sadasendOptions: SadaSendTestOptions },
    use: (r: SadaSend) => Promise<void>,
  ) => {
    const apiKey =
      sadasendOptions.apiKey ??
      getEnv('SADASEND_API_KEY') ??
      getEnv('SADASEND_TEST_API_KEY') ??
      'sada_test_sk_playwright_fixture';
    const baseUrl = sadasendOptions.baseUrl ?? getEnv('SADASEND_BASE_URL');

    const client = new SadaSend({
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
    });
    await use(client);
  },

  createInbox: async (
    { sadasend, sadasendOptions }: { sadasend: SadaSend; sadasendOptions: SadaSendTestOptions },
    use: (factory: (options?: EphemeralInboxCreateInput) => Promise<EphemeralInboxFixture>) => Promise<void>,
  ) => {
    const createdIds: string[] = [];

    const factory = async (options?: EphemeralInboxCreateInput): Promise<EphemeralInboxFixture> => {
      const res = await sadasend.inboxes.create({
        ttlSeconds: options?.ttlSeconds ?? sadasendOptions.defaultInboxTtlSeconds ?? 300,
        domain: options?.domain ?? sadasendOptions.inboxDomain,
        alias: options?.alias,
        description: options?.description ?? 'Playwright test ephemeral inbox',
        metadata: options?.metadata,
      });

      if (!res.ok) {
        throw new Error(`Failed to create ephemeral test inbox: ${res.error.message}`);
      }

      createdIds.push(res.data.inbox.id);
      return createInboxFixture(sadasend, res.data.inbox);
    };

    await use(factory);

    // Teardown: delete all ephemeral inboxes created during this test execution
    await Promise.allSettled(
      createdIds.map(async (id) => {
        try {
          await sadasend.inboxes.delete(id);
        } catch {}
      }),
    );
  },

  ephemeralInbox: async (
    { createInbox }: { createInbox: (options?: EphemeralInboxCreateInput) => Promise<EphemeralInboxFixture> },
    use: (inbox: EphemeralInboxFixture) => Promise<void>,
  ) => {
    const inbox = await createInbox();
    await use(inbox);
  },
};

/**
 * Drop-in Playwright test runner extended with SadaSend fixtures.
 */
export const test = base.extend<SadaSendFixtures>(sadasendFixtures);

export { expect };

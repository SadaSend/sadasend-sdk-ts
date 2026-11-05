import { describe, expect, test } from "bun:test";
import { SadaSend } from "../src/client.js";
import {
  createInboxFixture,
  sadasendFixtures,
  test as playwrightTest,
  expect as playwrightExpect,
} from "../src/playwright.js";

type Scripted = { status: number; body?: unknown; headers?: Record<string, string> };

function createMockClient(handler: (url: string, method: string, body?: any) => Scripted) {
  const calls: { url: string; method: string; body?: any; headers?: Record<string, string> }[] = [];
  const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const rawBody = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      url: String(url),
      method: init.method || "GET",
      body: rawBody,
      headers: (init.headers as Record<string, string>) || {},
    });
    const res = handler(String(url), init.method || "GET", rawBody);
    const isSse = res.headers?.["content-type"] === "text/event-stream";
    return new Response(res.body === undefined ? "" : isSse ? String(res.body) : JSON.stringify(res.body), {
      status: res.status,
      headers: { "content-type": isSse ? "text/event-stream" : "application/json", ...res.headers },
    });
  }) as unknown as typeof globalThis.fetch;

  const sdk = new SadaSend("sada_live_sk_fixture_test", {
    baseUrl: "http://api.test",
    fetch: fn,
  });

  return { sdk, calls };
}

describe("SadaSend Playwright Drop-in Test Fixtures (sadasend/playwright)", () => {
  const dummyInbox = {
    id: "inbox_pw_123",
    email: "test-agent@sada.email",
    alias: "test-agent",
    domain: "sada.email",
    ttlSeconds: 300,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    messageCount: 0,
  };

  test("fixture exports drop-in test runner and expect", () => {
    expect(typeof playwrightTest).toBe("function");
    expect(typeof playwrightTest.extend).toBe("function");
    expect(typeof playwrightExpect).toBe("function");
    expect(sadasendFixtures).toBeDefined();
    expect(typeof sadasendFixtures.sadasend).toBe("function");
    expect(typeof sadasendFixtures.createInbox).toBe("function");
    expect(typeof sadasendFixtures.ephemeralInbox).toBe("function");
  });

  test("waitForOtp returns existing code immediately without polling", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.includes("/inboxes/inbox_pw_123/otp") && method === "GET") {
        return {
          status: 200,
          body: {
            ok: true,
            inboxId: "inbox_pw_123",
            email: "test-agent@sada.email",
            code: "847291",
            otp: "847291",
            pending: false,
          },
        };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const fixture = createInboxFixture(sdk, dummyInbox);
    const code = await fixture.waitForOtp({ timeoutMs: 1000 });

    expect(code).toBe("847291");
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain("/inboxes/inbox_pw_123/otp");
  });

  test("waitForCode aliases waitForOtp and returns code", async () => {
    const { sdk } = createMockClient((url, method) => {
      if (url.includes("/inboxes/inbox_pw_123/otp") && method === "GET") {
        return {
          status: 200,
          body: {
            ok: true,
            inboxId: "inbox_pw_123",
            email: "test-agent@sada.email",
            code: "123456",
            pending: false,
          },
        };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const fixture = createInboxFixture(sdk, dummyInbox);
    const code = await fixture.waitForCode({ timeoutMs: 1000 });
    expect(code).toBe("123456");
  });

  test("waitForOtp resolves code via reactive SSE stream (<150ms)", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.includes("/inboxes/inbox_pw_123/otp") && method === "GET") {
        return {
          status: 200,
          body: {
            ok: true,
            inboxId: "inbox_pw_123",
            email: "test-agent@sada.email",
            pending: true,
          },
        };
      }
      if (url.endsWith("/inboxes/inbox_pw_123/stream") && method === "GET") {
        const sseBody = [
          'event: connected\ndata: {"ok":true,"inboxId":"inbox_pw_123"}\n\n',
          'event: otp\ndata: {"inboxId":"inbox_pw_123","otp":"998877","code":"998877"}\n\n',
        ].join("");
        return {
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body: sseBody,
        };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const fixture = createInboxFixture(sdk, dummyInbox);
    const code = await fixture.waitForOtp({ timeoutMs: 2000 });

    expect(code).toBe("998877");
    // Verified it checked existing cache, then connected to the zero-polling reactive SSE stream
    expect(calls.some((c) => c.url.endsWith("/stream"))).toBe(true);
  });

  test("waitForMagicLink returns existing link or resolves via stream", async () => {
    const { sdk } = createMockClient((url, method) => {
      if (url.includes("/inboxes/inbox_pw_123/otp") && method === "GET") {
        return {
          status: 200,
          body: {
            ok: true,
            inboxId: "inbox_pw_123",
            email: "test-agent@sada.email",
            magicLink: "https://app.example.com/verify?token=abc_xyz_123",
          },
        };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const fixture = createInboxFixture(sdk, dummyInbox);
    const link = await fixture.waitForMagicLink({ timeoutMs: 1000 });
    expect(link).toBe("https://app.example.com/verify?token=abc_xyz_123");
  });

  test("waitForMessage resolves incoming message", async () => {
    const { sdk } = createMockClient((url, method) => {
      if (url.includes("/inboxes/inbox_pw_123/messages") && method === "GET") {
        return {
          status: 200,
          body: {
            ok: true,
            messages: [
              {
                id: "msg_inbound_1",
                from: "security@company.com",
                subject: "Your single-use sign-in code",
                receivedAt: new Date().toISOString(),
                otp: "554433",
              },
            ],
          },
        };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const fixture = createInboxFixture(sdk, dummyInbox);
    const msg = await fixture.waitForMessage({ timeoutMs: 1000 });

    expect(msg.id).toBe("msg_inbound_1");
    expect(msg.from).toBe("security@company.com");
    expect(msg.otp).toBe("554433");
  });

  test("waitForOtp throws descriptive timeout when no message arrives", async () => {
    const { sdk } = createMockClient((url, method) => {
      if (url.includes("/inboxes/inbox_pw_123/otp") && method === "GET") {
        return {
          status: 200,
          body: {
            ok: true,
            inboxId: "inbox_pw_123",
            email: "test-agent@sada.email",
            pending: true,
          },
        };
      }
      if (url.endsWith("/stream") && method === "GET") {
        // SSE connection stays quiet
        return {
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body: 'event: connected\ndata: {"ok":true}\n\n',
        };
      }
      if (url.endsWith("/wait-for-code") && method === "POST") {
        return { status: 408, body: { error: "timeout" } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const fixture = createInboxFixture(sdk, dummyInbox);
    expect(fixture.waitForOtp({ timeoutMs: 50 })).rejects.toThrow(
      "Timed out waiting for OTP on inbox test-agent@sada.email"
    );
  });

  test("createInbox fixture teardown automatically cleans up created inboxes", async () => {
    const deletedIds: string[] = [];
    const { sdk } = createMockClient((url, method) => {
      if (url.endsWith("/inboxes/ephemeral") && method === "POST") {
        return {
          status: 201,
          body: {
            ok: true,
            inbox: {
              id: "inbox_auto_clean_1",
              email: "auto@sada.email",
              alias: "auto",
              domain: "sada.email",
              ttlSeconds: 300,
            },
          },
        };
      }
      if (url.includes("/inboxes/inbox_auto_clean_1") && method === "DELETE") {
        deletedIds.push("inbox_auto_clean_1");
        return { status: 200, body: { ok: true, deleted: true, id: "inbox_auto_clean_1" } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    let capturedInbox: any = null;

    // Simulate Playwright fixture execution: createInbox -> use -> teardown
    await sadasendFixtures.createInbox(
      { sadasend: sdk, sadasendOptions: {} },
      async (factory) => {
        capturedInbox = await factory();
        expect(capturedInbox.id).toBe("inbox_auto_clean_1");
        expect(capturedInbox.email).toBe("auto@sada.email");
        expect(deletedIds.length).toBe(0);
      }
    );

    // After the block exits, teardown must have executed DELETE on the inbox
    expect(deletedIds).toEqual(["inbox_auto_clean_1"]);
  });
});


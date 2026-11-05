import { describe, expect, test } from "bun:test";
import { SadaSend, renderReactEmail } from "../src/index.js";

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
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { "content-type": "application/json", ...res.headers },
    });
  }) as unknown as typeof globalThis.fetch;

  const sdk = new SadaSend("sada_live_sk_react_test", {
    baseUrl: "http://api.test",
    fetch: fn,
  });

  return { sdk, calls };
}

describe("First-Class React Email Rendering Support", () => {
  test("renderReactEmail throws descriptive error when element is missing", async () => {
    expect(renderReactEmail(null as any)).rejects.toThrow(
      "renderReactEmail requires a valid React Email element"
    );
  });

  test("renderReactEmail throws clear installation guidance when no renderer is installed", async () => {
    const dummyElement = { type: "div", props: { children: "Hello World" } };
    expect(renderReactEmail(dummyElement)).rejects.toThrow(
      "To send emails using the 'react' property, please install '@react-email/render' or 'react-dom': npm install @react-email/render"
    );
  });

  test("renderReactEmail respects custom renderer and returns rendered HTML and text", async () => {
    const dummyElement = { type: "div", props: { name: "Alex" } };
    const rendered = await renderReactEmail(dummyElement, {
      renderer: (el) => ({
        html: `<h1>Welcome ${(el as any).props.name}</h1>`,
        text: `Welcome ${(el as any).props.name}`,
      }),
    });

    expect(rendered.html).toBe("<h1>Welcome Alex</h1>");
    expect(rendered.text).toBe("Welcome Alex");
  });

  test("emails.send renders react component and sends HTML + text over the wire", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.endsWith("/emails") && method === "POST") {
        return { status: 200, body: { id: "msg_react_123", status: "queued" } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const dummyComponent = { type: "WelcomeEmail", props: { user: "Sara" } };

    const res = await sdk.emails.send({
      from: "noreply@example.com",
      to: "sara@example.com",
      subject: "Welcome to SadaSend",
      react: dummyComponent,
      reactRenderOptions: {
        renderer: (el) => ({
          html: `<p>Hello ${(el as any).props.user}</p>`,
          text: `Hello ${(el as any).props.user}`,
        }),
      },
    });

    expect(res.ok).toBe(true);
    expect(calls.length).toBe(1);
    const sentBody = calls[0].body;

    // Must populate html and text
    expect(sentBody.html).toBe("<p>Hello Sara</p>");
    expect(sentBody.text).toBe("Hello Sara");
    expect(sentBody.from).toBe("noreply@example.com");
    expect(sentBody.to).toEqual(["sara@example.com"]);

    // Must NOT leak in-memory react elements into the wire payload
    expect(sentBody.react).toBeUndefined();
    expect(sentBody.reactRenderOptions).toBeUndefined();
  });

  test("emails.send respects explicit html and does not call renderer", async () => {
    let rendererCalled = false;
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.endsWith("/emails") && method === "POST") {
        return { status: 200, body: { id: "msg_react_124", status: "queued" } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const res = await sdk.emails.send({
      from: "noreply@example.com",
      to: "sara@example.com",
      subject: "Explicit HTML Wins",
      html: "<strong>Pre-rendered HTML</strong>",
      react: { type: "div" },
      reactRenderOptions: {
        renderer: () => {
          rendererCalled = true;
          return { html: "<p>Should not be called</p>" };
        },
      },
    });

    expect(res.ok).toBe(true);
    expect(rendererCalled).toBe(false);
    expect(calls[0].body.html).toBe("<strong>Pre-rendered HTML</strong>");
    expect(calls[0].body.react).toBeUndefined();
  });

  test("emails.send respects explicit text while rendering html from react", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.endsWith("/emails") && method === "POST") {
        return { status: 200, body: { id: "msg_react_125", status: "queued" } };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const res = await sdk.emails.send({
      from: "noreply@example.com",
      to: "sara@example.com",
      subject: "Custom Text Preserved",
      text: "Custom plain text override",
      react: { type: "div" },
      reactRenderOptions: {
        renderer: () => ({
          html: "<p>Rendered HTML</p>",
          text: "Generated plain text",
        }),
      },
    });

    expect(res.ok).toBe(true);
    expect(calls[0].body.html).toBe("<p>Rendered HTML</p>");
    expect(calls[0].body.text).toBe("Custom plain text override");
  });

  test("emails.batch renders react components for each item", async () => {
    const { sdk, calls } = createMockClient((url, method) => {
      if (url.endsWith("/emails/batch") && method === "POST") {
        return {
          status: 207,
          body: {
            total: 2,
            accepted: 2,
            refused: 0,
            results: [
              { ok: true, id: "batch_1", index: 0 },
              { ok: true, id: "batch_2", index: 1 },
            ],
          },
        };
      }
      return { status: 404, body: { error: "not_found" } };
    });

    const res = await sdk.emails.batch([
      {
        from: "noreply@example.com",
        to: "user1@example.com",
        subject: "Welcome 1",
        react: { type: "Component", props: { id: 1 } },
        reactRenderOptions: {
          renderer: (el) => ({
            html: `<p>User ${(el as any).props.id}</p>`,
            text: `User ${(el as any).props.id}`,
          }),
        },
      },
      {
        from: "noreply@example.com",
        to: "user2@example.com",
        subject: "Welcome 2",
        html: "<p>Already HTML</p>",
      },
    ]);

    expect(res.ok).toBe(true);
    expect(calls.length).toBe(1);
    const emails = calls[0].body.emails;
    expect(emails.length).toBe(2);

    expect(emails[0].html).toBe("<p>User 1</p>");
    expect(emails[0].text).toBe("User 1");
    expect(emails[0].react).toBeUndefined();

    expect(emails[1].html).toBe("<p>Already HTML</p>");
  });
});


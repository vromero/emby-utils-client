/**
 * Retry/timeout behaviour tests. These use MSW to simulate transient failures
 * and validate the client's retry policy without introducing real delays.
 */
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { EmbyClient } from "../src/emby-client.js";
import { EMBY_API_KEY, EMBY_HOST, server } from "./setup.js";
import "./setup.js";

function makeClient(overrides: Partial<ConstructorParameters<typeof EmbyClient>[2]> = {}) {
  return new EmbyClient(EMBY_HOST, EMBY_API_KEY, {
    retryBaseDelayMs: 1, // keep tests fast
    ...overrides,
  });
}

describe("EmbyClient - retry policy", () => {
  it("retries a GET on 503 and eventually succeeds", async () => {
    let calls = 0;
    server.use(
      http.get(`${EMBY_HOST}/emby/Flaky`, () => {
        calls++;
        if (calls < 3) return HttpResponse.json({}, { status: 503 });
        return HttpResponse.json({ ok: true });
      })
    );
    const client = makeClient({ retries: 3 });
    const res = await client.get<{ ok: boolean }>("/Flaky");
    expect(res.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("does not retry a POST by default", async () => {
    let calls = 0;
    server.use(
      http.post(`${EMBY_HOST}/emby/Flaky`, () => {
        calls++;
        return HttpResponse.json({}, { status: 503 });
      })
    );
    const client = makeClient();
    await expect(client.post("/Flaky")).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("does not retry 4xx client errors", async () => {
    let calls = 0;
    server.use(
      http.get(`${EMBY_HOST}/emby/Missing`, () => {
        calls++;
        return HttpResponse.json({}, { status: 404 });
      })
    );
    const client = makeClient({ retries: 3 });
    await expect(client.get("/Missing")).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("retries 429 Too Many Requests", async () => {
    let calls = 0;
    server.use(
      http.get(`${EMBY_HOST}/emby/Throttled`, () => {
        calls++;
        if (calls < 2) return HttpResponse.json({}, { status: 429 });
        return HttpResponse.json({ ok: true });
      })
    );
    const client = makeClient({ retries: 3 });
    const res = await client.get<{ ok: boolean }>("/Throttled");
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("stops retrying after the configured limit", async () => {
    let calls = 0;
    server.use(
      http.get(`${EMBY_HOST}/emby/Dead`, () => {
        calls++;
        return HttpResponse.json({}, { status: 500 });
      })
    );
    const client = makeClient({ retries: 2 });
    await expect(client.get("/Dead")).rejects.toThrow();
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  it("per-request `retries` override wins over client default", async () => {
    let calls = 0;
    server.use(
      http.get(`${EMBY_HOST}/emby/Special`, () => {
        calls++;
        return HttpResponse.json({}, { status: 500 });
      })
    );
    const client = makeClient({ retries: 5 });
    await expect(client.request("GET", "/Special", { retries: 0 })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

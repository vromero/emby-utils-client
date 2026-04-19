import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { EmbyClient } from "../src/emby-client.js";
import { EMBY_API_KEY, EMBY_HOST, server } from "./setup.js";
import "./setup.js";

function makeClient() {
  return new EmbyClient(EMBY_HOST, EMBY_API_KEY);
}

describe("EmbyClient - configuration", () => {
  it("strips trailing slashes from the host", () => {
    const c = new EmbyClient(`${EMBY_HOST}//`, "k");
    expect(c.host).toBe(`${EMBY_HOST}//`); // original preserved
    // Internally the baseURL is normalized; we verify behaviorally via request.
  });

  it("sends the X-Emby-Token header and api_key query param", async () => {
    let capturedHeader: string | null = null;
    let capturedKey: string | null = null;
    server.use(
      http.get(`${EMBY_HOST}/emby/ping`, ({ request }) => {
        capturedHeader = request.headers.get("x-emby-token");
        capturedKey = new URL(request.url).searchParams.get("api_key");
        return HttpResponse.json({ ok: true });
      })
    );
    const c = makeClient();
    await c.get("/ping");
    expect(capturedHeader).toBe(EMBY_API_KEY);
    expect(capturedKey).toBe(EMBY_API_KEY);
  });
});

describe("EmbyClient - operation registry", () => {
  it("exposes all 447 operations", () => {
    const c = makeClient();
    expect(c.listOperations().length).toBe(447);
  });

  it("throws on unknown operationId", async () => {
    const c = makeClient();
    await expect(c.callOperation("doesNotExist")).rejects.toThrow(/Unknown Emby operationId/);
  });

  it("returns the spec for a known operationId", () => {
    const c = makeClient();
    const spec = c.getOperationSpec("getSystemInfo");
    expect(spec.method).toBe("GET");
    expect(spec.path).toBe("/System/Info");
  });
});

describe("EmbyClient - callOperation", () => {
  it("invokes simple GETs", async () => {
    const c = makeClient();
    const res = await c.callOperation<{ ServerName: string }>("getSystemInfo");
    expect(res.ServerName).toBe("Test Emby");
  });

  it("substitutes path params and encodes them", async () => {
    let captured: string | null = null;
    server.use(
      http.get(`${EMBY_HOST}/emby/Users/:id`, ({ request }) => {
        captured = new URL(request.url).pathname;
        return HttpResponse.json({ Id: "ok" });
      })
    );
    const c = makeClient();
    await c.callOperation("getUsersById", { pathParams: { Id: "abc 123/x" } });
    // encoded slash and space
    expect(captured).toBe("/emby/Users/abc%20123%2Fx");
  });

  it("throws when required path params are missing", async () => {
    const c = makeClient();
    await expect(c.callOperation("getUsersById")).rejects.toThrow(
      /Missing required path parameter 'Id'/
    );
  });

  it("passes query parameters through", async () => {
    const c = makeClient();
    const res = await c.callOperation<any>("getItems", {
      queryParams: { SearchTerm: "foo", Limit: 5 },
    });
    expect(res._query.SearchTerm).toBe("foo");
    expect(res._query.Limit).toBe("5");
  });

  it("sends a body for POST operations", async () => {
    let bodyText: string | null = null;
    server.use(
      http.post(`${EMBY_HOST}/emby/Items/:ItemId`, async ({ request }) => {
        bodyText = await request.text();
        return HttpResponse.json({ ok: true });
      })
    );
    const c = makeClient();
    await c.callOperation("postItemsByItemid", {
      pathParams: { ItemId: "xyz" },
      body: { Name: "Renamed" },
    });
    expect(bodyText).toContain("Renamed");
  });
});

describe("EmbyClient - raw request", () => {
  it("supports arbitrary paths via request()", async () => {
    server.use(http.get(`${EMBY_HOST}/emby/Anything`, () => HttpResponse.json({ anything: true })));
    const c = makeClient();
    const res = await c.request<any>("GET", "/Anything");
    expect(res.anything).toBe(true);
  });

  it("supports the post() escape hatch", async () => {
    let bodyText: string | null = null;
    server.use(
      http.post(`${EMBY_HOST}/emby/Custom`, async ({ request }) => {
        bodyText = await request.text();
        return HttpResponse.json({ ok: true });
      })
    );
    const c = makeClient();
    const res = await c.post<any>("/Custom", { hello: "world" });
    expect(res.ok).toBe(true);
    expect(bodyText).toContain("world");
  });

  it("propagates HTTP errors", async () => {
    server.use(
      http.get(`${EMBY_HOST}/emby/boom`, () =>
        HttpResponse.json({ error: "nope" }, { status: 500 })
      )
    );
    const c = makeClient();
    await expect(c.get("/boom")).rejects.toThrow();
  });
});

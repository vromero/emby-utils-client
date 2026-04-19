/**
 * Coverage test: exercises a representative operation from each major Emby
 * service tag to ensure the generated registry can dispatch them correctly.
 * MSW handlers catch-all any request under /emby/* to keep the test stable
 * even as the spec evolves.
 */
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { EmbyClient } from "../src/emby-client.js";
import { operations } from "../src/generated/operations.js";
import { EMBY_API_KEY, EMBY_HOST, server } from "./setup.js";
import "./setup.js";

interface Probe {
  operationId: string;
  args?: {
    pathParams?: Record<string, string | number>;
    queryParams?: Record<string, any>;
    body?: any;
  };
}

const PROBES: Probe[] = [
  // SystemService
  { operationId: "getSystemInfo" },
  { operationId: "getSystemInfoPublic" },
  // UserService
  { operationId: "getUsers" },
  { operationId: "getUsersById", args: { pathParams: { Id: "u1" } } },
  // LibraryService
  { operationId: "getLibraryVirtualfolders" },
  // SessionsService
  { operationId: "getSessions" },
  // PluginService
  { operationId: "getPlugins" },
  // ItemsService
  { operationId: "getItems", args: { queryParams: { Limit: 1 } } },
  { operationId: "getItemsCounts" },
  // DeviceService
  { operationId: "getDevices" },
  // LiveTvService - one of the lightweight ones
  { operationId: "getLivetvInfo" },
  // ScheduledTaskService
  { operationId: "getScheduledtasks" },
  // NotificationsService
  { operationId: "getNotificationsTypes" },
];

/** Catch-all handler: returns a 200 JSON response echoing the URL. */
function installCatchAll() {
  server.use(
    http.all(`${EMBY_HOST}/emby/*`, ({ request }) => {
      const u = new URL(request.url);
      return HttpResponse.json({
        _echoed: true,
        method: request.method,
        path: u.pathname,
        query: Object.fromEntries(u.searchParams.entries()),
      });
    })
  );
}

describe("Operation registry coverage", () => {
  it("all probed operationIds exist in the registry", () => {
    for (const p of PROBES) {
      expect(operations[p.operationId], p.operationId).toBeDefined();
    }
  });

  it.each(PROBES)("can dispatch $operationId", async ({ operationId, args }) => {
    installCatchAll();
    const client = new EmbyClient(EMBY_HOST, EMBY_API_KEY);
    const res = await client.callOperation<any>(operationId, args);
    expect(res._echoed).toBe(true);

    const spec = operations[operationId];
    expect(res.method).toBe(spec.method);
    // Path with params substituted must match the expected one
    let expectedPath = "/emby" + spec.path;
    if (args?.pathParams) {
      for (const [k, v] of Object.entries(args.pathParams)) {
        expectedPath = expectedPath.replace(`{${k}}`, encodeURIComponent(String(v)));
      }
    }
    expect(res.path).toBe(expectedPath);
  });
});

describe("Operation registry structure", () => {
  it("every operation has a valid method and path", () => {
    for (const [id, op] of Object.entries(operations)) {
      expect(op.method, id).toMatch(/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|TRACE)$/);
      expect(op.path.startsWith("/"), id).toBe(true);
    }
  });

  it("most operations capture declared path params (tolerant: Emby spec omits a handful)", () => {
    let missing = 0;
    let total = 0;
    for (const [, op] of Object.entries(operations)) {
      const placeholders = [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      for (const ph of placeholders) {
        total++;
        if (!op.pathParams.find((p) => p.name === ph)) missing++;
      }
    }
    // Ensure the vast majority are correctly captured; the Emby spec has a
    // small number of placeholders with no matching parameter metadata.
    expect(missing / total).toBeLessThan(0.02);
  });
});

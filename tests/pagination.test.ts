import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { EmbyClient } from "../src/emby-client.js";
import { EMBY_API_KEY, EMBY_HOST, server } from "./setup.js";
import "./setup.js";

/**
 * Simulate a paginated endpoint: returns `Items` sliced by `StartIndex` and
 * `Limit` with a stable `TotalRecordCount`.
 */
function installPagedItems(total: number) {
  server.use(
    http.get(`${EMBY_HOST}/emby/Items`, ({ request }) => {
      const url = new URL(request.url);
      const start = parseInt(url.searchParams.get("StartIndex") ?? "0", 10);
      const limit = parseInt(url.searchParams.get("Limit") ?? "100", 10);
      const end = Math.min(start + limit, total);
      const Items = [];
      for (let i = start; i < end; i++) Items.push({ Id: `item-${i}`, Index: i });
      return HttpResponse.json({ Items, TotalRecordCount: total });
    })
  );
}

describe("EmbyClient - paginate()", () => {
  it("yields every item across pages", async () => {
    installPagedItems(23);
    const client = new EmbyClient(EMBY_HOST, EMBY_API_KEY);
    const ids: string[] = [];
    for await (const item of client.paginate<{ Id: string }>("getItems", { pageSize: 10 })) {
      ids.push(item.Id);
    }
    expect(ids).toHaveLength(23);
    expect(ids[0]).toBe("item-0");
    expect(ids[22]).toBe("item-22");
  });

  it("handles an exact page boundary", async () => {
    installPagedItems(20);
    const client = new EmbyClient(EMBY_HOST, EMBY_API_KEY);
    let count = 0;
    for await (const _ of client.paginate("getItems", { pageSize: 10 })) count++;
    expect(count).toBe(20);
  });

  it("handles an empty result set", async () => {
    installPagedItems(0);
    const client = new EmbyClient(EMBY_HOST, EMBY_API_KEY);
    const items = [];
    for await (const item of client.paginate("getItems", { pageSize: 10 })) items.push(item);
    expect(items).toHaveLength(0);
  });

  it("forwards additional queryParams on every page", async () => {
    const seenTerms = new Set<string>();
    server.use(
      http.get(`${EMBY_HOST}/emby/Items`, ({ request }) => {
        const u = new URL(request.url);
        seenTerms.add(u.searchParams.get("SearchTerm") ?? "");
        return HttpResponse.json({ Items: [], TotalRecordCount: 0 });
      })
    );
    const client = new EmbyClient(EMBY_HOST, EMBY_API_KEY);
    for await (const _ of client.paginate("getItems", { queryParams: { SearchTerm: "matrix" } })) {
      // consume
    }
    expect(seenTerms.has("matrix")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { EmbyClient } from "../src/emby-client.js";
import { EMBY_API_KEY, EMBY_HOST, server } from "./setup.js";
import "./setup.js";

describe("EmbyClient - streaming", () => {
  it("returns a stream for binary operations", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    server.use(
      http.get(`${EMBY_HOST}/emby/Items/:id/Images/:type`, () =>
        HttpResponse.arrayBuffer(bytes.buffer, {
          headers: { "Content-Type": "image/png" },
        })
      )
    );
    const client = new EmbyClient(EMBY_HOST, EMBY_API_KEY);
    const stream = await client.stream("getItemsByIdImagesByType", {
      pathParams: { Id: "abc", Type: "Primary" },
    });
    const chunks: Buffer[] = [];
    for await (const chunk of stream as any) {
      chunks.push(Buffer.from(chunk));
    }
    const combined = Buffer.concat(chunks);
    expect(combined.length).toBeGreaterThan(0);
    expect(combined[0]).toBe(0x89);
  });
});

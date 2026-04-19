import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { EmbyClient } from "../src/emby-client.js";
import { EMBY_HOST, server } from "./setup.js";
import "./setup.js";

describe("EmbyClient - loginWithPassword", () => {
  it("sends credentials, stores the returned token, and uses it on subsequent calls", async () => {
    let loginBody: any = null;
    let loginHeader: string | null = null;
    server.use(
      http.post(`${EMBY_HOST}/emby/Users/AuthenticateByName`, async ({ request }) => {
        loginBody = await request.json();
        loginHeader = request.headers.get("x-emby-authorization");
        return HttpResponse.json({
          AccessToken: "new-token",
          User: { Id: "u1", Name: "alice" },
          ServerId: "srv",
        });
      }),
      http.get(`${EMBY_HOST}/emby/System/Info`, ({ request }) =>
        HttpResponse.json({ ServerName: "T", _auth: request.headers.get("x-emby-token") })
      )
    );

    const client = new EmbyClient(EMBY_HOST, "");
    const result = await client.loginWithPassword({ username: "alice", password: "secret" });
    expect(result.AccessToken).toBe("new-token");
    expect(loginBody.Username).toBe("alice");
    expect(loginBody.Pw).toBe("secret");
    expect(loginHeader).toContain("MediaBrowser Client=");

    const info = await client.get<{ _auth: string }>("/System/Info");
    expect(info._auth).toBe("new-token");
  });

  it("throws when the server omits AccessToken", async () => {
    server.use(
      http.post(`${EMBY_HOST}/emby/Users/AuthenticateByName`, () => HttpResponse.json({ User: {} }))
    );
    const client = new EmbyClient(EMBY_HOST, "");
    await expect(client.loginWithPassword({ username: "x", password: "y" })).rejects.toThrow(
      /AccessToken/
    );
  });

  it("allows custom X-Emby-Authorization header", async () => {
    let seen: string | null = null;
    server.use(
      http.post(`${EMBY_HOST}/emby/Users/AuthenticateByName`, ({ request }) => {
        seen = request.headers.get("x-emby-authorization");
        return HttpResponse.json({ AccessToken: "t" });
      })
    );
    const client = new EmbyClient(EMBY_HOST, "");
    await client.loginWithPassword({
      username: "u",
      password: "p",
      headers: { "X-Emby-Authorization": 'Custom Client="mine"' },
    });
    expect(seen).toBe('Custom Client="mine"');
  });
});

import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { EmbyClient, StartupAlreadyCompletedError } from "../src/index.js";
import { EMBY_HOST, server } from "./setup.js";
import "./setup.js";

/**
 * Simulate a fresh server: `/Startup/*` respond 200/204. After
 * `POST /Startup/Complete`, they all respond 401.
 */
function installFreshEmby() {
  let completed = false;
  const authGate = (): boolean => !completed;
  server.use(
    http.get(`${EMBY_HOST}/emby/Startup/Configuration`, () =>
      authGate()
        ? HttpResponse.json({ UICulture: "en-us" })
        : HttpResponse.json({}, { status: 401 })
    ),
    http.post(`${EMBY_HOST}/emby/Startup/Configuration`, () =>
      authGate() ? new HttpResponse(null, { status: 204 }) : HttpResponse.json({}, { status: 401 })
    ),
    http.post(`${EMBY_HOST}/emby/Startup/User`, () =>
      authGate() ? HttpResponse.json({ Name: "admin" }) : HttpResponse.json({}, { status: 401 })
    ),
    http.post(`${EMBY_HOST}/emby/Startup/Complete`, () => {
      if (!authGate()) return HttpResponse.json({}, { status: 401 });
      completed = true;
      return new HttpResponse(null, { status: 204 });
    })
  );
}

describe("EmbyClient - startup wizard helpers", () => {
  it("isStartupComplete returns false on a fresh server, true after completion", async () => {
    installFreshEmby();
    const client = new EmbyClient(EMBY_HOST, "");
    expect(await client.isStartupComplete()).toBe(false);
    await client.postStartupConfiguration({
      UICulture: "en-US",
      MetadataCountryCode: "US",
      PreferredMetadataLanguage: "en",
    });
    await client.postStartupUser({ Name: "admin", Password: "pw" });
    await client.postStartupComplete();
    expect(await client.isStartupComplete()).toBe(true);
  });

  it("getStartupConfiguration returns server defaults before the wizard", async () => {
    installFreshEmby();
    const client = new EmbyClient(EMBY_HOST, "");
    const cfg = await client.getStartupConfiguration();
    expect(cfg.UICulture).toBe("en-us");
  });

  it("throws StartupAlreadyCompletedError after completion", async () => {
    installFreshEmby();
    const client = new EmbyClient(EMBY_HOST, "");
    await client.postStartupUser({ Name: "admin" });
    await client.postStartupComplete();
    await expect(client.getStartupConfiguration()).rejects.toBeInstanceOf(
      StartupAlreadyCompletedError
    );
    await expect(client.postStartupUser({ Name: "x" })).rejects.toBeInstanceOf(
      StartupAlreadyCompletedError
    );
  });

  it("sends the submitted configuration in the request body", async () => {
    let body: any = null;
    server.use(
      http.post(`${EMBY_HOST}/emby/Startup/Configuration`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      })
    );
    const client = new EmbyClient(EMBY_HOST, "");
    await client.postStartupConfiguration({
      UICulture: "en-US",
      MetadataCountryCode: "US",
      PreferredMetadataLanguage: "en",
    });
    expect(body.UICulture).toBe("en-US");
    expect(body.MetadataCountryCode).toBe("US");
  });
});

describe("EmbyClient.addLibrary", () => {
  it("creates a new library when none with that name exists", async () => {
    const calls: Array<{ name: string; body: any }> = [];
    server.use(
      http.get(`${EMBY_HOST}/emby/Library/VirtualFolders`, () => HttpResponse.json([])),
      http.post(`${EMBY_HOST}/emby/Library/VirtualFolders`, async ({ request }) => {
        const u = new URL(request.url);
        calls.push({ name: u.searchParams.get("name")!, body: await request.json() });
        return new HttpResponse(null, { status: 204 });
      })
    );
    const client = new EmbyClient(EMBY_HOST, "tok");
    const result = await client.addLibrary({
      name: "Movies",
      paths: "/data/movies",
      collectionType: "movies",
    });
    expect(result.created).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("Movies");
    expect(calls[0].body.LibraryOptions.PathInfos).toEqual([{ Path: "/data/movies" }]);
  });

  it("skips creation when a library with the same name already exists", async () => {
    let postCount = 0;
    server.use(
      http.get(`${EMBY_HOST}/emby/Library/VirtualFolders`, () =>
        HttpResponse.json([
          { Name: "Movies", Locations: ["/data/movies"], CollectionType: "movies" },
        ])
      ),
      http.post(`${EMBY_HOST}/emby/Library/VirtualFolders`, () => {
        postCount++;
        return new HttpResponse(null, { status: 204 });
      })
    );
    const client = new EmbyClient(EMBY_HOST, "tok");
    const result = await client.addLibrary({ name: "Movies", paths: "/data/movies" });
    expect(result.created).toBe(false);
    expect(result.existing?.Name).toBe("Movies");
    expect(postCount).toBe(0);
  });

  it("honours collectionType and refreshLibrary query params", async () => {
    let seenQuery: URLSearchParams | null = null;
    server.use(
      http.get(`${EMBY_HOST}/emby/Library/VirtualFolders`, () => HttpResponse.json([])),
      http.post(`${EMBY_HOST}/emby/Library/VirtualFolders`, ({ request }) => {
        seenQuery = new URL(request.url).searchParams;
        return new HttpResponse(null, { status: 204 });
      })
    );
    const client = new EmbyClient(EMBY_HOST, "tok");
    await client.addLibrary({
      name: "TV",
      paths: "/data/tv",
      collectionType: "tvshows",
      refreshLibrary: true,
    });
    expect(seenQuery!.get("collectionType")).toBe("tvshows");
    expect(seenQuery!.get("refreshLibrary")).toBe("true");
  });

  it("supports multiple paths per library", async () => {
    const calls: Array<{ name: string; body: any }> = [];
    server.use(
      http.get(`${EMBY_HOST}/emby/Library/VirtualFolders`, () => HttpResponse.json([])),
      http.post(`${EMBY_HOST}/emby/Library/VirtualFolders`, async ({ request }) => {
        const u = new URL(request.url);
        calls.push({ name: u.searchParams.get("name")!, body: await request.json() });
        return new HttpResponse(null, { status: 204 });
      })
    );
    const client = new EmbyClient(EMBY_HOST, "tok");
    const result = await client.addLibrary({
      name: "Movies",
      paths: ["/data/movies", "/data/movies-2", "/data/movies-3"],
      collectionType: "movies",
    });
    expect(result.created).toBe(true);
    expect(calls[0].body.LibraryOptions.PathInfos).toEqual([
      { Path: "/data/movies" },
      { Path: "/data/movies-2" },
      { Path: "/data/movies-3" },
    ]);
  });
});

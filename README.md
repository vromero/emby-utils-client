# @emby-utils/client

Typed HTTP client for the [Emby](https://emby.media/) REST API, driven by the
official Emby OpenAPI spec. Every one of the 447 operations in the spec is
reachable by its `operationId`, with path-param substitution, required-param
validation, automatic retries on transient failures, async pagination, and
streaming for binary endpoints.

## Install

```bash
npm install @emby-utils/client
```

Requires Node.js >= 22.13. ESM-only.

## Usage

```ts
import { EmbyClient } from "@emby-utils/client";

const client = new EmbyClient("http://emby.local:8096", "API_KEY");

// Typed calls — the return type is inferred from a curated ResponseTypeMap.
const info = await client.callOperation("getSystemInfo");
//    ^? SystemInfo

// Any operation in the spec is dispatchable:
const episodes = await client.callOperation("getItems", {
  queryParams: { IncludeItemTypes: "Episode", SearchTerm: "severance" },
});
```

### Authentication

By default the client sends both `X-Emby-Token` and the legacy `api_key`
query param, so it works with every endpoint.

To log in with a username/password and swap the token into the client:

```ts
const client = new EmbyClient("http://emby.local:8096", ""); // no key yet
const { AccessToken } = await client.loginWithPassword({
  username: "alice",
  password: "secret",
});
```

### First-run (startup wizard)

The Emby startup-wizard endpoints are not in the OpenAPI spec. They are exposed
as dedicated methods and work against an un-initialized server (no auth
required). `isStartupComplete()` deliberately strips auth so it can reliably
detect completion on a server that would otherwise accept an admin token.

```ts
const client = new EmbyClient("http://emby.local:8096", ""); // no key yet
if (!(await client.isStartupComplete())) {
  await client.postStartupConfiguration({
    UICulture: "en-US",
    MetadataCountryCode: "US",
    PreferredMetadataLanguage: "en",
  });
  await client.postStartupUser({ Name: "alice", Password: "secret" });
  await client.postStartupComplete();
}
```

### Idempotent library creation

`POST /Library/VirtualFolders` is not idempotent — calling it twice creates a
duplicate. `addLibrary()` checks the existing virtual folders first:

```ts
const result = await client.addLibrary({
  name: "Movies",
  path: "/data/movies",
  collectionType: "movies",
});
// { created: true } on first run, { created: false, existing: {...} } thereafter.
```

### Pagination & streaming

```ts
for await (const item of client.paginate("getItems", { pageSize: 100 })) {
  console.log(item.Name);
}

const stream = await client.stream("getItemsByIdImagesByType", {
  pathParams: { Id: "abc", Type: "Primary" },
});
stream.pipe(process.stdout);
```

### Retry policy

GET/HEAD/OPTIONS are retried up to 2 times on network errors or 5xx/408/425/429
responses, with exponential backoff (default base 250 ms). Override:

```ts
new EmbyClient(host, key, {
  timeoutMs: 10_000,
  retries: 5,
  retryBaseDelayMs: 500,
});
```

Or per-request:

```ts
await client.callOperation("getItems", { timeoutMs: 2_000, retries: 0 });
```

### Discovering operations

```ts
import { operations } from "@emby-utils/client";
console.log(Object.keys(operations).length); // 447
console.log(operations.getSystemInfo);
// { operationId: "getSystemInfo", method: "GET", path: "/System/Info", ... }
```

The operation registry is also available at a zero-side-effect subpath, so
tools that only need the spec metadata don't have to load axios:

```ts
import { operations } from "@emby-utils/client/operations";
```

### Detecting errors

`axios`'s type guard is re-exported so consumers don't need a direct
dependency on axios:

```ts
import { isAxiosError } from "@emby-utils/client";

try {
  await client.callOperation("getSystemInfo");
} catch (err) {
  if (isAxiosError(err) && err.response?.status === 401) {
    // handle unauthenticated
  }
}
```

## Notes

- `GET /Items/{Id}` does not exist on Emby. Use `getUsersByUseridItemsById`
  (`GET /Users/{UserId}/Items/{Id}`) for a user-scoped item detail.
- A handful of upstream path placeholders lack parameter metadata in the
  spec. Required-param validation tolerates this — failures surface only
  when the missing value is genuinely required.
- The spec is vendored at `spec/openapi.json`. Regenerate the operation
  registry with `npm run generate`.

## Relationship to the official Emby JS SDK

Emby publishes a Swagger-generated JavaScript client at [MediaBrowser/Emby.ApiClients](https://github.com/MediaBrowser/Emby.ApiClients) (`embyclient-js`). It is not published to npm, uses callback-style APIs, and its upstream README explicitly recommends vendoring rather than installing as a dep.

`@emby-utils/client` is a TypeScript-first alternative generated from the same Emby OpenAPI spec. It adds retries, pagination, streaming, typed responses, and coverage for workflows the official SDK skips (startup wizard, idempotent init, drift-safe library creation). If you need the official generated DTOs by name, they are a useful read-only reference in `Clients/JavaScript/src/model/`.

## License

MIT

# Agent Guidelines — @emby-utils/client

## What this repo is

Standalone npm package `@emby-utils/client`: a typed Emby HTTP client driven by the Emby OpenAPI spec. Siblings `emby-utils-mcp` (MCP server) and `emby-utils-cli` (CLI) depend on this package via npm. They live in separate GitHub repos under the same `vromero` org.

## Setup & Environment

- ESM-only (`"type": "module"`). Use `.js` extensions in relative TypeScript imports (NodeNext resolution). Do **not** introduce CJS files.
- Node >=22.13 (enforced in `engines`). Vitest 4 requires this.
- `tests/` uses MSW 2.x (`setupServer` from `msw/node`) to mock Emby HTTP. `onUnhandledRequest: "error"` — every outbound request must be handled.

## Commands

- `npm install` — deps.
- `npm run generate` — regenerates `src/generated/operations.ts` from `spec/openapi.json`. Rerun whenever the spec changes. The generator is at `scripts/generate-operations.mjs`.
- `npm run build` — runs `generate` then `tsc -p tsconfig.build.json`. Do **not** run `tsc` alone; the registry is regenerated as part of the build.
- `npm test` — Vitest. Single file: `npx vitest run tests/<file>.test.ts`.
- `npm run lint` / `lint:fix`, `npm run format` / `format:check`.
- `npm run release:dry` — `npm publish --dry-run` to preview.

## Architecture quirks

- **OpenAPI-driven.** All 447 operations live in `src/generated/operations.ts`, produced by `scripts/generate-operations.mjs`. Never edit the generated file by hand. The generator resolves the spec via `../spec/openapi.json` relative to itself.
- **Startup wizard endpoints are NOT in the OpenAPI spec.** `/Startup/Configuration`, `/Startup/User`, `/Startup/Complete` are reverse-engineered against a real Emby container and live in `src/startup.ts`. On a fresh server they respond 200/204 unauthenticated; once the wizard is done they return 401. `EmbyClient.isStartupComplete()` probes this by explicitly stripping auth (otherwise an authenticated admin call would succeed against a completed server and the signal is lost).
- **Auth** is sent both as `X-Emby-Token` header **and** `api_key` query param. Some legacy endpoints require the query form. The client's ctor tolerates an empty apiKey (for pre-login use); `loginWithPassword()` + `setApiKey()` rotate the token.
- **Retry policy.** GET/HEAD/OPTIONS retried up to 2x by default on 5xx/408/425/429/network errors with exponential backoff. Non-idempotent methods are **not** retried. Override per-client or per-request.
- **Typed responses** are curated in `src/types.ts` — a `ResponseTypeMap` maps common `operationId`s to hand-picked DTO subsets. `callOperation<Id, T>` infers `T` from the map unless the caller overrides.
- **No `GET /Items/{Id}`.** Emby exposes item details only at `GET /Users/{UserId}/Items/{Id}` (operationId `getUsersByUseridItemsById`).
- **Duplicate operationIds** (`getAudioByIdByContainer`, `headAudioByIdByContainer`) are disambiguated by the generator by appending a path-derived suffix.
- **A small number of upstream path placeholders lack parameter metadata.** `tests/operations-coverage.test.ts` asserts this stays below 2% rather than 0.

## Cross-repo development

When a sibling repo (`emby-utils-mcp`, `emby-utils-cli`) needs an unreleased change here:

```bash
# In this repo:
npm run build
npm link

# In the consumer repo:
npm link @emby-utils/client
```

Unlink with `npm unlink --global @emby-utils/client`.

## Why not `embyclient-js` (the official Emby JS SDK)?

The official SDK lives at [MediaBrowser/Emby.ApiClients](https://github.com/MediaBrowser/Emby.ApiClients) under `Clients/JavaScript` and is Swagger-Codegen output from the same spec we vendor at `spec/openapi.json`. We deliberately do **not** depend on it:

- Not published to npm (`npm view embyclient-js` → 404). Consumers are expected to vendor the `src/` folder, which upstream recommends over packaging.
- Upstream README states: "We do not recommend to use and install this code as a package."
- Callback-only API, no TypeScript types, global singleton auth state.
- Runtime deps include `babel@6.x` + `superagent@3.7.0` (2017-era).
- Does **not** cover the workflows we care about most: the startup-wizard endpoints, auth-stripped `isStartupComplete()` probe, idempotent library creation, retry/backoff, pagination iterator, streaming.

**Read-only reference:** the generated `Clients/JavaScript/src/model/*.js` files in the upstream repo are a useful catalogue of every DTO field Emby returns. Use them as a reference when widening `src/types.ts`. Do not vendor them.

## Publishing

- `publishConfig.access: "public"`. Versioning via **changesets**.
- Flow: `npx changeset` → describe the change → `npm run version` → `npm run release:dry` → `npm run release`.

## CI

`.github/workflows/ci.yml` runs lint, format check, build, and test on Node `22.13.x`, `22.x`, and `latest`.

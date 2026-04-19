/**
 * Type-level smoke test: these calls must compile. No runtime assertions
 * beyond "it ran without throwing" are needed — the important thing is
 * that TypeScript infers `SystemInfo`, `UserDto[]`, etc. from the
 * operationId alone.
 */
import { describe, it, expect } from "vitest";
import { EmbyClient } from "../src/emby-client.js";
import type { SystemInfo, UserDto, QueryResultOfBaseItemDto } from "../src/types.js";
import { EMBY_API_KEY, EMBY_HOST } from "./setup.js";
import "./setup.js";

describe("EmbyClient typed responses", () => {
  it("infers SystemInfo from getSystemInfo", async () => {
    const client = new EmbyClient(EMBY_HOST, EMBY_API_KEY);
    const info = await client.callOperation("getSystemInfo");
    // Pure type assertion — the assignment must compile.
    const _check: SystemInfo = info;
    expect(_check.ServerName).toBe("Test Emby");
  });

  it("infers UserDto[] from getUsers", async () => {
    const client = new EmbyClient(EMBY_HOST, EMBY_API_KEY);
    const users = await client.callOperation("getUsers");
    const _check: UserDto[] = users;
    expect(_check).toHaveLength(2);
  });

  it("infers QueryResultOfBaseItemDto from getItems", async () => {
    const client = new EmbyClient(EMBY_HOST, EMBY_API_KEY);
    const page = await client.callOperation("getItems");
    const _check: QueryResultOfBaseItemDto = page;
    expect(_check.Items.length).toBeGreaterThan(0);
    expect(_check.TotalRecordCount).toBeGreaterThanOrEqual(0);
  });

  it("lets caller override T explicitly", async () => {
    interface Custom {
      ok: boolean;
    }
    const client = new EmbyClient(EMBY_HOST, EMBY_API_KEY);
    // Operation with no entry in ResponseTypeMap — T defaults to `any`
    // unless overridden.
    const data = await client.callOperation<"getSystemPing", Custom>("getSystemPing");
    // No runtime assertion; just verify the override compiles.
    expect(typeof data).toBe("object");
  });
});

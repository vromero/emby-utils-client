/**
 * Emby first-run ("startup wizard") helpers.
 *
 * These endpoints live under `/emby/Startup/*` and are **not** part of the
 * published OpenAPI spec, so they're modelled by hand here based on
 * reverse-engineering the Emby web UI against a fresh `emby/embyserver`
 * container.
 *
 * Flow on a just-installed server:
 *
 *   1. `postStartupConfiguration({ UICulture, MetadataCountryCode, ... })`  -> 204
 *   2. `postStartupUser({ Name, Password })`                                 -> 200 (UserDto)
 *   3. `postStartupComplete()`                                               -> 204
 *
 * After completion, all `/Startup/*` endpoints respond with **401 Unauthorized**
 * — we use that as the idempotency signal.
 */
import type { AxiosInstance } from "axios";
import { isAxiosError } from "axios";

export interface StartupConfiguration {
  /** Two-letter locale, e.g. `en-US`. Default Emby value: `en-us`. */
  UICulture?: string;
  /** Two-letter ISO country code, e.g. `US`. */
  MetadataCountryCode?: string;
  /** Two-letter ISO language, e.g. `en`. */
  PreferredMetadataLanguage?: string;
}

export interface StartupUser {
  /** Admin username to create. */
  Name: string;
  /** Plaintext password. Emby hashes server-side. Optional; omit for no password. */
  Password?: string;
}

/**
 * Raised when the caller tries to interact with `/Startup/*` on a server
 * that has already completed its first-run wizard.
 */
export class StartupAlreadyCompletedError extends Error {
  constructor() {
    super(
      "Emby startup wizard has already been completed on this server. Authenticate as an existing admin instead."
    );
    this.name = "StartupAlreadyCompletedError";
  }
}

/**
 * Helpers bound to an axios instance. Not a class — consumed by `EmbyClient`
 * which exposes them as methods.
 */
export async function isStartupComplete(http: AxiosInstance): Promise<boolean> {
  // We explicitly strip auth on this probe: the whole point is to check
  // whether the server's endpoints are gated by auth at all, which is the
  // unambiguous signal for "setup complete". If we forwarded the api_key,
  // an authenticated admin request would succeed even on a completed
  // server, giving the wrong answer.
  //
  // Axios merges instance `defaults.params` with per-request `params`, so
  // to truly remove `api_key` we need to explicitly set it to `null` (which
  // axios strips from the query string) and blank out the header.
  const defaultParams = (http.defaults.params ?? {}) as Record<string, unknown>;
  const overriddenParams: Record<string, unknown> = { ...defaultParams };
  if ("api_key" in overriddenParams) overriddenParams.api_key = null;
  const res = await http.get("/Startup/Configuration", {
    headers: { "X-Emby-Token": "" },
    params: overriddenParams,
    validateStatus: (s) => s === 200 || s === 401 || s === 403,
  });
  return res.status === 401 || res.status === 403;
}

export async function getStartupConfiguration(http: AxiosInstance): Promise<StartupConfiguration> {
  try {
    const res = await http.get<StartupConfiguration>("/Startup/Configuration");
    return res.data;
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 401) {
      throw new StartupAlreadyCompletedError();
    }
    throw err;
  }
}

export async function postStartupConfiguration(
  http: AxiosInstance,
  config: StartupConfiguration
): Promise<void> {
  try {
    await http.post("/Startup/Configuration", config);
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 401) {
      throw new StartupAlreadyCompletedError();
    }
    throw err;
  }
}

export async function postStartupUser(http: AxiosInstance, user: StartupUser): Promise<void> {
  try {
    await http.post("/Startup/User", user);
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 401) {
      throw new StartupAlreadyCompletedError();
    }
    throw err;
  }
}

export async function postStartupComplete(http: AxiosInstance): Promise<void> {
  try {
    await http.post("/Startup/Complete");
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 401) {
      throw new StartupAlreadyCompletedError();
    }
    throw err;
  }
}

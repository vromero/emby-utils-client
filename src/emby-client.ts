import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, isAxiosError } from "axios";
import { operations, OperationSpec } from "./generated/operations.js";
import type { ResponseFor, VirtualFolderInfo } from "./types.js";
import {
  getStartupConfiguration,
  isStartupComplete,
  postStartupComplete,
  postStartupConfiguration,
  postStartupUser,
  type StartupConfiguration,
  type StartupUser,
} from "./startup.js";

export interface AddLibraryArgs {
  /** Library display name (e.g. "Movies"). */
  name: string;
  /** Container-visible path that the Emby server can read. */
  path: string;
  /** Emby collection type: `movies`, `tvshows`, `music`, `books`, `mixed`, ... */
  collectionType?: string;
  /** Extra options merged into Emby's LibraryOptions DTO. */
  libraryOptions?: Record<string, unknown>;
  /** Trigger a library refresh after adding. Default: false. */
  refreshLibrary?: boolean;
}

export interface EmbyRequestArgs {
  pathParams?: Record<string, string | number>;
  queryParams?: Record<string, any>;
  body?: any;
  headers?: Record<string, string>;
  /** Override response type, e.g. "stream" for media endpoints. */
  responseType?: AxiosRequestConfig["responseType"];
  /** Request-level override of the default timeout (ms). */
  timeoutMs?: number;
  /** Per-request override of the retry policy. */
  retries?: number;
}

export interface EmbyClientOptions {
  /** Default request timeout in ms. Defaults to 30_000. */
  timeoutMs?: number;
  /** Number of retries for transient failures on idempotent methods. Default 2. */
  retries?: number;
  /** Base delay for exponential backoff (ms). Default 250. */
  retryBaseDelayMs?: number;
  /** Methods eligible for automatic retry. Default: GET/HEAD/OPTIONS. */
  retryableMethods?: string[];
  /** Override axios instance (primarily for tests). */
  httpClient?: AxiosInstance;
}

/**
 * Emby paginated response envelope as used by `/Items`, `/Users/{id}/Items`,
 * `/Artists`, `/Genres`, etc.
 */
export interface EmbyPagedResult<T> {
  Items: T[];
  TotalRecordCount: number;
}

const DEFAULT_RETRYABLE_METHODS = ["GET", "HEAD", "OPTIONS"];
const DEFAULT_RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Low-level Emby API client.
 *
 *  - `callOperation(id, args)`: invoke an endpoint by its OpenAPI operationId.
 *  - `paginate(id, args)`: async iterator over every page of a paged endpoint.
 *  - `stream(id, args)`: fetch a binary endpoint as a Node.js Readable stream.
 *  - `request(method, path, args)`: raw escape-hatch for arbitrary paths.
 *  - `get/post/put/delete`: axios-style shortcuts for the raw request API.
 *
 * Auth is handled via the `X-Emby-Token` header for maximum compatibility
 * with all endpoints. The legacy `api_key` query param is also sent.
 * GET/HEAD/OPTIONS are retried by default on transient network and 5xx failures.
 */
export class EmbyClient {
  private http: AxiosInstance;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryableMethods: Set<string>;

  constructor(
    public host: string,
    public apiKey: string,
    options: EmbyClientOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = options.retries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
    this.retryableMethods = new Set(
      (options.retryableMethods ?? DEFAULT_RETRYABLE_METHODS).map((m) => m.toUpperCase())
    );

    this.http =
      options.httpClient ??
      axios.create({
        baseURL: `${host.replace(/\/+$/, "")}/emby`,
        headers: {
          ...(apiKey ? { "X-Emby-Token": apiKey } : {}),
          Accept: "application/json",
        },
        params: apiKey ? { api_key: apiKey } : {},
        timeout: this.timeoutMs,
      });
  }

  /** Swap in a new token after login or rotation. */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.http.defaults.headers.common["X-Emby-Token"] = apiKey;
    this.http.defaults.params = { ...(this.http.defaults.params ?? {}), api_key: apiKey };
  }

  /**
   * Authenticate a user by name/password. On success, swaps the client's
   * token for the returned `AccessToken` and returns the full auth response
   * (including the user DTO).
   *
   * The `X-Emby-Authorization` header requires at least `Client`, `Device`,
   * `DeviceId`, and `Version`. Defaults are chosen to be identifiable as
   * this library; override via the `headers` argument.
   */
  async loginWithPassword(args: {
    username: string;
    password: string;
    headers?: Record<string, string>;
  }): Promise<{ AccessToken: string; User?: unknown; ServerId?: string }> {
    const authHeader =
      args.headers?.["X-Emby-Authorization"] ??
      'MediaBrowser Client="emby-utils", Device="emby-utils-client", DeviceId="emby-utils-client", Version="0.1.0"';
    const res = await this.http.request<{
      AccessToken: string;
      User?: unknown;
      ServerId?: string;
    }>({
      method: "post",
      url: "/Users/AuthenticateByName",
      data: { Username: args.username, Pw: args.password },
      headers: {
        "X-Emby-Authorization": authHeader,
        ...(args.headers ?? {}),
      },
      timeout: this.timeoutMs,
    });
    if (!res.data?.AccessToken) {
      throw new Error("Login succeeded but server did not return an AccessToken");
    }
    this.setApiKey(res.data.AccessToken);
    return res.data;
  }

  // --- First-run ("startup wizard") helpers -------------------------------

  /**
   * Returns `true` when the server has already completed its first-run
   * wizard (detected via a 401 on `/Startup/Configuration`).
   */
  async isStartupComplete(): Promise<boolean> {
    return isStartupComplete(this.http);
  }

  /** Retrieve the current pre-wizard configuration. Requires an un-initialized server. */
  async getStartupConfiguration(): Promise<StartupConfiguration> {
    return getStartupConfiguration(this.http);
  }

  /** Save locale / metadata preferences during the first-run wizard. */
  async postStartupConfiguration(config: StartupConfiguration): Promise<void> {
    return postStartupConfiguration(this.http, config);
  }

  /** Create the initial admin user during the first-run wizard. */
  async postStartupUser(user: StartupUser): Promise<void> {
    return postStartupUser(this.http, user);
  }

  /** Mark the first-run wizard as complete. */
  async postStartupComplete(): Promise<void> {
    return postStartupComplete(this.http);
  }

  /**
   * Add a library (virtual folder). On Emby, `POST /Library/VirtualFolders`
   * will happily create duplicate paths if called twice, so this helper
   * checks `GET /Library/VirtualFolders` first and returns `{ created: false }`
   * when a library of the same name already exists.
   */
  async addLibrary(
    args: AddLibraryArgs
  ): Promise<{ created: boolean; existing?: VirtualFolderInfo }> {
    const existing = await this.callOperation<"getLibraryVirtualfolders">(
      "getLibraryVirtualfolders"
    );
    const match = existing.find((lib) => lib.Name === args.name);
    if (match) return { created: false, existing: match };

    const libraryOptions: Record<string, unknown> = {
      EnableRealtimeMonitor: true,
      EnablePhotos: true,
      ...(args.libraryOptions ?? {}),
      PathInfos: [{ Path: args.path }],
    };
    await this.request("POST", "/Library/VirtualFolders", {
      body: { LibraryOptions: libraryOptions },
      queryParams: {
        name: args.name,
        collectionType: args.collectionType ?? "mixed",
        refreshLibrary: args.refreshLibrary ?? false,
      },
    });
    return { created: true };
  }

  // ------------------------------------------------------------------------

  /** Get the spec for a given operationId. Throws if unknown. */
  getOperationSpec(operationId: string): OperationSpec {
    const spec = operations[operationId];
    if (!spec) {
      throw new Error(`Unknown Emby operationId: ${operationId}. See src/generated/operations.ts`);
    }
    return spec;
  }

  /** List all registered operation IDs. */
  listOperations(): string[] {
    return Object.keys(operations);
  }

  /**
   * Invoke an Emby endpoint by operationId. If the operationId is known to
   * the curated `ResponseTypeMap`, the return type defaults to the matching
   * typed DTO; otherwise the caller can supply `T` explicitly or receive
   * `any`.
   */
  async callOperation<Id extends string, T = ResponseFor<Id>>(
    operationId: Id,
    args: EmbyRequestArgs = {}
  ): Promise<T> {
    const spec = this.getOperationSpec(operationId);
    this.validateRequiredParams(spec, args);
    const resolvedPath = this.substitutePathParams(spec, args);
    return this.request<T>(spec.method, resolvedPath, {
      queryParams: args.queryParams,
      body: args.body,
      headers: args.headers,
      responseType: args.responseType,
      timeoutMs: args.timeoutMs,
      retries: args.retries,
    });
  }

  /**
   * Async iterator over every page of a paged operation (e.g. `getItems`).
   * Yields one item at a time. Uses the Emby `StartIndex`/`Limit` convention.
   * Default page size is 100; override with `pageSize`.
   */
  async *paginate<T = any>(
    operationId: string,
    args: EmbyRequestArgs & { pageSize?: number } = {}
  ): AsyncIterableIterator<T> {
    const pageSize = args.pageSize ?? 100;
    let startIndex = 0;

    while (true) {
      const page = await this.callOperation<string, EmbyPagedResult<T>>(operationId, {
        ...args,
        queryParams: {
          ...(args.queryParams ?? {}),
          StartIndex: startIndex,
          Limit: pageSize,
        },
      });
      const items = page?.Items ?? [];
      for (const item of items) yield item;
      const total = page?.TotalRecordCount ?? items.length;
      startIndex += items.length;
      if (items.length === 0 || startIndex >= total) return;
    }
  }

  /**
   * Fetch a binary operation (image, stream, HLS segment) as a Node.js
   * Readable stream. The response is not parsed as JSON.
   */
  async stream(operationId: string, args: EmbyRequestArgs = {}): Promise<NodeJS.ReadableStream> {
    return this.callOperation<string, NodeJS.ReadableStream>(operationId, {
      ...args,
      responseType: "stream",
    });
  }

  /** Raw HTTP dispatcher with retry/timeout. */
  async request<T = any>(
    method: string,
    path: string,
    args: Omit<EmbyRequestArgs, "pathParams"> = {}
  ): Promise<T> {
    const upperMethod = method.toUpperCase();
    const retries = args.retries ?? (this.retryableMethods.has(upperMethod) ? this.retries : 0);
    const timeout = args.timeoutMs ?? this.timeoutMs;

    const config: AxiosRequestConfig = {
      method: method.toLowerCase(),
      url: path,
      params: args.queryParams,
      data: args.body,
      headers: args.headers,
      responseType: args.responseType,
      timeout,
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response: AxiosResponse<T> = await this.http.request<T>(config);
        return response.data;
      } catch (err) {
        lastError = err;
        if (attempt === retries || !this.isRetryable(err)) throw err;
        await this.sleep(this.retryBaseDelayMs * 2 ** attempt);
      }
    }
    throw lastError;
  }

  // --- Axios-style escape hatches (primarily for backward compat & tests) ---

  get<T = any>(path: string, queryParams?: Record<string, any>): Promise<T> {
    return this.request<T>("GET", path, { queryParams });
  }
  post<T = any>(path: string, body?: any, queryParams?: Record<string, any>): Promise<T> {
    return this.request<T>("POST", path, { body, queryParams });
  }
  put<T = any>(path: string, body?: any, queryParams?: Record<string, any>): Promise<T> {
    return this.request<T>("PUT", path, { body, queryParams });
  }
  delete<T = any>(path: string, queryParams?: Record<string, any>): Promise<T> {
    return this.request<T>("DELETE", path, { queryParams });
  }

  // --- Internals ---

  private validateRequiredParams(spec: OperationSpec, args: EmbyRequestArgs): void {
    for (const p of spec.pathParams) {
      if (p.required && args.pathParams?.[p.name] === undefined) {
        throw new Error(
          `Missing required path parameter '${p.name}' for operation '${spec.operationId}'`
        );
      }
    }
    for (const p of spec.queryParams) {
      if (p.required && args.queryParams?.[p.name] === undefined) {
        throw new Error(
          `Missing required query parameter '${p.name}' for operation '${spec.operationId}'`
        );
      }
    }
  }

  private substitutePathParams(spec: OperationSpec, args: EmbyRequestArgs): string {
    if (!args.pathParams) return spec.path;
    let resolved = spec.path;
    for (const [k, v] of Object.entries(args.pathParams)) {
      resolved = resolved.replace(new RegExp(`\\{${k}\\}`, "g"), encodeURIComponent(String(v)));
    }
    return resolved;
  }

  private isRetryable(err: unknown): boolean {
    if (!isAxiosError(err)) return false;
    // Network errors (no response) are retryable.
    if (!err.response) return true;
    return DEFAULT_RETRYABLE_STATUSES.has(err.response.status);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

/**
 * Shared MSW server setup for all tests. Any test can register additional
 * handlers via `server.use(...)` before making calls.
 */
import { afterAll, afterEach, beforeAll } from "vitest";
import { setupServer } from "msw/node";
import { defaultHandlers } from "./msw-handlers.js";

export { EMBY_HOST, EMBY_API_KEY } from "./constants.js";

export const server = setupServer(...defaultHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers(...defaultHandlers));
afterAll(() => server.close());

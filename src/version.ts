import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/** Package version from package.json, used in auth headers. */
export const VERSION: string = pkg.version;

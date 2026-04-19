export { EmbyClient } from "./emby-client.js";
// Re-exported so consumers (mcp server, cli) can detect axios errors without
// taking a direct dep on axios.
export { isAxiosError } from "axios";
export type {
  AddLibraryArgs,
  EmbyRequestArgs,
  EmbyClientOptions,
  EmbyPagedResult,
} from "./emby-client.js";
export { operations } from "./generated/operations.js";
export type { OperationSpec, ParamSpec } from "./generated/operations.js";
export { StartupAlreadyCompletedError } from "./startup.js";
export type { StartupConfiguration, StartupUser } from "./startup.js";
export type {
  BaseItemDto,
  PlayState,
  PluginInfo,
  PublicSystemInfo,
  QueryResultOfBaseItemDto,
  ResponseFor,
  ResponseTypeMap,
  SessionInfo,
  SystemInfo,
  UserConfiguration,
  UserDto,
  UserItemDataDto,
  UserPolicy,
  VirtualFolderInfo,
} from "./types.js";

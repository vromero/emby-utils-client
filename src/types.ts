/**
 * Curated type definitions for the Emby DTOs consumers most commonly read.
 * These are hand-picked subsets of the OpenAPI schemas — a fully-generated
 * type surface would include thousands of rarely-used fields and produce a
 * painful developer experience.
 *
 * All fields are optional because Emby serializers frequently omit nulls.
 * If a field you need is missing, either deepen the type or cast the
 * response to `any` at the call site.
 */

export interface SystemInfo {
  /** Display name of the server. */
  ServerName?: string;
  /** Full version string, e.g. "4.8.0.0". */
  Version?: string;
  /** Operating system the server runs on. */
  OperatingSystem?: string;
  /** CPU architecture, e.g. "X64". */
  SystemArchitecture?: string;
  Id?: string;
  WebSocketPortNumber?: number;
  HttpServerPortNumber?: number;
  HttpsPortNumber?: number;
  [key: string]: unknown;
}

export interface PublicSystemInfo {
  ServerName?: string;
  Version?: string;
  LocalAddress?: string;
  Id?: string;
  [key: string]: unknown;
}

export interface UserDto {
  Id?: string;
  Name?: string;
  ServerId?: string;
  HasPassword?: boolean;
  HasConfiguredPassword?: boolean;
  LastLoginDate?: string;
  LastActivityDate?: string;
  Policy?: UserPolicy;
  Configuration?: UserConfiguration;
  [key: string]: unknown;
}

export interface UserPolicy {
  IsAdministrator?: boolean;
  IsHidden?: boolean;
  IsDisabled?: boolean;
  EnableMediaPlayback?: boolean;
  EnableRemoteAccess?: boolean;
  EnableContentDeletion?: boolean;
  [key: string]: unknown;
}

export interface UserConfiguration {
  AudioLanguagePreference?: string;
  PlayDefaultAudioTrack?: boolean;
  SubtitleLanguagePreference?: string;
  DisplayMissingEpisodes?: boolean;
  EnableNextEpisodeAutoPlay?: boolean;
  [key: string]: unknown;
}

/**
 * A media item (movie, episode, album, etc.). Fields vary wildly by type.
 */
export interface BaseItemDto {
  Id?: string;
  Name?: string;
  OriginalTitle?: string;
  ServerId?: string;
  Type?: string;
  MediaType?: string;
  ParentId?: string;
  SeriesName?: string;
  Overview?: string;
  ProductionYear?: number;
  PremiereDate?: string;
  DateCreated?: string;
  CommunityRating?: number;
  OfficialRating?: string;
  RunTimeTicks?: number;
  IsFolder?: boolean;
  UserData?: UserItemDataDto;
  [key: string]: unknown;
}

export interface UserItemDataDto {
  PlaybackPositionTicks?: number;
  PlayCount?: number;
  IsFavorite?: boolean;
  Played?: boolean;
  Key?: string;
  [key: string]: unknown;
}

export interface QueryResultOfBaseItemDto {
  Items: BaseItemDto[];
  TotalRecordCount: number;
}

export interface SessionInfo {
  Id?: string;
  UserId?: string;
  UserName?: string;
  Client?: string;
  DeviceName?: string;
  DeviceId?: string;
  ApplicationVersion?: string;
  LastActivityDate?: string;
  NowPlayingItem?: BaseItemDto;
  PlayState?: PlayState;
  [key: string]: unknown;
}

export interface PlayState {
  PositionTicks?: number;
  IsPaused?: boolean;
  IsMuted?: boolean;
  VolumeLevel?: number;
  PlayMethod?: string;
  [key: string]: unknown;
}

export interface PluginInfo {
  Name?: string;
  Version?: string;
  Id?: string;
  Description?: string;
  Status?: string;
  [key: string]: unknown;
}

export interface VirtualFolderInfo {
  Name?: string;
  Locations?: string[];
  CollectionType?: string;
  ItemId?: string;
  [key: string]: unknown;
}

/**
 * Map of operationId -> response type. Used by `EmbyClient.callOperation`
 * to give a better default `T` than `any` when the caller doesn't specify one.
 */
export interface ResponseTypeMap {
  getSystemInfo: SystemInfo;
  getSystemInfoPublic: PublicSystemInfo;
  getUsers: UserDto[];
  getUsersById: UserDto;
  getItems: QueryResultOfBaseItemDto;
  getUsersByUseridItems: QueryResultOfBaseItemDto;
  getUsersByUseridItemsById: BaseItemDto;
  getSessions: SessionInfo[];
  getPlugins: PluginInfo[];
  getLibraryVirtualfolders: VirtualFolderInfo[];
}

export type ResponseFor<Id extends string> = Id extends keyof ResponseTypeMap
  ? ResponseTypeMap[Id]
  : any;

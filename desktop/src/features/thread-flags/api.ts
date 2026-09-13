import { invokeTauri } from "@/shared/api/tauri";

export type FlagMode =
  | "active"
  | "coordinate"
  | "progress"
  | "complete"
  | "all";
export type FlagCursor = { created_at: number; id: string };
export type FlagQuery = {
  mode: FlagMode;
  q: string;
  limit: number;
  cursor: FlagCursor | null;
};
export type FlagRow = {
  id: string;
  pubkey: string;
  created_at: number;
  title: string;
  flags: string[];
};
export type FlagPage = {
  version: number;
  channel_id: string;
  query: FlagQuery;
  rows: FlagRow[];
  has_more: boolean;
  next_cursor: FlagCursor | null;
};
export type FlagScope = { channelId: string; relayUrl: string; pubkey: string };
export type FetchFlags = (
  scope: FlagScope,
  query: FlagQuery,
) => Promise<FlagPage>;

/** The native command validates scope, signature and projection before returning. */
export const fetchFlags: FetchFlags = (scope, query) =>
  invokeTauri<FlagPage>("get_thread_flag_page", {
    channelId: scope.channelId,
    query,
    expectedRelayUrl: scope.relayUrl,
    expectedSignerPubkey: scope.pubkey,
  });

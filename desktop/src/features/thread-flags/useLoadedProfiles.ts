import { useMemo } from "react";
import { managedAgentsQueryKey } from "@/features/agents/hooks";
import { useMessageProfiles } from "@/features/channels/ui/useMessageProfiles";
import { collectMessageAuthorPubkeys } from "@/features/messages/lib/formatTimelineMessages";
import {
  profileQueryKey,
  usersBatchEntryKey,
  type UsersBatchEntry,
} from "@/features/profile/hooks";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type {
  ChannelMember,
  ManagedAgent,
  Profile,
  RelayEvent,
  RelayAgent,
} from "@/shared/api/types";
import { useCachedQueries, useCachedQuery } from "./useCachedQuery";

const EMPTY_AGENTS: ManagedAgent[] = [];
const EMPTY_RELAY_AGENTS: RelayAgent[] = [];
/** Reuse loaded ownership metadata for the timeline formatter's edit authorization. */
export function useLoadedProfiles(
  events: RelayEvent[],
  pubkey: string,
  members: ChannelMember[] | undefined,
  relaySelf: string | null | undefined,
) {
  const authors = useMemo(
    () => collectMessageAuthorPubkeys(events, relaySelf),
    [events, relaySelf],
  );
  const keys = useMemo(() => authors.map(usersBatchEntryKey), [authors]);
  const entries = useCachedQueries<UsersBatchEntry>(keys);
  const profiles = useMemo(() => {
    const result: UserProfileLookup = {};
    entries.forEach((entry, i) => {
      if (entry?.status !== "error" && entry?.data?.summary)
        result[authors[i]] = entry.data.summary;
    });
    return result;
  }, [entries, authors]);
  const current = useCachedQuery<Profile>(profileQueryKey);
  const managed = useCachedQuery<ManagedAgent[]>(managedAgentsQueryKey);
  return useMessageProfiles({
    profiles,
    channelMembers: members,
    currentPubkey: pubkey,
    currentProfile: current?.status === "error" ? undefined : current?.data,
    managedAgents:
      managed?.status === "error"
        ? EMPTY_AGENTS
        : (managed?.data ?? EMPTY_AGENTS),
    relayAgents: EMPTY_RELAY_AGENTS,
  });
}

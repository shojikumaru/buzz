import { channelMembersKey } from "@/features/channels/channelMembersKey";
import { useLoadedProfiles } from "./useLoadedProfiles";
import { useMemo, useState } from "react";
import { formatTimelineMessages } from "@/features/messages/lib/formatTimelineMessages";
import { channelMessagesKey } from "@/features/messages/lib/messageQueryKeys";
import { relaySelfQueryKey } from "@/features/moderation/hooks";
import type { Channel, ChannelMember, RelayEvent } from "@/shared/api/types";
import type { SearchHit } from "@/shared/api/searchTypes";
import { type FlagMode, selectLoadedFlags } from "./loadedFlags";
import { useCachedQuery } from "./useCachedQuery";

const EMPTY_EVENTS: RelayEvent[] = [];
type Props = {
  channel: Channel;
  relayUrl: string;
  pubkey: string;
  onOpen: (hit: SearchHit, query: string) => void;
};

export function ThreadFlags(props: Props) {
  if (
    props.channel.archivedAt ||
    props.channel.channelType !== "stream" ||
    (!props.channel.isMember && props.channel.visibility !== "open")
  )
    return null;
  return (
    <LoadedFlags
      key={JSON.stringify([props.relayUrl, props.pubkey, props.channel.id])}
      {...props}
    />
  );
}

function LoadedFlags({ channel, pubkey, onOpen }: Props) {
  const [mode, setMode] = useState<FlagMode>("active");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const messagesKey = useMemo(
    () => channelMessagesKey(channel.id),
    [channel.id],
  );
  const membersKey = useMemo(() => channelMembersKey(channel.id), [channel.id]);
  const state = useCachedQuery<RelayEvent[]>(messagesKey);
  const members = useCachedQuery<ChannelMember[]>(membersKey);
  const relaySelf = useCachedQuery<string | null>(relaySelfQueryKey);
  // Error data may be a retained page from before access was revoked.
  const raw = state?.status === "error" ? undefined : state?.data;
  const invalidShape = raw !== undefined && !Array.isArray(raw);
  const events = Array.isArray(raw) ? raw : EMPTY_EVENTS;
  const memberData = members?.status === "error" ? undefined : members?.data;
  const relayIdentity =
    relaySelf?.status === "error" ? undefined : relaySelf?.data;
  const profiles = useLoadedProfiles(events, pubkey, memberData, relayIdentity);
  const timeline = useMemo(
    () =>
      formatTimelineMessages(
        events,
        channel,
        pubkey,
        null, // Avatar is irrelevant to flag labels.
        profiles,
        memberData,
        undefined,
        undefined,
        relayIdentity,
      ),
    [events, channel, pubkey, profiles, memberData, relayIdentity],
  );
  const rows = useMemo(
    () => selectLoadedFlags(timeline, mode, query),
    [timeline, mode, query],
  );
  return (
    <section
      className="mx-2 my-2 space-y-2 rounded-md border p-2 text-sm"
      aria-label="Flagged threads"
    >
      <h3 className="font-medium">Flagged threads</h3>
      <p className="text-xs text-muted-foreground">
        Only messages already loaded in this channel. Older, unloaded threads
        are not searched.
      </p>
      <select
        aria-label="Thread flag filter"
        className="w-full rounded border bg-background p-1"
        value={mode}
        onChange={(e) => {
          setMode(e.target.value as FlagMode);
          setLimit(50);
        }}
      >
        <option value="active">Active</option>
        <option value="coordinate">🚩 Coordinating</option>
        <option value="progress">🔴 In progress</option>
        <option value="complete">☑️ Completed</option>
        <option value="all">All loaded flags</option>
      </select>
      <input
        aria-label="Search flagged threads"
        placeholder="Search loaded thread text"
        maxLength={200}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(50);
        }}
        className="w-full rounded border bg-background p-1"
      />
      {state?.status === "error" || invalidShape ? (
        <p role="alert">
          Loaded messages are unavailable. Retry from the conversation.
        </p>
      ) : !state?.data ? (
        <p role="status">
          No messages loaded yet. Open the conversation to load messages.
        </p>
      ) : rows.length === 0 ? (
        <p>No matching flags in loaded messages.</p>
      ) : null}
      <ul className="space-y-1">
        {rows.slice(0, limit).map(({ message, flags }) => (
          <li key={message.id}>
            <button
              type="button"
              className="w-full rounded px-1 py-1 text-left hover:bg-accent"
              onClick={() =>
                onOpen(
                  {
                    eventId: message.id,
                    threadRootId: message.id,
                    content: message.body,
                    pubkey: message.pubkey ?? "",
                    createdAt: message.createdAt,
                    kind: 9,
                    channelId: channel.id,
                    channelName: channel.name,
                    score: 0,
                  },
                  query,
                )
              }
            >
              <span>{flags.map((f) => (f === "☑" ? "☑️" : f)).join(" ")} </span>
              <bdi>
                {Array.from(message.body.replace(/\s+/g, " ").trim())
                  .slice(0, 240)
                  .join("") || "Untitled thread"}
              </bdi>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button
          type="button"
          className="rounded border px-2 py-1"
          onClick={() => setLimit((n) => n + 50)}
        >
          Show more loaded flags
        </button>
      )}
    </section>
  );
}

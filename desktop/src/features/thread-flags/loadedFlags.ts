import type { TimelineMessage } from "@/features/messages/types";

export type FlagMode =
  | "active"
  | "coordinate"
  | "progress"
  | "complete"
  | "all";
const FLAGS = ["🚩", "🔴", "☑"] as const;

/** Classify labels only; the canonical timeline owns event/reaction authority. */
export function selectLoadedFlags(
  messages: TimelineMessage[],
  mode: FlagMode,
  query: string,
) {
  const needle = query.toLowerCase();
  return messages
    .flatMap((message) => {
      if (
        message.kind !== 9 ||
        message.pending ||
        message.depth !== 0 ||
        message.parentId ||
        message.rootId
      )
        return [];
      if (!message.body.toLowerCase().includes(needle)) return [];
      const present = new Set(
        (message.reactions ?? [])
          .filter((r) => r.count > 0)
          .map((r) => r.emoji.replace(/[\uFE0E\uFE0F]/g, "")),
      );
      const flags = FLAGS.filter((flag) => present.has(flag));
      const complete = present.has("☑");
      if (!flags.length || (mode === "complete" && !complete)) return [];
      if (mode !== "complete" && mode !== "all" && complete) return [];
      if (mode === "coordinate" && !present.has("🚩")) return [];
      if (mode === "progress" && !present.has("🔴")) return [];
      return [{ message, flags }];
    })
    .sort(
      (a, b) =>
        b.message.createdAt - a.message.createdAt ||
        (a.message.id < b.message.id
          ? -1
          : a.message.id > b.message.id
            ? 1
            : 0),
    );
}

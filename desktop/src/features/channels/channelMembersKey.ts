/** Shared address of the channel-owned member query. */
export const channelMembersKey = (channelId: string) =>
  ["channels", channelId, "members"] as const;

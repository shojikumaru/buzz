import assert from "node:assert/strict";
import { before, after, afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<html><body></body></html>", {
  url: "http://localhost",
});
before(() =>
  Object.assign(globalThis, {
    document: dom.window.document,
    window: dom.window,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }),
);
const clients = [];
afterEach(async () => {
  (await import("@testing-library/react")).cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
});
after(() => dom.window.close());
const channel = {
  id: "channel-a",
  name: "alpha",
  channelType: "stream",
  visibility: "private",
  isMember: true,
  description: "",
  topic: null,
  purpose: null,
  memberCount: 1,
  memberPubkeys: [],
  lastMessageAt: null,
  archivedAt: null,
  participants: [],
  participantPubkeys: [],
  ttlSeconds: null,
  ttlDeadline: null,
};
const scope = { relayUrl: "wss://a.test", pubkey: "a".repeat(64), channel };
let sequence = 0;
const event = (kind, content, tags = [], extra = {}) => ({
  id: (++sequence).toString(16).padStart(64, "0"),
  pubkey: scope.pubkey,
  created_at: sequence,
  kind,
  content,
  tags: [["h", channel.id], ...tags],
  sig: "0".repeat(128),
  ...extra,
});
const root = (body, extra = {}) => event(9, body, [], extra);
const react = (target, emoji) => event(7, emoji, [["e", target.id]]);
const remove = (target) => event(5, "", [["e", target.id]]);
function normalizedName(options) {
  if (typeof options?.name !== "string") return options;
  const name = options.name.replace(/\s/g, "");
  return { ...options, name: (actual) => actual.replace(/\s/g, "") === name };
}
async function setup(initial = [], props = {}) {
  const React = await import("react");
  const ui = await import("@testing-library/react");
  const { QueryClient, QueryClientProvider } = await import(
    "@tanstack/react-query"
  );
  const { ThreadFlags } = await import("./ThreadFlags.tsx");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const key = ["channel-messages", channel.id];
  if (initial !== null) client.setQueryData(key, initial);
  const render = (p = {}, c = client) =>
    React.createElement(
      QueryClientProvider,
      { client: c },
      React.createElement(ThreadFlags, { ...scope, ...props, ...p }),
    );
  const app = ui.render(render());
  return {
    ...ui,
    ...app,
    getByRole: (role, options) => app.getByRole(role, normalizedName(options)),
    queryByRole: (role, options) =>
      app.queryByRole(role, normalizedName(options)),
    client,
    key,
    QueryClient,
    render,
    set: async (events) =>
      ui.act(async () => {
        client.setQueryData(key, events);
      }),
  };
}
test("passive panel creates no query or fetcher and leaves source options unchanged", async () => {
  const app = await setup(null);
  assert.equal(app.client.getQueryCache().getAll().length, 0);
  assert(app.getByText(/No messages loaded yet/));
  let calls = 0;
  const queryFn = async () => {
    calls++;
    return [];
  };
  app.client.setQueryDefaults(app.key, {
    queryFn,
    staleTime: 1234,
    gcTime: 5678,
  });
  const r = root("Loaded task");
  await app.set([r, react(r, "🚩")]);
  assert(app.getByRole("button", { name: "🚩 Loaded task" }));
  const query = app.client.getQueryCache().find({ queryKey: app.key });
  assert.equal(query.options.queryFn, queryFn);
  assert.equal(query.options.staleTime, 1234);
  assert.equal(query.options.gcTime, 5678);
  assert.equal(query.getObserversCount(), 0);
  await app.act(async () => {
    await app.client.invalidateQueries({ queryKey: app.key });
    window.dispatchEvent(new window.Event("focus"));
    window.dispatchEvent(new window.Event("online"));
  });
  assert.equal(calls, 0);
  app.unmount();
  assert.equal(query.getObserversCount(), 0);
});
test("live cache reactions complete, restore and delete a root; opens the existing thread", async () => {
  const r = root("Coordinate");
  const flag = react(r, "🚩"),
    progress = react(r, "🔴"),
    done = react(r, "☑️");
  const opened = [];
  const app = await setup([r, flag, progress], {
    onOpen: (...args) => opened.push(args),
  });
  app.fireEvent.click(app.getByRole("button", { name: "🚩 🔴 Coordinate" }));
  assert.equal(opened[0][0].threadRootId, r.id);
  assert.equal(opened[0][0].channelId, channel.id);
  await app.set([r, flag, progress, done]);
  assert(app.getByText("No matching flags in loaded messages."));
  app.fireEvent.change(app.getByLabelText("Thread flag filter"), {
    target: { value: "complete" },
  });
  assert(app.getByRole("button", { name: "🚩 🔴 ☑️ Coordinate" }));
  await app.set([r, flag, progress, done, remove(done)]);
  assert(app.getByText("No matching flags in loaded messages."));
  app.fireEvent.change(app.getByLabelText("Thread flag filter"), {
    target: { value: "active" },
  });
  assert(app.getByRole("button", { name: "🚩 🔴 Coordinate" }));
  await app.set([r, flag, progress, remove(r)]);
  assert(app.getByText("No matching flags in loaded messages."));
});
test("orphans, pending roots and reply-only flags never become roots", async () => {
  const orphan = event(9, "Orphan", [["e", "f".repeat(64), "", "reply"]]);
  const pending = root("Pending", { pending: true });
  const r = root("Real root");
  const reply = event(9, "Reply", [["e", r.id, "", "reply"]]);
  const app = await setup([
    orphan,
    react(orphan, "🚩"),
    pending,
    react(pending, "🔴"),
    r,
    reply,
    react(reply, "☑️"),
  ]);
  assert(app.getByText("No matching flags in loaded messages."));
});
test("cache error with retained data, cache removal and withdrawn membership clear rows", async () => {
  const r = root("Private");
  const events = [r, react(r, "🚩")];
  const app = await setup(events);
  await app.act(async () =>
    app.client
      .getQueryCache()
      .find({ queryKey: app.key })
      .setState({ status: "error", error: new Error("forbidden") }),
  );
  assert(app.getByRole("alert"));
  assert.equal(app.queryByRole("button", { name: "🚩 Private" }), null);
  await app.set(events);
  await app.act(async () => app.client.removeQueries({ queryKey: app.key }));
  assert(app.getByText(/No messages loaded yet/));
  await app.set(events);
  app.rerender(app.render({ channel: { ...channel, isMember: false } }));
  assert.equal(app.queryByRole("region", { name: "Flagged threads" }), null);
});
test("channel changes and community/account QueryClient remounts never keep old rows", async () => {
  const r = root("Old account");
  const app = await setup([r, react(r, "🚩")]);
  app.rerender(app.render({ channel: { ...channel, id: "channel-b" } }));
  assert.equal(app.queryByText("Old account"), null);
  app.rerender(app.render({ pubkey: "b".repeat(64) }, new app.QueryClient()));
  assert.equal(app.queryByText("Old account"), null);
  app.rerender(app.render({ relayUrl: "wss://b.test" }, new app.QueryClient()));
  assert.equal(app.queryByText("Old account"), null);
});
test("search/filter precede local cap, and use current authorized edited body safely", async () => {
  const r = root("Old text", { created_at: 0 });
  const filler = Array.from({ length: 55 }, (_, i) => {
    const r = root(`Task ${i}`);
    return [r, react(r, "🚩")];
  }).flat();
  const edit = event(40003, "<img> changed needle", [["e", r.id]]);
  const app = await setup([r, react(r, "🔴"), edit, ...filler]);
  assert(app.getByRole("button", { name: "Show more loaded flags" }));
  app.fireEvent.change(app.getByLabelText("Search flagged threads"), {
    target: { value: "changed needle" },
  });
  assert(app.getByRole("button", { name: "🔴 <img> changed needle" }));
  assert.equal(app.container.querySelector("img"), null);
  assert.equal(
    app.queryByRole("button", { name: "Show more loaded flags" }),
    null,
  );
  app.fireEvent.change(app.getByLabelText("Search flagged threads"), {
    target: { value: "" },
  });
  app.fireEvent.change(app.getByLabelText("Thread flag filter"), {
    target: { value: "progress" },
  });
  assert(app.getByRole("button", { name: "🔴 <img> changed needle" }));
});

test("loaded ownership authorizes owner edits; cache removal and spoofed authors fail closed", async () => {
  const { finalizeEvent, getPublicKey } = await import("nostr-tools/pure");
  const secret = new Uint8Array(32).fill(3);
  const agent = "b".repeat(64),
    owner = "c".repeat(64),
    relay = getPublicKey(secret);
  const r = finalizeEvent(
    {
      kind: 9,
      created_at: 0,
      content: "Original agent text",
      tags: [
        ["h", channel.id],
        ["actor", agent],
      ],
    },
    secret,
  );
  const edit = event(40003, "Owner edited", [["e", r.id]], { pubkey: owner });
  const app = await setup([r, react(r, "🚩"), edit]);
  const { relaySelfQueryKey } = await import("@/features/moderation/hooks");
  const { usersBatchEntryKey } = await import("@/features/profile/hooks");
  const { channelMembersKey } = await import(
    "@/features/channels/channelMembersKey"
  );
  await app.act(async () => {
    app.client.setQueryData(relaySelfQueryKey, relay);
    app.client.setQueryData(channelMembersKey(channel.id), [
      { pubkey: agent, role: "bot" },
    ]);
    app.client.setQueryData(usersBatchEntryKey(agent), {
      summary: { displayName: "Agent", ownerPubkey: owner },
      fetchedAt: Date.now(),
    });
  });
  assert(app.getByRole("button", { name: "🚩 Owner edited" }));
  await app.act(async () =>
    app.client.removeQueries({
      queryKey: usersBatchEntryKey(agent),
      exact: true,
    }),
  );
  assert(app.getByRole("button", { name: "🚩 Original agent text" }));
  await app.set([r, react(r, "🚩"), { ...edit, pubkey: "f".repeat(64) }]);
  assert(app.getByRole("button", { name: "🚩 Original agent text" }));
  // Trusted relay + actor-signed edit applies; removing relay trust fails closed.
  await app.set([
    r,
    react(r, "🚩"),
    { ...edit, pubkey: agent, content: "Agent edited" },
  ]);
  assert(app.getByRole("button", { name: "🚩 Agent edited" }));
  await app.act(async () =>
    app.client.removeQueries({ queryKey: relaySelfQueryKey, exact: true }),
  );
  assert(app.getByRole("button", { name: "🚩 Original agent text" }));
  for (const query of app.client.getQueryCache().getAll())
    assert.equal(query.getObserversCount(), 0);
});
test("scope remount resets controls; public non-members can view loaded data but archived/forum cannot", async () => {
  const r = root("Scope A");
  const app = await setup([r, react(r, "🚩")]);
  app.fireEvent.change(app.getByLabelText("Search flagged threads"), {
    target: { value: "absent" },
  });
  app.fireEvent.change(app.getByLabelText("Thread flag filter"), {
    target: { value: "complete" },
  });
  const b = root("Scope B", { tags: [["h", "channel-b"]] });
  await app.act(async () =>
    app.client.setQueryData(
      ["channel-messages", "channel-b"],
      [b, react(b, "🔴")],
    ),
  );
  app.rerender(app.render({ channel: { ...channel, id: "channel-b" } }));
  assert.equal(app.getByLabelText("Search flagged threads").value, "");
  assert.equal(app.getByLabelText("Thread flag filter").value, "active");
  assert(app.getByRole("button", { name: "🔴 Scope B" }));
  app.rerender(
    app.render({
      channel: { ...channel, isMember: false, visibility: "open" },
    }),
  );
  assert(app.getByRole("button", { name: "🚩 Scope A" }));
  for (const extra of [{ archivedAt: 123 }, { channelType: "forum" }]) {
    app.rerender(app.render({ channel: { ...channel, ...extra } }));
    assert.equal(app.queryByRole("region", { name: "Flagged threads" }), null);
  }
});
test("unexpected cache shape is visibly unavailable without crashing the sidebar", async () => {
  const app = await setup({ pages: [] });
  assert(app.getByRole("alert"));
});

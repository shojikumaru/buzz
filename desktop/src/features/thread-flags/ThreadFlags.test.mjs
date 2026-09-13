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
afterEach(async () => (await import("@testing-library/react")).cleanup());
after(() => dom.window.close());
const scope = {
  relayUrl: "wss://example.test",
  pubkey: "a".repeat(64),
  channelId: "channel-a",
};
const row = (title, flags = ["🚩", "🔴"]) => ({
  id: Buffer.from(title).toString("hex").padEnd(64, "a"),
  pubkey: scope.pubkey,
  title,
  flags,
  created_at: 1,
});
const page = (scope, query, rows) => ({
  version: 1,
  channel_id: scope.channelId,
  query,
  rows,
  has_more: false,
  next_cursor: null,
});
async function setup(props) {
  const React = await import("react");
  const ui = await import("@testing-library/react");
  const { ThreadFlags } = await import("./ThreadFlags.tsx");
  return {
    ...ui,
    React,
    ThreadFlags,
    ...ui.render(React.createElement(ThreadFlags, { ...scope, ...props })),
  };
}
test("real panel opens root, refresh replaces flags, completed is a server query", async () => {
  let completed = false;
  const opened = [];
  const queries = [];
  const app = await setup({
    onOpen: (...args) => opened.push(args),
    fetchPage: async (s, q) => {
      queries.push(q);
      return page(
        s,
        q,
        completed
          ? q.mode === "complete"
            ? [row("Done", ["☑"])]
            : []
          : [row("Task")],
      );
    },
  });
  app.fireEvent.click(await app.findByRole("button", { name: "🚩 🔴 Task" }));
  assert.equal(opened[0][0].threadRootId, row("Task").id);
  assert.equal(opened[0][0].channelId, "channel-a");
  completed = true;
  app.fireEvent.click(app.getByRole("button", { name: "Refresh flags" }));
  await app.findByText("No matching threads.");
  assert.equal(app.queryByText("Task"), null);
  app.fireEvent.change(app.getByLabelText("Thread flag filter"), {
    target: { value: "complete" },
  });
  await app.findByRole("button", { name: "☑️ Done" });
  assert.equal(queries.at(-1).mode, "complete");
});
test("switching channel discards a late response and refresh denial clears rows", async () => {
  let finish;
  let denied = false;
  const fetchPage = (s, q) =>
    s.channelId === "channel-a"
      ? new Promise((resolve) => {
          finish = () => resolve(page(s, q, [row("Old")]));
        })
      : denied
        ? Promise.reject(new Error("channel unavailable"))
        : Promise.resolve(page(s, q, [row("New")]));
  const props = { ...scope, fetchPage, onOpen() {} };
  const app = await setup(props);
  app.rerender(
    app.React.createElement(app.ThreadFlags, {
      ...props,
      channelId: "channel-b",
    }),
  );
  await app.findByText("New");
  await app.act(async () => finish());
  assert.equal(app.queryByText("Old"), null);
  denied = true;
  app.fireEvent.click(app.getByRole("button", { name: "Refresh flags" }));
  await app.findByRole("alert");
  assert.equal(app.queryByText("New"), null);
});
test("older pages use composite cursor; a head refresh replaces accumulated pages", async () => {
  const queries = [];
  let refresh = false;
  const app = await setup({
    onOpen() {},
    fetchPage: async (s, q) => {
      queries.push(q);
      if (refresh) return page(s, q, []);
      if (q.cursor) return page(s, q, [row("Older")]);
      return {
        ...page(s, q, [row("First")]),
        has_more: true,
        next_cursor: { created_at: 1, id: row("First").id },
      };
    },
  });
  await app.findByText("First");
  app.fireEvent.click(app.getByText("Load more threads"));
  await app.findByText("Older");
  assert.deepEqual(queries.at(-1).cursor, {
    created_at: 1,
    id: row("First").id,
  });
  refresh = true;
  app.fireEvent.click(app.getByText("Refresh flags"));
  await app.findByText("No matching threads.");
  assert.equal(app.queryByText("Older"), null);
});

test("automatic refresh does not overlap and pauses after errors until manual retry", async () => {
  const originalInterval = globalThis.setInterval;
  let tick;
  globalThis.setInterval = (callback, ms, ...args) => {
    if (ms === 30_000) tick = callback;
    return originalInterval(callback, ms === 30_000 ? 1_000_000 : ms, ...args);
  };
  Object.defineProperty(document, "hidden", {
    value: false,
    configurable: true,
  });
  let calls = 0;
  let fail;
  try {
    const app = await setup({
      onOpen() {},
      fetchPage: (s, q) => {
        calls++;
        return calls === 1
          ? new Promise((_, reject) => {
              fail = reject;
            })
          : Promise.resolve(page(s, q, []));
      },
    });
    await app.act(async () => tick());
    assert.equal(calls, 1, "no second request while first is pending");
    await app.act(async () => fail(new Error("unsupported relay")));
    await app.findByRole("alert");
    await app.act(async () => {
      tick();
      document.dispatchEvent(new dom.window.Event("visibilitychange"));
    });
    assert.equal(calls, 1, "no automatic request after failure");
    app.fireEvent.click(app.getByText("Refresh flags"));
    await app.findByText("No matching threads.");
    assert.equal(calls, 2);
    await app.act(async () => tick());
    assert.equal(calls, 3, "manual recovery re-enables automatic updates");
  } finally {
    globalThis.setInterval = originalInterval;
  }
});

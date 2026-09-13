// Manual smoke against the isolated development relay on port43109 only.
// Public fixture keys; never use these keys on a real community.
import { finalizeEvent, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:43109";
const ownerKey = "31".repeat(32),
  guestKey = "32".repeat(32);
const guest = getPublicKey(Buffer.from(guestKey, "hex"));
const env = {
  ...process.env,
  BUZZ_RELAY_URL: base.replace("http", "ws"),
  BUZZ_PRIVATE_KEY: ownerKey,
};
delete env.BUZZ_AUTH_TAG;
const cli = (...args) =>
  JSON.parse(
    execFileSync("buzz", args, { env, encoding: "utf8", timeout: 15000 }),
  );
const checks = [];
async function query(channel, payload = {}, key = ownerKey, expected = 200) {
  const filter = {
    kinds: [9],
    "#h": [channel],
    limit: 1,
    thread_flags: { mode: "active", q: "", limit: 1, cursor: null, ...payload },
  };
  const body = JSON.stringify([filter]),
    url = base + "/query";
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [
        ["u", url],
        ["method", "POST"],
        ["payload", createHash("sha256").update(body).digest("hex")],
        ["nonce", randomUUID()],
      ],
    },
    Buffer.from(key, "hex"),
  );
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization:
        "Nostr " + Buffer.from(JSON.stringify(event)).toString("base64"),
    },
    body,
  });
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data));
  if (expected !== 200) return;
  assert.equal(data.length, 1);
  assert.equal(data[0].kind, 39007);
  assert(verifyEvent(data[0]));
  const info = await (
    await fetch(base, { headers: { Accept: "application/nostr+json" } })
  ).json();
  assert.equal(data[0].pubkey, info.self);
  return JSON.parse(data[0].content);
}
const ch = cli(
  "channels",
  "create",
  "--name",
  "flags-live-" + randomUUID().slice(0, 8),
  "--type",
  "stream",
  "--visibility",
  "private",
).channel_id;
const rootA = cli(
  "messages",
  "send",
  "--channel",
  ch,
  "--content",
  "Coordinate release 100%",
).event_id;
const rootB = cli(
  "messages",
  "send",
  "--channel",
  ch,
  "--content",
  "Second task",
).event_id;
for (const root of [rootA, rootB])
  cli("reactions", "add", "--event", root, "--emoji", "🚩");
cli("reactions", "add", "--event", rootA, "--emoji", "🔴");
const first = await query(ch);
assert.equal(first.rows.length, 1);
assert(first.has_more);
const second = await query(ch, { cursor: first.next_cursor });
assert.equal(second.rows.length, 1);
assert(!second.has_more);
assert.notEqual(second.rows[0].id, first.rows[0].id);
checks.push("signed authenticated pagination");
const all = await query(ch, { limit: 50 });
assert.equal(all.rows.length, 2);
assert.deepEqual(all.rows.find((r) => r.id === rootA).flags, ["🚩", "🔴"]);
checks.push("dual flags one root");
const reply = cli(
  "messages",
  "send",
  "--channel",
  ch,
  "--reply-to",
  rootA,
  "--content",
  "Reply flag must not change root",
).event_id;
cli("reactions", "add", "--event", reply, "--emoji", "☑️");
assert.equal((await query(ch, { limit: 50 })).rows.length, 2);
checks.push("reply flag isolation");
cli("reactions", "add", "--event", rootA, "--emoji", "☑️");
assert.equal((await query(ch, { limit: 50 })).rows.length, 1);
assert.equal((await query(ch, { mode: "complete" })).rows[0].id, rootA);
checks.push("completion precedence");
cli("reactions", "remove", "--event", rootA, "--emoji", "☑️");
assert.equal((await query(ch, { limit: 50 })).rows.length, 2);
checks.push("reaction removal");
assert.equal((await query(ch, { q: "%" })).rows[0].id, rootA);
checks.push("literal substring");
await query(ch, {}, guestKey, 403);
cli(
  "channels",
  "add-member",
  "--channel",
  ch,
  "--pubkey",
  guest,
  "--role",
  "member",
);
assert.equal((await query(ch, {}, guestKey)).rows.length, 1);
cli("channels", "remove-member", "--channel", ch, "--pubkey", guest);
await query(ch, {}, guestKey, 403);
checks.push("warmed membership revocation");
await query(ch, { limit: 101 }, ownerKey, 400);
checks.push("strict query limits");
cli("channels", "archive", "--channel", ch);
assert.equal((await query(ch)).rows.length, 0);
checks.push("archive clears results");
const open = cli(
  "channels",
  "create",
  "--name",
  "flags-open-" + randomUUID().slice(0, 8),
  "--type",
  "stream",
  "--visibility",
  "open",
).channel_id;
const openRoot = cli(
  "messages",
  "send",
  "--channel",
  open,
  "--content",
  "Open task",
).event_id;
cli("reactions", "add", "--event", openRoot, "--emoji", "🚩");
assert.equal((await query(open, {}, guestKey)).rows[0].id, openRoot);
checks.push("open channel non-member");
cli("channels", "archive", "--channel", open);
console.log(
  JSON.stringify({ checks, passed: checks.length, relay: base }, null, 2),
);

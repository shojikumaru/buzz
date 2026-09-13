import { expect, test } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import type { FlagQuery } from "../../src/features/thread-flags/api";

test("flagged sidebar opens a real thread and replaces completed/denied results", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  // Only the new native command is mocked. Navigation, sidebar and thread
  // hydration use the existing production app + established message fixture.
  await page.evaluate(
    ({ pubkey }) => {
      type Root = { id: string; pubkey: string; created_at: number };
      const w = window as typeof window & {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__: (input: {
          channelName: string;
          content: string;
          pubkey: string;
        }) => Root;
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
        __FLAGS_TEST_STATE__: string;
      };
      const root = w.__BUZZ_E2E_EMIT_MOCK_MESSAGE__({
        channelName: "general",
        content: "Coordinate release",
        pubkey,
      });
      const original = w.__TAURI_INTERNALS__.invoke.bind(w.__TAURI_INTERNALS__);
      w.__FLAGS_TEST_STATE__ = "active";
      w.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command !== "get_thread_flag_page") return original(command, args);
        if (w.__FLAGS_TEST_STATE__ === "denied")
          throw new Error("channel unavailable");
        const query = args?.query as FlagQuery;
        const completed = w.__FLAGS_TEST_STATE__ === "complete";
        const visible =
          query.mode === "all" ||
          (completed ? query.mode === "complete" : query.mode !== "complete");
        return {
          version: 1,
          channel_id: args?.channelId,
          query,
          has_more: false,
          next_cursor: null,
          rows: visible
            ? [
                {
                  ...root,
                  title: "Coordinate release",
                  flags: completed ? ["☑"] : ["🚩", "🔴"],
                },
              ]
            : [],
        };
      };
    },
    { pubkey: TEST_IDENTITIES.tyler.pubkey },
  );
  const panel = page.getByRole("region", { name: "Flagged threads" });
  await panel.getByRole("button", { name: "Refresh flags" }).click();
  const item = panel.getByRole("button", { name: "🚩 🔴 Coordinate release" });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByTestId("message-thread-panel")).toContainText(
    "Coordinate release",
  );
  await page.screenshot({
    path: "test-results/thread-flags-active.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    (
      window as typeof window & { __FLAGS_TEST_STATE__: string }
    ).__FLAGS_TEST_STATE__ = "complete";
  });
  await panel.getByRole("button", { name: "Refresh flags" }).click();
  await expect(panel.getByText("No matching threads.")).toBeVisible();
  await panel.getByLabel("Thread flag filter").selectOption("complete");
  await expect(
    panel.getByRole("button", { name: "☑️ Coordinate release" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/thread-flags-completed.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    (
      window as typeof window & { __FLAGS_TEST_STATE__: string }
    ).__FLAGS_TEST_STATE__ = "denied";
  });
  await panel.getByRole("button", { name: "Refresh flags" }).click();
  await expect(panel.getByRole("alert")).toContainText("channel unavailable");
  await expect(
    panel.getByRole("button", { name: "☑️ Coordinate release" }),
  ).toHaveCount(0);
});

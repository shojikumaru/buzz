import { expect, test } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

test("loaded sidebar follows real message/reaction cache and existing thread navigation", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  const root = await page.evaluate(
    async ({ pubkey }) => {
      const w = window as typeof window & {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__: (input: {
          channelName: string;
          content: string;
          pubkey: string;
          parentEventId?: string;
          id?: string;
        }) => { id: string; tags: string[][] };
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
        __FLAGS_EXTENSION_CALLS__: number;
      };
      const original = w.__TAURI_INTERNALS__.invoke.bind(w.__TAURI_INTERNALS__);
      w.__FLAGS_EXTENSION_CALLS__ = 0;
      w.__TAURI_INTERNALS__.invoke = (command, args) => {
        if (command === "get_thread_flag_page") {
          w.__FLAGS_EXTENSION_CALLS__++;
          throw new Error("Hosted relay has no extension");
        }
        return original(command, args);
      };
      const root = w.__BUZZ_E2E_EMIT_MOCK_MESSAGE__({
        channelName: "general",
        content: "Coordinate loaded release",
        pubkey,
      });
      for (const emoji of ["🚩", "🔴"])
        await original("add_reaction", { eventId: root.id, emoji });
      const reply = w.__BUZZ_E2E_EMIT_MOCK_MESSAGE__({
        channelName: "general",
        content: "Flagged reply stays out",
        pubkey,
        parentEventId: root.id,
      });
      await original("add_reaction", { eventId: reply.id, emoji: "🚩" });
      return {
        id: root.id,
        channelId: root.tags.find((t) => t[0] === "h")?.[1],
      };
    },
    { pubkey: TEST_IDENTITIES.tyler.pubkey },
  );
  const panel = page.getByRole("region", { name: "Flagged threads" });
  await expect(panel).toContainText("Only messages already loaded");
  const item = panel.getByRole("button", {
    name: "🚩 🔴 Coordinate loaded release",
  });
  await expect(item).toBeVisible();
  await expect(panel.getByText("Flagged reply stays out")).toHaveCount(0);
  await item.click();
  await expect(page.getByTestId("message-thread-panel")).toContainText(
    "Coordinate loaded release",
  );
  await page.screenshot({
    path: "test-results/loaded-flags-active.png",
    fullPage: true,
  });
  const invoke = async (command: string, args: Record<string, unknown>) =>
    page.evaluate(
      async ({ command, args }) => {
        const w = window as typeof window & {
          __TAURI_INTERNALS__: {
            invoke: (
              command: string,
              args: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        };
        await w.__TAURI_INTERNALS__.invoke(command, args);
      },
      { command, args },
    );
  await invoke("add_reaction", { eventId: root.id, emoji: "☑️" });
  await expect(item).toHaveCount(0);
  await panel.getByLabel("Thread flag filter").selectOption("complete");
  await expect(
    panel.getByRole("button", { name: "🚩 🔴 ☑️ Coordinate loaded release" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/loaded-flags-completed.png",
    fullPage: true,
  });
  await invoke("remove_reaction", { eventId: root.id, emoji: "☑️" });
  await panel.getByLabel("Thread flag filter").selectOption("active");
  await expect(item).toBeVisible();
  // Incoming deletion uses the normal live event pipeline. The mock delete
  // command alone does not emit; the real UI mutation also patches its cache.
  await page.evaluate(
    ({ id, pubkey }) => {
      const w = window as typeof window & {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__: (input: {
          channelName: string;
          content: string;
          pubkey: string;
          kind: number;
          extraTags: string[][];
        }) => unknown;
      };
      w.__BUZZ_E2E_EMIT_MOCK_MESSAGE__({
        channelName: "general",
        content: "",
        pubkey,
        kind: 5,
        extraTags: [["e", id]],
      });
    },
    { id: root.id, pubkey: TEST_IDENTITIES.tyler.pubkey },
  );
  await expect(item).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __FLAGS_EXTENSION_CALLS__: number })
            .__FLAGS_EXTENSION_CALLS__,
      ),
    )
    .toBe(0);
});

import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchHit } from "@/shared/api/searchTypes";
import {
  fetchFlags,
  type FetchFlags,
  type FlagMode,
  type FlagPage,
  type FlagRow,
  type FlagScope,
} from "./api";

type Props = FlagScope & {
  onOpen: (hit: SearchHit, query: string) => void;
  fetchPage?: FetchFlags;
};

/** A keyed, ephemeral view of root reactions. No process-state or archive mutation. */
export function ThreadFlags(props: Props) {
  return (
    <FlagControls
      key={JSON.stringify([props.relayUrl, props.pubkey, props.channelId])}
      {...props}
    />
  );
}

function FlagControls(props: Props) {
  const [mode, setMode] = useState<FlagMode>("active");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(text), 300);
    return () => clearTimeout(timer);
  }, [text]);
  return (
    <section
      className="mx-2 my-2 space-y-2 rounded-md border p-2 text-sm"
      aria-label="Flagged threads"
    >
      <h3 className="font-medium">Flagged threads</h3>
      <p className="text-xs text-muted-foreground">
        Flags on the first message. Completed threads are hidden from active
        views.
      </p>
      <select
        aria-label="Thread flag filter"
        className="w-full rounded border bg-background p-1"
        value={mode}
        onChange={(e) => setMode(e.target.value as FlagMode)}
      >
        <option value="active">Active</option>
        <option value="coordinate">🚩 Coordinating</option>
        <option value="progress">🔴 In progress</option>
        <option value="complete">☑️ Completed</option>
        <option value="all">All flags</option>
      </select>
      <input
        aria-label="Search flagged threads"
        placeholder="Search thread text"
        maxLength={200}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded border bg-background p-1"
      />
      {text !== q ? (
        <p role="status">Updating search…</p>
      ) : (
        <FlagResults
          key={JSON.stringify([mode, q])}
          {...props}
          mode={mode}
          q={q}
        />
      )}
    </section>
  );
}

function FlagResults({
  channelId,
  relayUrl,
  pubkey,
  mode,
  q,
  onOpen,
  fetchPage = fetchFlags,
}: Props & { mode: FlagMode; q: string }) {
  const [rows, setRows] = useState<FlagRow[]>([]);
  const [page, setPage] = useState<FlagPage | null>(null);
  const [pages, setPages] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ticket = useRef(0);
  const polling = useRef({ paused: false, busy: false });
  const request = useCallback(
    async (previous: FlagPage | null) => {
      const current = ++ticket.current;
      polling.current = { paused: false, busy: true };
      setBusy(true);
      setError(null);
      if (!previous) {
        setRows([]);
        setPage(null);
        setPages(0);
      }
      try {
        const result = await fetchPage(
          { channelId, relayUrl, pubkey },
          { mode, q, limit: 50, cursor: previous?.next_cursor ?? null },
        );
        if (ticket.current !== current) return;
        setRows((old) =>
          previous
            ? [
                ...old,
                ...result.rows.filter((r) => !old.some((o) => o.id === r.id)),
              ]
            : result.rows,
        );
        setPage(result);
        setPages((n) => (previous ? n + 1 : 1));
      } catch (e) {
        if (ticket.current !== current) return;
        setRows([]);
        setPage(null);
        setPages(0);
        polling.current.paused = true;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (ticket.current === current) {
          polling.current.busy = false;
          setBusy(false);
        }
      }
    },
    [channelId, relayUrl, pubkey, mode, q, fetchPage],
  );
  useEffect(() => {
    void request(null);
    const refresh = () => {
      if (!document.hidden && !polling.current.paused && !polling.current.busy)
        void request(null);
    };
    const interval = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      ++ticket.current;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [request]);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="rounded border px-2 py-1"
        disabled={busy}
        onClick={() => void request(null)}
      >
        Refresh flags
      </button>
      <p className="text-xs text-muted-foreground">
        Refreshes every 30 seconds while visible.
      </p>
      {busy && <p role="status">Loading flags…</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error} Automatic refresh paused; use Refresh flags to retry.
        </p>
      )}
      {!busy && !error && rows.length === 0 && <p>No matching threads.</p>}
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className="w-full rounded p-1 text-left hover:bg-accent"
              aria-label={`${row.flags.map((f) => (f === "☑" ? "☑️" : f)).join(" ")} ${row.title.trim() || "Untitled thread"}`}
              onClick={() =>
                onOpen(
                  {
                    eventId: row.id,
                    threadRootId: row.id,
                    content: row.title,
                    pubkey: row.pubkey,
                    createdAt: row.created_at,
                    kind: 9,
                    channelId,
                    channelName: null,
                    score: 0,
                  },
                  q,
                )
              }
            >
              <span>
                {row.flags.map((f) => (f === "☑" ? "☑️" : f)).join(" ")}{" "}
              </span>
              <bdi>{row.title.trim() || "Untitled thread"}</bdi>
            </button>
          </li>
        ))}
      </ul>
      {page?.has_more && pages < 5 && (
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={busy}
          onClick={() => void request(page)}
        >
          Load more threads
        </button>
      )}
      {page?.has_more && pages >= 5 && (
        <p>Narrow your search to find older threads.</p>
      )}
    </div>
  );
}

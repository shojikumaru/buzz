import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  type QueryKey,
  type QueryState,
  useQueryClient,
} from "@tanstack/react-query";

/** Passive reader: never creates a query, changes its options, or extends its gcTime. */
export function useCachedQuery<T>(key: QueryKey) {
  const client = useQueryClient();
  const cache = client.getQueryCache();
  const subscribe = useCallback(
    (notify: () => void) => cache.subscribe(notify),
    [cache],
  );
  const snapshot = useCallback(
    () => client.getQueryState<T>(key),
    [client, key],
  );
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}

/** Reads a variable set of existing entries without mounting query observers. */
export function useCachedQueries<T>(keys: readonly QueryKey[]) {
  const client = useQueryClient();
  const cache = client.getQueryCache();
  const subscribe = useCallback(
    (notify: () => void) => cache.subscribe(notify),
    [cache],
  );
  const snapshot = useMemo(() => {
    let previous: (QueryState<T> | undefined)[] = [];
    return () => {
      const next = keys.map((key) => client.getQueryState<T>(key));
      if (
        next.length !== previous.length ||
        next.some((state, i) => state !== previous[i])
      )
        previous = next;
      return previous;
    };
  }, [client, keys]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

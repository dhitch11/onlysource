/**
 * THE ONE STOCK-NUMBER KEY FUNCTION, shared by the server store and the client grid.
 *
 * ==========================================================================================
 * WHY THIS IS ITS OWN MODULE AND NOT A HELPER INSIDE `seen-store.ts`
 * ==========================================================================================
 * `seen-store.ts` imports `node:fs` at module scope. `MonopolyGrid.tsx` is a `"use client"`
 * component. Importing the normalizer from the store into the grid would drag `node:fs` into the
 * client bundle and fail the build — so the function lives here, with NO imports of any kind, and
 * both ends import it from this file.
 *
 * ==========================================================================================
 * ⛔ WHY IT MUST BE ONE FUNCTION AND NOT TWO THAT AGREE TODAY
 * ==========================================================================================
 * The grid links to `/corner/${nsn.replace(/[^0-9]/g, "")}` while the row carries the dashed
 * `5340-01-608-5969`. If the writer normalized one way and the reader another, every mark would be
 * written under one key and looked up under a different one: the glow would never appear, the
 * "unseen only" filter would show everything, and NOTHING WOULD THROW. That is a silent-wrong
 * failure of exactly the shape this estate keeps getting bitten by, so the two ends are wired to
 * one definition rather than two that happen to match.
 */

/** A stock number reduced to its digits, the form used as the seen-state key and in the corner URL. */
export function normalizeNsn(nsn: string): string {
  return (nsn ?? '').replace(/[^0-9]/g, '')
}

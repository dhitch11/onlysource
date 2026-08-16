/**
 * THE ONE RISING-PRICE PREDICATE.
 *
 * Two surfaces used to answer "is this corner's price rising?" with two different
 * expressions: the Monopoly grid compared the raw first and last unit prices, while the
 * portfolio counted `Math.round(escalationPct) > 0`, which silently drops a riser under
 * 0.5% because its rounded percent is 0. The two surfaces then disagreed 49 vs 50 on the
 * identical 115-corner set, which is precisely the kind of self-contradiction that makes a
 * professional discount every other number in the console.
 *
 * So the definition lives here once, pure and dependency-free (client components import it
 * too), and both surfaces call it. The DISPLAY percent may still round; the COUNT never does.
 */
export function isRisingPrice(
  firstUnitPrice: number | null | undefined,
  lastUnitPrice: number | null | undefined,
): boolean {
  return firstUnitPrice != null && lastUnitPrice != null && lastUnitPrice > firstUnitPrice
}

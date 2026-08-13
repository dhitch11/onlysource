/**
 * The resolve hook itself. See `ts-resolve.mjs` for why this exists.
 *
 * Only touches relative specifiers that fail to resolve as written, and only tries the
 * TypeScript extensions. A specifier that resolves normally is never rewritten, so a real
 * missing-module error still surfaces as a missing module rather than being masked.
 */

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (!specifier.startsWith('.')) throw error
    for (const extension of ['.ts', '.tsx', '/index.ts']) {
      try {
        return await nextResolve(specifier + extension, context)
      } catch {
        // Try the next candidate. The original error is rethrown if none work.
      }
    }
    throw error
  }
}

import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildNsnAwardIndex } from '@/lib/intelligence/awards/nsn-now'
import { buildForecastIndex } from '@/lib/intelligence/forecast/dla-forecast'
import { scoreCorner } from '@/lib/intelligence/scoring/cornerscore'
import { buildDistressedSuppliers } from '@/lib/intelligence/suppliers/distressed'
import { readPackets } from '@/lib/compliance/packets-store'
import { normalizeDealRef } from '@/lib/sales/pipeline'
import { buildCornerDossier } from './dossier'
import { buildPursuitPackage, type PursuitPackage } from './package'

/**
 * Assemble the pursuit package for one stock number, from the same computations every other
 * surface uses. One assembler, two callers (the memo generation and the email delivery), so
 * the package a memo was grounded in and the package an email carries can never be two
 * different objects built two different ways.
 *
 * Every leg is optional-with-honesty: no award index means no price legs and no holders, a
 * missing supplier book means no contact joins, and each absence is visible in the package
 * itself rather than silently defaulted.
 */

export type AssembledPackage =
  | { ok: true; pkg: PursuitPackage }
  | { ok: false; status: 404 | 503; error: string; message: string }

export function assemblePursuitPackage(nsnRaw: string): AssembledPackage {
  const root = resolveDataRoot()
  if (!root.present) {
    return {
      ok: false,
      status: 503,
      error: 'no_data',
      message: 'The data directory is not mounted here.',
    }
  }
  const key = nsnRaw.replace(/[^0-9]/g, '')
  if (key.length < 9) {
    return { ok: false, status: 404, error: 'bad_nsn', message: 'A stock number is required.' }
  }

  const { cornerMap } = buildAllDatasets()
  const row = cornerMap.rows.find((r) => r.nsn.replace(/[^0-9]/g, '') === key)
  if (!row) {
    return {
      ok: false,
      status: 404,
      error: 'not_found',
      message:
        'That stock number is not on the corner map this feed day, so there is no package to assemble for it.',
    }
  }

  const awardIx = buildNsnAwardIndex()
  const fcIx = buildForecastIndex()
  const award = awardIx.ok ? awardIx.byNsn.get(key) ?? null : null
  const forecast = fcIx.ok ? fcIx.byNsn.get(key) ?? null : null
  const score = scoreCorner(row, award, forecast, {
    awardIndexLoaded: awardIx.ok,
    forecastIndexLoaded: fcIx.ok,
  })
  const dossier = buildCornerDossier(row, award, forecast, score, awardIx.ok ? awardIx.window : undefined)

  const book = buildDistressedSuppliers()
  const byCage = book.ok ? book.byCage : null

  const wanted = normalizeDealRef(row.nsn)
  const savedPacketCount = wanted
    ? readPackets().filter((p) => normalizeDealRef(p.nsn) === wanted).length
    : 0

  return {
    ok: true,
    pkg: buildPursuitPackage({ row, dossier, award, byCage, savedPacketCount }),
  }
}

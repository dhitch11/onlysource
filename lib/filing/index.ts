/**
 * lib/filing — the DIBBS batch quote WRITER.
 *
 * Produces the 121-column file a defense-parts vendor uploads to DIBBS to quote a solicitation,
 * with a pre-submission validator for DLA's silent traps and a chunker for the 75-line limit.
 *
 * IT IS A WRITER, NOT A SUBMITTER. Nothing in this namespace opens a network connection or
 * imports http/https/net/fetch. It builds a file for a person to upload themselves. Transmitting
 * a quote to a government system is a separate, outward-facing action that is not authorized here,
 * and `test/filing/no-network.test.ts` enforces the absence of any network primitive by scanning
 * this module's own source.
 */

export {
  FIELD_COUNT,
  MAX_LINES_PER_FILE,
  COL,
  field,
  isWellFormedRow,
  isAutomatedAward,
  isSpmSolicitation,
  type SourceQuoteRow,
} from './format'
export { serializeRow, serializeRows, parseLine, stripField, quoteField, checksum } from './csv'
export { applyVendorQuote, rowKey, type VendorQuote } from './quote'
export {
  validateRow,
  validateFile,
  type ValidationReport,
  type QuoteProblem,
  type Severity,
} from './validate'
export { buildBatch, type BatchResult, type QuoteFile } from './outbox'

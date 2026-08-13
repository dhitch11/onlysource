-- T2 INGESTION. The Zone B shared-corpus schema plus the tenancy spine the feed hangs off.
--
-- TWO ZONES, AND THEY NEVER BLUR (T1's schema law, followed here rather than reinvented).
--
--   Zone A, tenant-owned: org_id NOT NULL, cascade FK, RLS, every unique index composite on
--   org_id. A tenant's pursuits, holdings and imports live here.
--
--   Zone B, the shared national corpus: NO org column and NO RLS, because a DLA solicitation
--   is public federal data that every tenant reads and no tenant owns. Putting org_id on it
--   would duplicate 3,000 rows a day per tenant and make "what did the government publish"
--   unanswerable. This IS the tenant-ready design, not an exception to it.
--
-- EVERY SHARED TABLE KEYS ON NIIN (9 digits), NEVER THE FULL NSN, because the supply class
-- can change while the item does not. Single most common modelling error in this domain.
--
-- EVERY FACT TABLE IS APPEND-ONLY OBSERVATIONS. A snapshot is not a change feed and absence
-- in a snapshot is not a delete. Supersession is resolved at read time. No in-place UPDATE
-- of a fact, no DELETE, ever.

-- ---------------------------------------------------------------------------
-- Closed vocabularies. A status nobody can alarm on is a status that rots.
-- ---------------------------------------------------------------------------
CREATE TYPE ingest_status    AS ENUM ('running','succeeded','partial','failed','skipped_no_publish');
CREATE TYPE ingest_failure   AS ENUM ('none','source_unreachable','consent_expired','layout_changed',
                                      'assertion_failed','partially_loaded','archive_unreadable');
CREATE TYPE retrieval_method AS ENUM ('pipeline_fetch','research_capture','manual_upload');
CREATE TYPE quarantine_state AS ENUM ('held','released','rejected');

-- ---------------------------------------------------------------------------
-- The tenancy spine. One org today, the model is ready for many.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Provenance. Nothing in this database is allowed to exist without one of these.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_registry (
  source_key      text PRIMARY KEY,
  host            text,
  fetch_strategy  text,
  publisher_unit  text,
  retention_days  integer,
  notes           text
);

CREATE TABLE IF NOT EXISTS raw_object (
  id                 bigserial PRIMARY KEY,
  source_key         text NOT NULL REFERENCES source_registry(source_key),
  logical_date       date,
  retrieved_at       timestamptz NOT NULL,
  -- How the bytes were obtained. NEVER upgraded to imply a fetch that did not happen.
  retrieval_method   retrieval_method NOT NULL,
  retrieved_at_basis text,
  storage_key        text NOT NULL UNIQUE,
  content_sha256     text NOT NULL,
  byte_len           bigint NOT NULL,
  source_url         text,
  http_status        integer,
  content_type       text,
  note               text,
  -- Re-archiving identical bytes for the same day is a no-op, not a duplicate.
  UNIQUE (source_key, logical_date, content_sha256)
);

CREATE TABLE IF NOT EXISTS run_ledger (
  id                bigserial PRIMARY KEY,
  run_id            text NOT NULL,
  source_key        text NOT NULL REFERENCES source_registry(source_key),
  logical_date      date,
  attempt           integer NOT NULL DEFAULT 1,
  started_at        timestamptz NOT NULL,
  finished_at       timestamptz,
  status            ingest_status NOT NULL,
  failure_kind      ingest_failure NOT NULL DEFAULT 'none',
  rows_in           integer NOT NULL DEFAULT 0,
  rows_loaded       integer NOT NULL DEFAULT 0,
  rows_quarantined  integer NOT NULL DEFAULT 0,
  -- Each entry carries probe_landed AND gate_fired. A probe that never landed proves nothing.
  assertions        jsonb NOT NULL DEFAULT '[]'::jsonb,
  code_version      text NOT NULL,
  storage_key       text,
  note              text
);
-- Ledger rows are immutable once written. Enforced, not merely intended.
CREATE OR REPLACE FUNCTION run_ledger_is_append_only() RETURNS trigger AS $$
BEGIN
  IF OLD.finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'run_ledger row % is immutable once finished', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS run_ledger_immutable ON run_ledger;
CREATE TRIGGER run_ledger_immutable BEFORE UPDATE ON run_ledger
  FOR EACH ROW EXECUTE FUNCTION run_ledger_is_append_only();
DROP TRIGGER IF EXISTS run_ledger_no_delete ON run_ledger;
CREATE RULE run_ledger_no_delete AS ON DELETE TO run_ledger DO INSTEAD NOTHING;

CREATE TABLE IF NOT EXISTS watermark (
  source_key    text NOT NULL REFERENCES source_registry(source_key),
  unit_kind     text NOT NULL,
  -- For a file-per-day source this is the SET of dates loaded, not a high-water timestamp.
  -- Those are different things and the difference shows the first time a day publishes late.
  loaded_units  jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_key, unit_kind)
);

CREATE TABLE IF NOT EXISTS quarantine (
  id            bigserial PRIMARY KEY,
  source_key    text NOT NULL REFERENCES source_registry(source_key),
  storage_key   text NOT NULL,
  logical_date  date,
  run_id        text NOT NULL,
  line_no       integer NOT NULL,
  byte_offset   bigint NOT NULL,
  raw_line      text NOT NULL,
  rule_id       text NOT NULL,
  severity      text NOT NULL,
  detail        text NOT NULL,
  state         quarantine_state NOT NULL DEFAULT 'held',
  created_at    timestamptz NOT NULL DEFAULT now(),
  released_at   timestamptz,
  released_by   text
);
CREATE INDEX IF NOT EXISTS quarantine_worklist ON quarantine (state, source_key, rule_id);

-- ---------------------------------------------------------------------------
-- Zone B. The national corpus.
-- ---------------------------------------------------------------------------

-- One row per requirement LINE observed in a daily index file.
--
-- THE NATURAL KEY IS MEASURED, NOT ASSUMED: (solicitation_number, nsn_raw, pr_number).
-- On real feed day 2026-08-11, 3,095 rows carry only 2,721 distinct solicitation numbers and
-- one solicitation appears 23 times, because DLA bundles many purchase requests under one
-- number. Keying on solicitation_number alone silently discards 374 of 3,095 rows.
CREATE TABLE IF NOT EXISTS requirement (
  id                    bigserial PRIMARY KEY,
  solicitation_number   text NOT NULL,
  nsn_raw               text NOT NULL,
  niin                  char(9),
  fsc                   char(4),
  part_number           text,
  pr_number             text NOT NULL,
  return_by             date,
  quantity              numeric,
  unit_of_issue         text,
  nomenclature          text,
  solicitation_pdf_name text,
  code_block            text,
  -- Only the N versus not-N binary is confirmed. No program name is derived from this.
  set_aside_code        char(1),
  set_aside_restricted  boolean,
  -- Ninth character T or U marks the automated path where an alternate offer cannot win.
  auto_award_eligible   boolean,
  observed_at           timestamptz NOT NULL,
  source_key            text NOT NULL REFERENCES source_registry(source_key),
  storage_key           text NOT NULL,
  line_no               integer NOT NULL,
  UNIQUE (solicitation_number, nsn_raw, pr_number, source_key, observed_at)
);
CREATE INDEX IF NOT EXISTS requirement_niin      ON requirement (niin);
CREATE INDEX IF NOT EXISTS requirement_return_by ON requirement (return_by);
CREATE INDEX IF NOT EXISTS requirement_observed  ON requirement (observed_at DESC);

-- One row per CLIN from the quoting file. A DIFFERENT GRAIN from requirement.
-- (solicitation, clin) is unique at 3,274/3,274; (solicitation, pr) is NOT unique here.
CREATE TABLE IF NOT EXISTS quote_line (
  id                   bigserial PRIMARY KEY,
  solicitation_number  text NOT NULL,
  clin                 text NOT NULL,
  pr_number            text,
  nsn_raw              text,
  niin                 char(9),
  unit_of_issue        text,
  quantity             numeric,
  return_by            date,
  -- CONFIRMED against primary source: 216 of 216 solicitation PDFs matched Block 6
  -- "DELIVER BY (Date)" across 18 distinct values. Not an inference.
  delivery_days_ado    integer,
  item_source_category text,
  observed_at          timestamptz NOT NULL,
  source_key           text NOT NULL REFERENCES source_registry(source_key),
  storage_key          text NOT NULL,
  line_no              integer NOT NULL,
  UNIQUE (solicitation_number, clin, source_key, observed_at)
);
CREATE INDEX IF NOT EXISTS quote_line_niin ON quote_line (niin);
CREATE INDEX IF NOT EXISTS quote_line_sol  ON quote_line (solicitation_number);

-- Which company and part number DLA will accept for an item, as observed on a given day.
-- The highest-value artifact in the free feed: one day's file holds only that day's board,
-- so accumulating it builds a longitudinal table no single day contains. T4's monopoly map
-- sits on this join.
-- `niin` is NULLABLE here and that is deliberate, measured, and reversible only at the cost
-- of real data. 14 of the 3,684 approved-source rows on the real feed day carry LOCALLY
-- ASSIGNED stock numbers (1560LLNC00755, 1560LN0035612, 5306LN0035726 and friends) which are
-- not 13 digits and therefore have no NIIN. They are REAL approved-source relationships
-- published by the government. An earlier NOT NULL here quarantined all 14, which was a
-- silent loss of supplier relationships dressed up as data hygiene.
--
-- Consumers joining on `niin` are unaffected: those rows simply do not match, exactly as when
-- they were absent. The difference is that they are now VISIBLE and countable rather than
-- held, and `nsn_raw` carries the stock number the government actually published.
CREATE TABLE IF NOT EXISTS approved_source (
  id            bigserial PRIMARY KEY,
  nsn_raw       text NOT NULL,
  niin          char(9),
  cage          char(5) NOT NULL,
  part_number   text,
  observed_at   timestamptz NOT NULL,
  source_key    text NOT NULL REFERENCES source_registry(source_key),
  storage_key   text NOT NULL,
  line_no       integer NOT NULL,
  -- Keyed on the RAW stock number, not the NIIN, so a locally assigned number is still unique.
  UNIQUE (nsn_raw, cage, part_number, source_key, observed_at)
);
CREATE INDEX IF NOT EXISTS approved_source_niin ON approved_source (niin);
CREATE INDEX IF NOT EXISTS approved_source_cage ON approved_source (cage);

-- ---------------------------------------------------------------------------
-- Idempotent corrections applied to an existing database.
--
-- `CREATE TABLE IF NOT EXISTS` does not alter a table that already exists, so a corrected
-- column definition above is invisible to a database created before it. These statements are
-- safe to run repeatedly and bring an existing cluster up to the definition above.
--
-- T1 owns migration ordering for the real deployment. These exist so a developer's local
-- cluster cannot silently sit on the superseded shape and report counts nobody can reconcile.
-- ---------------------------------------------------------------------------
ALTER TABLE approved_source ALTER COLUMN niin DROP NOT NULL;
ALTER TABLE approved_source
  DROP CONSTRAINT IF EXISTS approved_source_niin_cage_part_number_source_key_observed_at_key;
CREATE UNIQUE INDEX IF NOT EXISTS approved_source_natural_key
  ON approved_source (nsn_raw, cage, part_number, source_key, observed_at);

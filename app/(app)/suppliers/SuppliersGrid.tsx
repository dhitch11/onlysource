"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { AiLoader } from "@/components/ui/AiLoader";
import { DataGrid, type GridColumn, type Cell } from "@/components/ui/DataGrid";
import { StatusChip } from "@/components/ui/StatusChip";
import type { DistressedSupplier } from "@/lib/intelligence/suppliers/distressed";
import {
  CALL_CAPTURE_FIELDS,
  FOLLOW_UP_CALL_SCRIPT,
  bestRecipient,
  buySideEmailDraft,
  firstNameOf,
  type ComposeRecipient,
  type SupplierNsnFact,
} from "@/lib/sales/outreach-templates";
import type { LeanSupplier, SupplierDetail } from "./wire-lean";
import styles from "./suppliers.module.css";

type Filter = "hot" | "manufacturer" | "all";

// Tier A / hot wears the house brass accent: the act-first band, loud without spending the
// amber that is reserved for the award clock alone.
const tierTone = (tier: string | null): "verified" | "accent" | "idle" => {
  if (!tier) return "idle";
  if (/hot|^a/i.test(tier)) return "accent";
  if (/^b|warm/i.test(tier)) return "verified";
  return "idle";
};

/**
 * A phone number, from DETAIL rather than from the row.
 *
 * The row on the wire carries `hasPhone`, a boolean, and never the number. The grid can say a
 * company is reachable without saying how to reach them, and the number itself only arrives for
 * a company a permitted person opened.
 */
function bestPhone(d: SupplierDetail): string | null {
  if (d.phone) return d.phone;
  const c = d.contacts.find((c) => c.phone);
  return c?.phone ?? null;
}

/**
 * THE COMPOSE DRAFT — the operator's proven buy-side pitch, grounded in this row's own
 * measured fields. Draft only; the operator edits and sends it themselves.
 *
 * What changed and why (audit 2026-08-16): the old draft asked award-dead suppliers to FILL
 * live DLA requirements, which is backwards. Every row on this page is here because it went
 * award-quiet with stock on the shelf; the play is to MARKET that dormant inventory back
 * into the supply chain or BUY it. The greeting now belongs to the person the address
 * belongs to (bestRecipient), the anchor is the row's own last recorded award, and where the
 * award index ties THIS CAGE to a stock number, the draft names it. No em dashes, and the
 * operator signs: nothing after "Thanks,".
 */
function composeHref(r: LeanSupplier, d: SupplierDetail, rec: ComposeRecipient, facts: SupplierNsnFact[]): string {
  const draft = buySideEmailDraft({
    recipientFirstName: firstNameOf(rec.name),
    company: r.company,
    cage: r.cage,
    lastAwardedAt: r.lastAwardedAt,
    holdsInventory: r.holdsInventory,
    nsnFacts: facts,
  });
  return `mailto:${encodeURIComponent(rec.email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}

/** Copy button that shows a brief confirmation. Self-contained state so it works inside a grid cell. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={styles.miniBtn}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {}
      }}
      aria-label={`Copy ${label}`}
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** CSV-safe cell: quote, escape, and neutralise formula-injection leads. */
function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * THE EXPORT, AND WHAT IT DELIBERATELY NO LONGER CONTAINS.
 *
 * It used to write Email, "Email belongs to", Phone and Executive for every row on screen, built
 * entirely in the browser from data the page had already been given. Two things were wrong with
 * that and only one of them was the payload.
 *
 * `data.export` is `sensitive: true` in the permission model and `supplier.identity.view` governs
 * seeing who a supplier is. **Neither was checked.** A client-side Blob download is not a route,
 * so it never passed a permission gate at all: any signed-in caller could take the contact
 * details of every company in the book as a file, including roles defined to withhold exactly
 * that. The same class as the page itself, one step further out, and the harder one to notice
 * because nothing about it looks like a request.
 *
 * So this writes what the OPERATOR CAN SEE ON THE GRID and nothing more. A CSV carrying contact
 * details is a real operator need and it is not gone: it belongs behind a route that checks both
 * permissions and can be audited, which is a server change rather than a Blob.
 */
function exportCsv(rows: LeanSupplier[], name: string) {
  const head = ["Company", "CAGE", "Tier", "Score", "City", "State", "Contacts on file", "Holds inventory", "SAM status", "Last awarded"];
  const lines = [head.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [r.company, r.cage, r.prospectTier, r.prospectScore, r.city, r.state, r.contactCount, r.holdsInventory, r.samStatus, r.lastAwardedAt]
        .map(csvCell)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SuppliersGrid({
  suppliers,
  nsnFacts,
  canSeeIdentities,
}: {
  /*
   * THE WHOLE BOOK, LEAN. Every supplier ships; no contact detail does. `LeanSupplier` has no
   * contacts, email, phone or executive field AT THE TYPE LEVEL, so a future refactor cannot
   * put the contact book back on the wire without a compile error.
   */
  suppliers: LeanSupplier[];
  /** Measured CAGE-to-NSN ties from the award index, computed server-side. Absent CAGE = no tie. */
  nsnFacts: Record<string, SupplierNsnFact[]>;
  /*
   * Whether this caller holds `supplier.identity.view`. A DISPLAY decision only: it chooses
   * whether to offer an affordance and what the refusal says. Every actual contact record comes
   * from a route that checks the permission itself, so a tampered flag reveals nothing.
   */
  canSeeIdentities: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("hot");

  /*
   * ONE COMPANY'S CONTACT DETAILS, FETCHED WHEN A PERSON OPENS THAT COMPANY.
   *
   * Keyed by CAGE and never prefetched. `denied` is kept as a distinct state from `error`
   * because they are different facts and the operator is told which one happened: a refusal
   * names the boundary, a failure says it failed.
   */
  const [detail, setDetail] = useState<
    Record<string, { status: "loading" | "ok" | "denied" | "error"; data?: SupplierDetail }>
  >({});

  const loadDetail = useCallback(
    (cage: string) => {
      if (!cage) return;
      setDetail((cur) => {
        if (cur[cage]) return cur; // already loading, loaded, refused or failed: ask once
        void (async () => {
          try {
            const r = await fetch(`/api/suppliers/detail?cage=${encodeURIComponent(cage)}`, {
              // A 403 must be READ, not followed. `fetch` follows a redirect by default and an
              // auth redirect answering 200 would read as success for a request that never ran.
              redirect: "manual",
            });
            if (r.status === 403) return setDetail((c) => ({ ...c, [cage]: { status: "denied" } }));
            if (!r.ok) return setDetail((c) => ({ ...c, [cage]: { status: "error" } }));
            const body = (await r.json()) as { detail?: SupplierDetail };
            if (!body.detail) return setDetail((c) => ({ ...c, [cage]: { status: "error" } }));
            setDetail((c) => ({ ...c, [cage]: { status: "ok", data: body.detail } }));
          } catch {
            setDetail((c) => ({ ...c, [cage]: { status: "error" } }));
          }
        })();
        return { ...cur, [cage]: { status: "loading" } };
      });
    },
    [],
  );
  /**
   * Switching to "All distressed" re-ranks and re-lays 3,471 rows and measured ~6s on a warm
   * machine. React keeps the previous rows on screen through a transition, which is right, but
   * a screen that silently does nothing for six seconds reads as broken. `pending` drives an
   * explained wait: what is happening, why it takes a moment, and how far along it is.
   */
  const [pending, startTransition] = useTransition();
  const [hideContacted, setHideContacted] = useState(false);
  const [contacted, setContacted] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/suppliers/contacted")
      .then((r) => (r.ok ? r.json() : { contacted: [] }))
      .then((d: { contacted?: string[] }) => setContacted(new Set(d.contacted ?? [])))
      .catch(() => {});
  }, []);

  const toggleContacted = async (cage: string) => {
    // Optimistic; the server is the source of truth on reload.
    setContacted((prev) => {
      const next = new Set(prev);
      if (next.has(cage)) next.delete(cage);
      else next.add(cage);
      return next;
    });
    try {
      const r = await fetch("/api/suppliers/contacted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cage }),
      });
      const d = (await r.json()) as { contacted?: string[] };
      if (d.contacted) setContacted(new Set(d.contacted));
    } catch {}
  };

  const isHot = (r: LeanSupplier) => /hot|^a/i.test(r.prospectTier ?? "");
  const isMfr = (r: LeanSupplier) => /manufact/i.test(r.holdsInventory ?? "");

  const shown = useMemo(() => {
    let base = filter === "hot" ? suppliers.filter(isHot) : filter === "manufacturer" ? suppliers.filter(isMfr) : suppliers;
    if (hideContacted) base = base.filter((r) => !contacted.has(r.cage));
    return base;
  }, [suppliers, filter, hideContacted, contacted]);

  const columns: GridColumn<LeanSupplier>[] = useMemo(
    () => [
      {
        id: "company",
        header: "Company",
        pinned: true,
        width: "24ch",
        sortValue: (r) => r.company ?? "",
        cell: (r): Cell =>
          r.company
            ? {
                state: "known",
                provenance: "measured",
                value: (
                  <span className={styles.companyCell}>
                    <span>{r.company}</span>
                    {contacted.has(r.cage) ? <StatusChip tone="verified">Contacted</StatusChip> : null}
                  </span>
                ),
              }
            : { state: "unknown", reason: "no company name in the file" },
      },
      {
        id: "score",
        header: "Prospect",
        width: "15ch",
        align: "end",
        // The researcher's score and tier, acted on financially, so the fifth-field entry
        // rides the column header (census 2026-08-17: this page had zero explainers).
        helpId: "suppliers.prospect_score",
        sortValue: (r) => r.prospectScore ?? -1,
        cell: (r): Cell =>
          r.prospectScore == null
            ? { state: "unknown", reason: "not scored" }
            : {
                state: "known",
                provenance: "measured",
                value: (
                  <span className={styles.scoreCell}>
                    <span className={`mono ${styles.scoreN}`}>{r.prospectScore}</span>
                    {r.prospectTier ? <StatusChip tone={tierTone(r.prospectTier)}>{r.prospectTier}</StatusChip> : null}
                  </span>
                ),
              },
      },
      {
        id: "loc",
        header: "Location",
        width: "12ch",
        sortValue: (r) => `${r.state ?? ""}${r.city ?? ""}`,
        cell: (r): Cell =>
          r.state || r.city
            ? { state: "known", value: [r.city, r.state].filter(Boolean).join(", "), provenance: "measured" }
            : { state: "empty" },
      },
      {
        id: "holds",
        header: "Holds inventory",
        width: "18ch",
        sortValue: (r) => r.holdsInventory ?? "",
        cell: (r): Cell =>
          r.holdsInventory
            ? { state: "known", value: r.holdsInventory, provenance: "measured" }
            : { state: "unknown", reason: "not researched" },
      },
      {
        id: "reach",
        header: "Reach out",
        width: "22ch",
        cell: (r): Cell => {
          /*
           * ★ THE ROW KNOWS THAT PEOPLE EXIST. IT DOES NOT KNOW WHO THEY ARE.
           *
           * `contactCount` and `hasPhone` travel on the lean row; no name, email or number does.
           * So this cell can be honest about whether a company is reachable without the browser
           * ever holding the means to reach them, and the means arrive only for a company a
           * permitted person actually opened.
           */
          const d = detail[r.cage];
          const rec = d?.status === "ok" && d.data ? bestRecipient(d.data) : null;
          const phone = d?.status === "ok" && d.data ? bestPhone(d.data) : null;

          if (r.contactCount === 0 && !r.hasPhone) {
            return { state: "unknown", reason: "no contact channel in the file" };
          }
          /*
           * The refusal NAMES THE BOUNDARY. A blank cell would teach an operator this company has
           * nobody on file, which is a false statement about the world rather than a true one
           * about their role.
           */
          if (!canSeeIdentities) {
            return {
              state: "unknown",
              reason: `${r.contactCount} on file; your role does not include seeing supplier identities`,
            };
          }
          return {
            state: "known",
            provenance: "measured",
            value: (
              <span className={styles.reachCell}>
                {rec ? (
                  <a
                    className={styles.reachBtn}
                    href={composeHref(r, d!.data!, rec, nsnFacts[r.cage] ?? [])}
                    onClick={(e) => e.stopPropagation()}
                    title={rec.name ? `Drafts to ${rec.name}, ${rec.email}` : `Drafts to ${rec.email}`}
                  >
                    Compose
                  </a>
                ) : null}
                {rec ? <CopyButton text={rec.email} label="Copy email" /> : null}
                {!rec && phone ? <CopyButton text={phone} label="Copy phone" /> : null}
                {!d ? (
                  <button
                    type="button"
                    className={styles.miniBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      loadDetail(r.cage);
                    }}
                    title={`Fetch the ${r.contactCount} contact record(s) held for this company`}
                  >
                    Show contacts ({r.contactCount})
                  </button>
                ) : null}
                {d?.status === "loading" ? <span className={styles.reachNote}>loading…</span> : null}
                {d?.status === "denied" ? (
                  <span className={styles.reachNote}>your role does not include seeing supplier identities</span>
                ) : null}
                {d?.status === "error" ? <span className={styles.reachNote}>could not load</span> : null}
                <button
                  type="button"
                  className={`${styles.miniBtn} ${contacted.has(r.cage) ? styles.miniBtnOn : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleContacted(r.cage);
                  }}
                  aria-pressed={contacted.has(r.cage)}
                >
                  {contacted.has(r.cage) ? "✓ Contacted" : "Mark contacted"}
                </button>
              </span>
            ),
          };
        },
      },
    ],
    // toggleContacted is stable enough; contacted (and the server-computed facts) drive the re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacted, nsnFacts],
  );

  const tabs: Array<{ id: Filter; label: string; n: number }> = [
    { id: "hot", label: "Tier A · hot", n: suppliers.filter(isHot).length },
    { id: "manufacturer", label: "Manufacturers (hold stock)", n: suppliers.filter(isMfr).length },
    { id: "all", label: "All distressed", n: suppliers.length },
  ];

  return (
    <>
      <div className={styles.filters} role="tablist" aria-label="Supplier filters">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={filter === t.id}
            className={`${styles.filter} ${filter === t.id ? styles.filterOn : ""}`}
            onClick={() => startTransition(() => setFilter(t.id))}
          >
            {t.label}
            <span className={styles.filterN}>{t.n.toLocaleString()}</span>
          </button>
        ))}
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          aria-pressed={hideContacted}
          className={`${styles.chip} ${hideContacted ? styles.chipOn : ""}`}
          onClick={() => startTransition(() => setHideContacted((v) => !v))}
        >
          Hide already contacted
          {contacted.size > 0 ? <span className={styles.chipN}>{contacted.size}</span> : null}
        </button>
        <div className={styles.toolbarRight}>
          <span className={styles.resultCount} aria-live="polite">
            {shown.length.toLocaleString()} shown of {suppliers.length.toLocaleString()} in the book
          </span>
          <button type="button" className={styles.exportBtn} onClick={() => exportCsv(shown, `distressed-suppliers-${filter}`)}>
            Export to CSV
          </button>
        </div>
      </div>

      {pending ? (
        <AiLoader
          title={`Re-ranking ${suppliers.length.toLocaleString()} suppliers`}
          stages={[
            "Reading the researched supplier book",
            "Applying the filter you picked",
            "Ranking by prospect score",
            "Laying out the rows",
          ]}
          note="The whole book is held in memory rather than paged, so a filter change re-ranks every firm at once. It is a moment, and then it is instant to sort and search."
        />
      ) : null}

      <DataGrid
        rows={shown}
        columns={columns}
        rowKey={(r) => r.cage}
        label="Distressed DLA suppliers, ranked by researched prospect score"
        density="compact"
        empty={{
          cause: "filtered",
          message: "No supplier matches this filter.",
          onClearFilters: () => {
            setFilter("all");
            setHideContacted(false);
          },
        }}
        /*
         * Opening a row is what FETCHES that company's contact details. Nothing is prefetched,
         * and the request is made once per CAGE. See `loadDetail`.
         */
        onExpand={(r) => { if (r && canSeeIdentities) loadDetail(r.cage); }}
        expansion={(r) => {
          const d = detail[r.cage];
          const det = d?.status === "ok" ? d.data ?? null : null;
          const phone = det ? bestPhone(det) : null;
          const facts = nsnFacts[r.cage] ?? [];
          /*
           * ★ EVERY WITHHELD FIELD SAYS WHY IT IS WITHHELD, AND THE FOUR REASONS ARE DIFFERENT
           * FACTS: not permitted, not yet loaded, failed to load, and genuinely absent. A single
           * blank for all four would teach an operator the company has nothing on file, which is
           * a statement about the world rather than about their session.
           */
          const held =
            det !== null
              ? null
              : !canSeeIdentities
                ? "(your role does not include seeing supplier identities)"
                : d?.status === "loading"
                  ? "(loading…)"
                  : d?.status === "denied"
                    ? "(your role does not include seeing supplier identities)"
                    : d?.status === "error"
                      ? "(could not be loaded)"
                      : "(not loaded)";
          return [
            { field: "CAGE", value: r.cage },
            { field: "Company", value: r.company ?? "(none)" },
            { field: "Why no awards", value: det ? det.whyNoAwards ?? "(not researched)" : held! },
            { field: "Prospect rationale", value: det ? det.prospectRationale ?? "(none)" : held! },
            ...(det?.keyFindings ? [{ field: "Signals", value: det.keyFindings }] : []),
            ...facts.map((f, i) => ({
              field: i === 0 ? "Their stock numbers" : "",
              value: `NSN ${f.nsn} (${f.kind === "awarded" ? "on the recorded award history" : "lists stock"}${f.liveRequirement ? "; open government requirement right now" : ""})`,
            })),
            { field: "Industry", value: r.industry ?? "(unknown)" },
            { field: "Employees", value: r.employees ?? "(unknown)" },
            { field: "SAM", value: [r.samStatus, r.samExpiration ? `expires ${r.samExpiration}` : null].filter(Boolean).join(" · ") || "(not read)" },
            { field: "Holds inventory", value: r.holdsInventory ?? "(not researched)" },
            { field: "Website", value: det ? det.url ?? "(none)" : held! },
            ...(det?.executive ? [{ field: "Executive", value: `${det.executive}${det.executiveTitle ? `, ${det.executiveTitle}` : ""}` }] : []),
            /*
             * EVERY CONTACT, NOT THE FIRST EIGHT.
             *
             * This read `.slice(0, 8)` and hid 1,584 contacts across 276 suppliers, measured
             * against the real file. The supplier an operator has 40 ways to reach is the one
             * worth working, and the slice removed exactly those 32 extra ways with no sign
             * that anything had been removed. A truncation nobody can see reads as a complete
             * list, so the operator stops at eight believing that is all there is.
             *
             * It costs nothing to lift. This branch only runs for a company already expanded
             * and already fetched from /api/suppliers/detail, one at a time, behind
             * `supplier.identity.view`. Nothing here is on the book payload.
             *
             * The count is stated on the first row so the expansion says how long it is
             * rather than making the operator scroll to find out. Median is 4 and the largest
             * is 151, so this is a long list on 2 companies and a short one on 1,966.
             */
            ...(det
              ? det.contacts.map((c, i) => ({
                  field: i === 0 ? `Verified contacts (${det.contacts.length})` : "",
                  value: `${c.name ?? "?"}${c.title ? `, ${c.title}` : ""}${c.email ? ` · ${c.email}` : ""}${c.phone ? ` · ${c.phone}` : ""}${c.verified ? " ✓" : ""}`,
                }))
              : [{ field: "Verified contacts", value: `${r.contactCount} on file ${held}` }]),
            /*
             * THE CALL SIDE OF THE LOOP. When a phone is on file the operator's own
             * follow-up script rides in the expansion, so a call is made with the discovery
             * questions and the capture list open, not from memory. The script is the
             * operator's proven asset, structure intact.
             */
            ...(phone
              ? [
                  ...FOLLOW_UP_CALL_SCRIPT.map((sec, i) => ({
                    field: i === 0 ? "Call script" : "",
                    value: `${sec.label}: ${sec.lines.join(" ")}`,
                  })),
                  {
                    field: "Capture on the call",
                    value: CALL_CAPTURE_FIELDS.map((f) => f.label).join(" · "),
                  },
                ]
              : []),
          ];
        }}
      />
    </>
  );
}

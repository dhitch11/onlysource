"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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

function bestPhone(r: DistressedSupplier): string | null {
  if (r.phone) return r.phone;
  const c = r.contacts.find((c) => c.phone);
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
function composeHref(r: DistressedSupplier, rec: ComposeRecipient, facts: SupplierNsnFact[]): string {
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

function exportCsv(rows: DistressedSupplier[], name: string) {
  const head = ["Company", "CAGE", "Tier", "Score", "City", "State", "Email", "Email belongs to", "Phone", "Executive", "Holds inventory", "SAM status"];
  const lines = [head.map(csvCell).join(",")];
  for (const r of rows) {
    const rec = bestRecipient(r);
    lines.push(
      [r.company, r.cage, r.prospectTier, r.prospectScore, r.city, r.state, rec?.email ?? null, rec?.name ?? null, bestPhone(r), r.executive, r.holdsInventory, r.samStatus]
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
}: {
  suppliers: DistressedSupplier[];
  /** Measured CAGE-to-NSN ties from the award index, computed server-side. Absent CAGE = no tie. */
  nsnFacts: Record<string, SupplierNsnFact[]>;
}) {
  const [filter, setFilter] = useState<Filter>("hot");
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

  const isHot = (r: DistressedSupplier) => /hot|^a/i.test(r.prospectTier ?? "");
  const isMfr = (r: DistressedSupplier) => /manufact/i.test(r.holdsInventory ?? "");

  const shown = useMemo(() => {
    let base = filter === "hot" ? suppliers.filter(isHot) : filter === "manufacturer" ? suppliers.filter(isMfr) : suppliers;
    if (hideContacted) base = base.filter((r) => !contacted.has(r.cage));
    return base;
  }, [suppliers, filter, hideContacted, contacted]);

  const columns: GridColumn<DistressedSupplier>[] = useMemo(
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
          const rec = bestRecipient(r);
          const phone = bestPhone(r);
          if (!rec && !phone) return { state: "unknown", reason: "no contact channel in the file" };
          return {
            state: "known",
            provenance: "measured",
            value: (
              <span className={styles.reachCell}>
                {rec ? (
                  <a
                    className={styles.reachBtn}
                    href={composeHref(r, rec, nsnFacts[r.cage] ?? [])}
                    onClick={(e) => e.stopPropagation()}
                    title={rec.name ? `Drafts to ${rec.name}, ${rec.email}` : `Drafts to ${rec.email}`}
                  >
                    Compose
                  </a>
                ) : null}
                {rec ? <CopyButton text={rec.email} label="Copy email" /> : null}
                {!rec && phone ? <CopyButton text={phone} label="Copy phone" /> : null}
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
            {shown.length.toLocaleString()} shown
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
        expansion={(r) => {
          const phone = bestPhone(r);
          const facts = nsnFacts[r.cage] ?? [];
          return [
            { field: "CAGE", value: r.cage },
            { field: "Company", value: r.company ?? "(none)" },
            { field: "Why no awards", value: r.whyNoAwards ?? "(not researched)" },
            { field: "Prospect rationale", value: r.prospectRationale ?? "(none)" },
            ...(r.keyFindings ? [{ field: "Signals", value: r.keyFindings }] : []),
            ...facts.map((f, i) => ({
              field: i === 0 ? "Their stock numbers" : "",
              value: `NSN ${f.nsn} (${f.kind === "awarded" ? "on the recorded award history" : "lists stock"}${f.liveRequirement ? "; open government requirement right now" : ""})`,
            })),
            { field: "Industry", value: r.industry ?? "(unknown)" },
            { field: "Employees", value: r.employees ?? "(unknown)" },
            { field: "SAM", value: [r.samStatus, r.samExpiration ? `expires ${r.samExpiration}` : null].filter(Boolean).join(" · ") || "(not read)" },
            { field: "Holds inventory", value: r.holdsInventory ?? "(not researched)" },
            { field: "Website", value: r.url ?? "(none)" },
            ...(r.executive ? [{ field: "Executive", value: `${r.executive}${r.executiveTitle ? `, ${r.executiveTitle}` : ""}` }] : []),
            ...r.contacts.slice(0, 8).map((c, i) => ({
              field: i === 0 ? "Verified contacts" : "",
              value: `${c.name ?? "?"}${c.title ? `, ${c.title}` : ""}${c.email ? ` · ${c.email}` : ""}${c.phone ? ` · ${c.phone}` : ""}${c.verified ? " ✓" : ""}`,
            })),
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { DataGrid, type GridColumn, type Cell } from "@/components/ui/DataGrid";
import { StatusChip } from "@/components/ui/StatusChip";
import type { DistressedSupplier } from "@/lib/intelligence/suppliers/distressed";
import styles from "./suppliers.module.css";

type Filter = "hot" | "manufacturer" | "all";

const tierTone = (tier: string | null): "verified" | "urgent" | "idle" => {
  if (!tier) return "idle";
  if (/hot|^a/i.test(tier)) return "urgent";
  if (/^b|warm/i.test(tier)) return "verified";
  return "idle";
};

/** The best email for a supplier: the company email, else the first verified contact with one. */
function bestEmail(r: DistressedSupplier): string | null {
  if (r.email) return r.email;
  const c = r.contacts.find((c) => c.email);
  return c?.email ?? null;
}
function bestPhone(r: DistressedSupplier): string | null {
  if (r.phone) return r.phone;
  const c = r.contacts.find((c) => c.phone);
  return c?.phone ?? null;
}

/** A professional starter the operator edits before sending. Draft only; nothing is sent. */
function composeHref(r: DistressedSupplier, email: string): string {
  const subject = `Defense parts sourcing${r.company ? ` — ${r.company}` : ""}`;
  const body =
    `Hi${r.executive ? ` ${r.executive.split(" ")[0]}` : ""},\n\n` +
    `I work defense-parts sourcing and came across ${r.company ?? "your company"} (CAGE ${r.cage}). ` +
    `I have live DLA requirements I think you may be positioned to fill.\n\n` +
    `Do you have a few minutes this week to compare notes?\n\n` +
    `Thanks,\n`;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
  const head = ["Company", "CAGE", "Tier", "Score", "City", "State", "Email", "Phone", "Executive", "Holds inventory", "SAM status"];
  const lines = [head.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [r.company, r.cage, r.prospectTier, r.prospectScore, r.city, r.state, bestEmail(r), bestPhone(r), r.executive, r.holdsInventory, r.samStatus]
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

export function SuppliersGrid({ suppliers }: { suppliers: DistressedSupplier[] }) {
  const [filter, setFilter] = useState<Filter>("hot");
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
          const email = bestEmail(r);
          const phone = bestPhone(r);
          if (!email && !phone) return { state: "unknown", reason: "no contact channel in the file" };
          return {
            state: "known",
            provenance: "measured",
            value: (
              <span className={styles.reachCell}>
                {email ? (
                  <a className={styles.reachBtn} href={composeHref(r, email)} onClick={(e) => e.stopPropagation()}>
                    Compose
                  </a>
                ) : null}
                {email ? <CopyButton text={email} label="Copy email" /> : null}
                {!email && phone ? <CopyButton text={phone} label="Copy phone" /> : null}
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
    // toggleContacted is stable enough; contacted drives the re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacted],
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
            onClick={() => setFilter(t.id)}
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
          onClick={() => setHideContacted((v) => !v)}
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
        expansion={(r) => [
          { field: "CAGE", value: r.cage },
          { field: "Company", value: r.company ?? "(none)" },
          { field: "Why no awards", value: r.whyNoAwards ?? "(not researched)" },
          { field: "Prospect rationale", value: r.prospectRationale ?? "(none)" },
          ...(r.keyFindings ? [{ field: "Signals", value: r.keyFindings }] : []),
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
        ]}
      />
    </>
  );
}

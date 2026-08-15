"use client";

import { useMemo, useState } from "react";
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

const columns: GridColumn<DistressedSupplier>[] = [
  {
    id: "company",
    header: "Company",
    pinned: true,
    width: "26ch",
    sortValue: (r) => r.company ?? "",
    cell: (r): Cell =>
      r.company
        ? { state: "known", value: r.company, provenance: "measured" }
        : { state: "unknown", reason: "no company name in the file" },
  },
  {
    id: "score",
    header: "Prospect",
    width: "16ch",
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
    width: "20ch",
    sortValue: (r) => r.holdsInventory ?? "",
    cell: (r): Cell =>
      r.holdsInventory
        ? { state: "known", value: r.holdsInventory, provenance: "measured" }
        : { state: "unknown", reason: "not researched" },
  },
  {
    id: "sam",
    header: "SAM status",
    width: "14ch",
    sortValue: (r) => r.samStatus ?? "",
    cell: (r): Cell => {
      if (!r.samStatus) return { state: "unknown", reason: "not read" };
      const dead = /expired|inactive|lapsed/i.test(r.samStatus);
      return {
        state: "known",
        provenance: "measured",
        value: <StatusChip tone={dead ? "urgent" : "idle"}>{r.samStatus}</StatusChip>,
      };
    },
  },
  {
    id: "contacts",
    header: "Contacts",
    width: "11ch",
    align: "end",
    sortValue: (r) => r.contacts.length,
    cell: (r): Cell =>
      r.contacts.length === 0
        ? { state: "empty" }
        : { state: "known", provenance: "measured", value: <StatusChip tone="idle">{r.contacts.length}</StatusChip> },
  },
];

export function SuppliersGrid({ suppliers }: { suppliers: DistressedSupplier[] }) {
  const [filter, setFilter] = useState<Filter>("hot");

  const isHot = (r: DistressedSupplier) => /hot|^a/i.test(r.prospectTier ?? "");
  const isMfr = (r: DistressedSupplier) => /manufact/i.test(r.holdsInventory ?? "");

  const shown = useMemo(() => {
    const base = filter === "hot" ? suppliers.filter(isHot) : filter === "manufacturer" ? suppliers.filter(isMfr) : suppliers;
    return base; // already sorted by score in the builder
  }, [suppliers, filter]);

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

      <DataGrid
        rows={shown}
        columns={columns}
        rowKey={(r) => r.cage}
        label="Distressed DLA suppliers, ranked by researched prospect score"
        density="compact"
        empty={{
          cause: "filtered",
          message: "No supplier matches this filter.",
          onClearFilters: () => setFilter("all"),
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

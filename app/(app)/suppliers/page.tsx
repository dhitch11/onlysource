import type { Metadata } from "next";
import { requireGateSession } from "@/lib/session/require-gate";
import { buildDistressedSuppliers } from "@/lib/intelligence/suppliers/distressed";
import { supplierNsnFacts } from "@/lib/intelligence/suppliers/outreach-dossier";
import { resolveDataRoot } from "@/lib/data-root";
import { ExplainButton } from "@/components/ui/ExplainButton";
import { SuppliersGrid } from "./SuppliersGrid";
import styles from "./suppliers.module.css";

export const metadata: Metadata = { title: "Distressed Suppliers · ONLYSOURCE" };
export const dynamic = "force-dynamic";

/**
 * THE BOOK OF BUSINESS — companies that stopped winning DLA awards and are sitting on inventory.
 *
 * Wayne's play: a manufacturer or distributor that has gone quiet sold parts to DLA and still holds
 * that stock. When it exits, the inventory is a burden it scraps. If any of those parts are still on
 * the government's forward-buy list, that dead inventory is pure opportunity. This page is the
 * researched, contactable version of that list: 3,471 firms, each scored, with verified contacts.
 *
 * Every field is read from the researched file. The prospect score and tier are the researcher's,
 * carried through and labeled as such. A blank is rendered absent, never invented. The page is gated
 * because it carries real people's contact details.
 */
export default async function SuppliersPage() {
  await requireGateSession("/suppliers");

  if (!resolveDataRoot().present) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Intelligence</p>
          <h1 className={styles.h1}>Distressed Suppliers</h1>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>The supplier data is not mounted here</h2>
          <p>Nothing is shown rather than a fabricated list.</p>
        </div>
      </main>
    );
  }

  const ix = buildDistressedSuppliers();
  if (!ix.ok) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Intelligence</p>
          <h1 className={styles.h1}>Distressed Suppliers</h1>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>The enriched supplier file is not loaded</h2>
          <p>{ix.reason}</p>
        </div>
      </main>
    );
  }

  const { suppliers, counts } = ix;

  // Measured CAGE-to-NSN ties from the award index (awarded history and listed stock, with
  // the open-requirement flag). They personalise the compose draft with facts the data
  // actually holds; a CAGE with no tie gets no line, never a padded one.
  const nsnFacts = supplierNsnFacts(suppliers.map((s) => s.cage));

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Intelligence · the book of business</p>
        <h1 className={styles.h1}>Distressed Suppliers</h1>
        <p className={styles.sub}>
          Companies that have stopped winning DLA awards, each researched and scored. A manufacturer
          that has gone quiet is sitting on inventory it sold the government. That dead stock is the
          opportunity. Ranked by the researcher&rsquo;s prospect score, with verified contacts.
        </p>
      </header>

      <section className={styles.stats} aria-label="Counts">
        <div className={`${styles.stat} ${styles.statHot}`}>
          <div className={styles.statHelp}>
            <ExplainButton helpId="monopoly.distressed_tier_a" size="sm" />
          </div>
          <div className={styles.statN}>{counts.tierA.toLocaleString()}</div>
          <div className={styles.statL}>
            <b>Tier A prospects</b>
            <span className={styles.statHint}>hottest: dead inventory, contactable</span>
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statN}>{counts.suppliers.toLocaleString()}</div>
          <div className={styles.statL}>
            distressed suppliers
            <span className={styles.statHint}>award-silent, researched</span>
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statN}>{counts.verifiedContacts.toLocaleString()}</div>
          <div className={styles.statL}>
            verified contacts
            <span className={styles.statHint}>names, titles, emails, phones</span>
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statN}>{counts.withEmail.toLocaleString()}</div>
          <div className={styles.statL}>
            reachable by email
            <span className={styles.statHint}>at least one verified address</span>
          </div>
        </div>
      </section>

      <div className={styles.truth}>
        <span className={styles.truthDot} aria-hidden="true" />
        <p>
          Every figure and contact here is read from the researched file. The prospect score and tier
          are the researcher&rsquo;s judgment, carried through unchanged and labeled as theirs, never
          recomputed here. A blank field renders as absent, not invented. This page holds real
          people&rsquo;s contact details, so it lives behind the gate and is never public.
        </p>
      </div>

      <SuppliersGrid suppliers={suppliers} nsnFacts={nsnFacts} />
    </main>
  );
}

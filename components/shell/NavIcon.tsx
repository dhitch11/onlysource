/*
 * Nav icons. Owner: T8 DESIGN.
 *
 * Geometry taken from the approved console mockup's inline SVGs. One icon family, drawn on
 * the same 24 unit grid at the same 1.6 stroke weight, because a nav that mixes two icon
 * families is the fastest way for a product to look assembled rather than designed. That is
 * a first-customer gate item (C-A.6, "the one icon family").
 *
 * ALL OF THEM ARE aria-hidden. The nav item's own text is the accessible name. An icon that
 * duplicates its adjacent label into the accessibility tree makes a screen reader say
 * everything twice, which is worse than having no icon at all.
 *
 * They inherit currentColor, so the active brass state and both themes are handled by the
 * nav item's colour and this file never needs to know about either.
 */

export type NavIconName =
  | "dashboard"
  | "board"
  | "sales"
  | "hunter"
  | "map"
  | "documents"
  | "suppliers"
  | "admin"
  | "intelligence"
  | "goldmine"
  | "groups"
  | "competitor"
  | "hubzone"
  | "settings"
  | "pricing"
  | "design";

const PATHS: Record<NavIconName, React.ReactNode> = {
  dashboard: <path d="M3 13h8V3H3zM13 21h8V8h-8zM3 21h8v-5H3zM13 5h8V3h-8z" />,
  board: (
    <>
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </>
  ),
  sales: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </>
  ),
  // A price tag. Distinct from `sales` (a trend line) because the desk answers "what do I
  // quote", not "how is the pipeline moving", and two nav items sharing a glyph teach the
  // operator they are the same screen.
  pricing: (
    <>
      <path d="M3 12V4a1 1 0 011-1h8l9 9-9 9z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  // The Hunter Mode star, which the approved console renders in amber.
  hunter: <path d="M12 2l2 5 5 .5-3.8 3.4 1.2 5.1L12 18l-4.6 2 1.2-5.1L4.8 11.5 10 11z" />,
  map: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18M3 12h18" />
    </>
  ),
  documents: (
    <>
      <path d="M6 2h9l3 3v17H6z" />
      <path d="M9 12h6M9 16h6" />
    </>
  ),
  suppliers: (
    <>
      <path d="M3 21V8l9-5 9 5v13" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  admin: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  // The no-quote goldmine: a cut gem, the uncontested win.
  goldmine: (
    <>
      <path d="M6 3h12l3 5-9 13L3 8z" />
      <path d="M3 8h18M9 3 7.5 8 12 21M15 3l1.5 5L12 21" />
    </>
  ),
  // Supply groups: a classification tag, the shape of a thing being filed into a class.
  // Deliberately not another grid of rectangles: `board` already owns that silhouette, and
  // two nav rows drawn alike is how an operator clicks the wrong one twice a day.
  groups: (
    <>
      <path d="M12.4 3H21v8.6l-9.4 9.4L3 12.4z" />
      <circle cx="16.9" cy="7.1" r="1.4" />
    </>
  ),
  // The intelligence dashboard: ascending bars, a chart read at a glance.
  intelligence: (
    <>
      <path d="M3 21h18" />
      <rect x="5" y="12" width="3.5" height="7" />
      <rect x="10.5" y="8" width="3.5" height="11" />
      <rect x="16" y="4" width="3.5" height="15" />
    </>
  ),
  // Competitor teardown: a flag planted on taken ground.
  competitor: (
    <>
      <path d="M5 3v18" />
      <path d="M5 4h11l-2 3 2 3H5" />
    </>
  ),
  // HUBZone set-asides: a zone pin.
  hubzone: (
    <>
      <path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10Z" />
      <circle cx="12" cy="11" r="2.2" />
    </>
  ),
  // Settings: a gear.
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  design: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
};

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "none" }}
    >
      {PATHS[name]}
    </svg>
  );
}

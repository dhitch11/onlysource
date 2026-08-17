/**
 * HELP CONTENT FOR MANUFACTURER RESOLUTION. Written by the manufacturers lane.
 *
 * `owner` reads T4 INTELLIGENCE for the same reason the groups entries do: these sentences
 * explain what an approved source IS on the corner map, and T4 is the lane accountable for that
 * definition. Inventing a new HelpOwner for one surface would mean editing the union in T8's
 * registry to record an authorship fact this header already carries.
 *
 * Registry writing rule 5 is followed strictly: not one count is typed into a sentence below.
 * The numbers belong on the surface, computed, beside their source.
 *
 * The entry that took the longest to write honestly is `manufacturers.suspected`. It describes
 * an inference OF OURS that can be wrong in the expensive direction, and the operator has to be
 * able to tell it apart from the government's own record without reading a legend.
 */
import type { HelpRecord } from '@/components/help/registry'

export const MANUFACTURER_ENTRIES: HelpRecord[] = [
  {
    id: 'manufacturers.operator',
    owner: 'T4 INTELLIGENCE',
    title: 'Companies, not codes',
    what: 'A CAGE code identifies a location on a government list. One company can hold several, in different towns, under slightly different names.',
    how: 'Read the company count rather than the code count when you judge whether an item is really competed. Open the row to see which codes were folded together and on what evidence.',
    why: 'Two approved sources that turn out to be one firm is a corner being reported as a competitive market. That is the difference between an item worth stocking and one that is not.',
    source: 'The free CAGE master published by DLA in the PUB LOG extract, refreshed on the first business day of each month, joined to the corporate complex table from the same extract.',
  },
  {
    id: 'manufacturers.confirmed',
    owner: 'T4 INTELLIGENCE',
    title: 'One company, on the record',
    what: 'The government’s own corporate complex file puts these codes under one association. A record we read, not a conclusion we drew.',
    how: 'Treat it as settled. Count the group as one supplier when you judge how competed the item is.',
    why: 'It is the strongest evidence available for this question and it costs nothing to check, so any surface that ignores it is overstating how many suppliers an item has.',
    source: 'The corporate complex table in the H series of the PUB LOG extract, read through its association field. The separate parent field in the same table is published empty and is not used.',
  },
  {
    id: 'manufacturers.suspected',
    owner: 'T4 INTELLIGENCE',
    title: 'One company, our reading',
    what: 'The government does not link these codes, but they share a company name and a contract administration office, so we read them as one firm.',
    how: 'Check it before you act on it. Look at the names and the towns in the row, and if they are not the same firm, treat the item as competed.',
    why: 'This is the one place on this surface where we could be wrong in the expensive direction. Folding two real companies into one invents a monopoly, and inventory bought against an invented monopoly does not sell.',
    source: 'Company names and contract administration offices from the free CAGE master. Both must agree before codes are folded, because either one on its own joins firms that are unrelated.',
  },
  {
    id: 'manufacturers.unresolved',
    owner: 'T4 INTELLIGENCE',
    title: 'Code not in the company index',
    what: 'This code appears in the feed but not in the company index we derived, so we cannot name the firm behind it.',
    how: 'Count it as its own supplier and look the code up directly if the item matters to you.',
    why: 'Guessing that an unknown code belongs to a company already on the row would be the fastest way to invent a corner. An unnamed supplier is still a supplier.',
    source: 'The index is derived from the CAGE master for the codes the feed referenced when it was last built. A code first seen after that build will not be in it until the next refresh.',
  },
]

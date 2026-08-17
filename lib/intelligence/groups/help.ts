/**
 * HELP CONTENT FOR THE SUPPLY GROUPS SURFACE. Written by the groups lane.
 *
 * `owner` reads T4 INTELLIGENCE on every entry, deliberately and not as a placeholder: these
 * sentences explain corner-map numbers, and T4 is the lane accountable for what a candidate
 * corner IS. Inventing a ninth HelpOwner for one surface would have meant editing the union in
 * T8's registry file to record an authorship fact the file header already carries.
 *
 * Registry writing rule 5 governs every sentence here: not one figure is typed in. The counts
 * belong on the surface, computed, beside their source. A restated number goes stale silently
 * and then contradicts the screen it claims to explain.
 *
 * The hardest entry to write honestly was `groups.evidence`. The surface grades classes, and a
 * grade is an inference, not a count. The explanation has to leave an operator able to tell the
 * difference between "the government's file says so" and "we tested this and it held up", which
 * is the difference between a fact and a bet.
 */
import type { HelpRecord } from '@/components/help/registry'

export const GROUPS_ENTRIES: HelpRecord[] = [
  {
    id: 'groups.map',
    owner: 'T4 INTELLIGENCE',
    title: 'Supply groups',
    what: 'Every stock number the government buys sits in a Federal Supply Class, and the first four digits of the stock number are that class.',
    how: 'Use it to pick a lane. Open the classes where corners are concentrated and work those rows first, instead of reading the whole map every morning.',
    why: 'A dealer who owns two or three classes outbuys a generalist in all of them. Specialisation is how a small operation beats a bigger one, and this is the surface that tells you which classes are worth specialising in.',
    source: 'The class and group titles come from the H2 tables in the DLA PUB LOG extract, published free and refreshed on the first business day of each month. The counts come from the same corner map the Monopoly Map ranks.',
  },
  {
    id: 'groups.class',
    owner: 'T4 INTELLIGENCE',
    title: 'Federal Supply Class',
    what: 'The government’s own four digit segmentation of everything it buys, with its own written statement of what belongs in the class and what does not.',
    how: 'Read the includes and excludes lines before you commit to a class. They are the government’s definition, not ours, and they decide which requirements land in it.',
    why: 'Two classes that sound alike can behave nothing alike commercially. Buying inventory against the wrong one means holding material the requirements never come to.',
    source: 'V_H2_FSC in the H series of the PUB LOG extract. The class code is read from the first four characters of the stock number on each row.',
  },
  {
    id: 'groups.evidence',
    owner: 'T4 INTELLIGENCE',
    title: 'How strong is this class signal',
    what: 'Whether a class genuinely has more candidate corners than the map average, or whether it only looks that way because we compared many classes at once.',
    how: 'Act on the classes marked as tested and holding. Treat the ones marked indicative as somewhere to look, not as a reason to buy.',
    why: 'Compare thirty classes against an average and roughly one will look exceptional from chance alone. Stocking against that one is how a real budget gets spent on a coincidence.',
    source: 'An exact binomial test of each class against the whole map rate, with the threshold divided by the number of classes tested. Classes below the row floor get no rate and no grade at all.',
  },
  {
    id: 'groups.baseline',
    owner: 'T4 INTELLIGENCE',
    title: 'Map average',
    what: 'The share of all rows on the corner map that are candidate corners, used as the line every class is measured against.',
    how: 'Read a class rate next to it. A class at the average tells you nothing about the class, only about the map.',
    why: 'Without a baseline a percentage is a decoration. It is the gap between a class and the map that says whether the class is worth your time.',
    source: 'Counted from the corner map for the current feed day, using the same candidate definition the Monopoly Map uses.',
  },
  {
    id: 'groups.insufficient',
    owner: 'T4 INTELLIGENCE',
    title: 'Not enough rows',
    what: 'The class holds too few stock numbers on this feed day for a rate to mean anything, so none is shown.',
    how: 'Read the counts, which are real, and ignore the absent percentage. Come back when the class has more rows.',
    why: 'Three candidates out of four rows reads as seventy five percent and is nothing. Publishing that number would send someone shopping against four data points.',
    source: 'The row floor is applied before any rate is computed. The counts beside it are plain counts of rows on the current feed day.',
  },
]

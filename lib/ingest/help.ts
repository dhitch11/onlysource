/**
 * T2 DATA's help entries. The lane that owns the number writes the sentence; these cover
 * the ingest-owned surfaces, starting with the chrome freshness pill.
 *
 * Registered in components/help/registry.ts with the import and the register call in the
 * same edit, because this registry has now twice seen the halves shipped separately: once
 * as a register call with no import (broke tsc fleet-wide) and once as entries with no
 * register call (reachable by nobody).
 */

import type { HelpRecord } from '@/components/help/registry'

export const T2_ENTRIES: HelpRecord[] = [
  {
    id: 'data.feed_freshness',
    owner: 'T2 DATA',
    title: 'Government data age',
    what: 'Which day of government files this whole app is reading, and how far behind today that is.',
    how: 'Check the state word before trusting any list here. Fresh means the newest publishable day. Aging means capture is being missed. Stale means you are reading old market data and newer days may already be archived awaiting load.',
    why: 'DLA deletes its daily files after roughly 28 business days. A day nobody captured in that window is market history nobody can ever buy, and quoting from a stale board means chasing requirements that may already be closed.',
    source: 'Measured from the archive manifest: the feed day every surface is built from, aged in US federal business days (weekends and observed federal holidays skipped, Eastern calendar) against the current date.',
    whatThisDoesNotDo:
      'It does not say the day\'s files are COMPLETE, only how old the served day is. A day can be fresh and still be missing its PDF package, and the pill cannot see whether DLA published late.',
  },
]

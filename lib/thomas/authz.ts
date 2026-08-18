import 'server-only'
import { PERMISSIONS, can, permission } from '@/lib/admin/permissions'
import { callerPermissions, type Caller } from '@/lib/session/authz'

/**
 * WHAT THOMAS MAY READ, FOR THE PERSON WHO IS ACTUALLY ASKING.
 *
 * ==========================================================================================
 * THE DEFECT THIS EXISTS TO END, AND IT IS THE SAME SHAPE AS THE ONE `lib/session/authz.ts`
 * ENDED ON THE WRITE PATH.
 * ==========================================================================================
 * Authorization now reaches every mutating route: the caller is resolved from the gate token and
 * a permission is checked before anything changes. That protects the WRITE path completely and
 * leaves the READ path open, because FOUR of the fourteen permissions govern SEEING a fact
 * rather than pressing a button: `supplier.identity.view`, `margin.view`, `document.view` and
 * `data.export`, each carrying `sensitive: true`.
 *
 * Thomas is a read path with a natural language front door. A `read_only` account cannot open a
 * supplier identity in the interface, and could ask Thomas who holds the material, and the answer
 * came back grounded, accurate, and carrying its provenance. The role model read correctly on the
 * Admin screen, was enforced on every mutating route, and was bypassable by typing a question.
 *
 * AN AI SURFACE WITH TOOL ACCESS IS A SECOND, UN MODELLED READ PATH TO EVERY FACT ITS TOOLS CAN
 * REACH, AND IT INHERITS NONE OF THE INTERFACE'S GATING FOR FREE.
 *
 * ==========================================================================================
 * FOUR DECISIONS, EACH ONE A REFUSAL THAT A TEST IN test/thomas/ HOLDS IN PLACE.
 * ==========================================================================================
 *  1. IDENTITY IS NOT RE IMPLEMENTED HERE. `readCaller()` resolves who is asking against the
 *     roster as it is NOW, and `callerPermissions()` says what they hold. This module only maps
 *     TOOLS to the permission their DATA needs. A second identity resolver is a second answer to
 *     the same question, and the two drift on the day somebody is deactivated.
 *
 *  2. THE TOOL LIST IS IDENTICAL FOR EVERY CALLER, AND THE REFUSAL IS A SENTENCE. Withholding
 *     the tool from the model instead would produce "I do not have that", which is the worst
 *     available outcome: it teaches the operator to read a permission boundary as a gap in the
 *     data, and once they believe the data is thin they stop trusting every honest abstention
 *     the product makes anywhere else. So the tool is offered, the call is refused, and the
 *     refusal names the boundary out loud. It also keeps the request shape stable across callers,
 *     which the prompt cache depends on.
 *
 *  3. FAIL CLOSED, IN BOTH DIRECTIONS. A tool this map does not name refuses rather than runs, so
 *     adding a tool without deciding what it exposes is a dead tool and never an open one. A
 *     caller who cannot be resolved holds NOTHING, which is `callerPermissions()`'s own answer for
 *     an anonymous, deactivated or unknown subject.
 *
 *  4. THE MACHINE BRIDGE IS THE MOST RESTRICTED CALLER IN THE SYSTEM. `app/api/thomas/convai/**`
 *     is called by ElevenLabs' servers, which hold no cookie and never will. Its bearer secret
 *     proves WHICH SERVICE is calling. It does not prove a person with rights is behind it, and
 *     the `operator` name on that path arrives inside a client written system message, so it is
 *     display context and never an identity claim. That caller therefore holds every NON sensitive
 *     operator permission and no sensitive one, computed from the catalog rather than listed, so a
 *     permission added as sensitive tomorrow is excluded the moment it exists.
 */

/** What the dispatch layer is handed. Small on purpose: a permission set and who it belongs to. */
export type ToolAccess = {
  /** Every permission key this caller holds. The empty array is a complete answer. */
  held: readonly string[]
  /** How the caller was resolved. Used for the wording, never for the decision. */
  kind: 'account' | 'bootstrap' | 'anonymous' | 'machine'
  /** The role name a person would recognise, for the sentence Thomas says. */
  roleName: string
}

/**
 * THE MAP. Each server tool against the permission keys ITS OWN OUTPUT needs, all of which the
 * caller must hold. Requiring all of them is the fail closed direction: a dossier paragraph
 * carries an identity leg and a pricing leg in one breath, and there is no way to speak half of it
 * without rewriting what the tool returns.
 *
 * WHY EACH ONE, because a mapping nobody can defend is a mapping somebody widens later:
 *
 *  lookup_stock_number  -> supplier.identity.view + margin.view
 *      It NAMES the approved sources and says whether that holder has gone award silent, which is
 *      exactly "see which supplier a quote or lot came from". It also reports first and last unit
 *      price and the escalation between them, which is the pricing a quote gets built on.
 *
 *  portfolio_snapshot   -> board.view
 *      Counts, the feed day, the supply chain split and the top corners by score. That is the
 *      daily requirements board in aggregate. It names no firm, and its spoken text carries no
 *      unit price. See the harvest note in `portfolioSnapshot()` in tools.ts, where that distinction bites.
 *
 *  find_opportunities   -> board.view + margin.view
 *      A search over the same board rows, and every row it returns is printed with its last
 *      measured price and its escalation.
 *
 *  goldmine_snapshot    -> board.view + margin.view
 *      Solicitation rows with a quantity, a last sold price each, and a computed size of buy in
 *      dollars. No firm is named anywhere in it, so no identity key.
 *
 *  supplier_snapshot    -> supplier.identity.view
 *      It names firms and CAGE codes and says which of them carry contact detail. That is the
 *      supplier identity permission in its plainest form.
 *
 * `data.export` MAPS TO NOTHING, DELIBERATELY. Thomas hands back speech and text, never a file,
 * so no tool here is a download. The day a tool returns a file, an attachment or a signed URL,
 * that tool requires `data.export` and this comment is how the next person knows it.
 *
 * THE CLIENT TOOLS ARE NOT IN THIS MAP, AND THAT IS NOT AN OMISSION. `navigate`, `open_dossier` and
 * `set_filter` return no data: they are dispatched to the browser, which pushes a route. The page
 * that then loads is a normal authenticated surface and enforces its own reads, so a caller who may
 * not see a supplier identity is sent to a page that will not show them one. Gating the dispatch
 * as well would refuse a movement the operator could have made with their own mouse, and it would
 * be enforcing a read on the surface that does not perform the read. `runServerTool` is the only
 * caller of `refuseTool`, and `isServerTool` is what separates the two lists.
 */
export const TOOL_PERMISSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  lookup_stock_number: Object.freeze(['supplier.identity.view', 'margin.view']),
  portfolio_snapshot: Object.freeze(['board.view']),
  find_opportunities: Object.freeze(['board.view', 'margin.view']),
  goldmine_snapshot: Object.freeze(['board.view', 'margin.view']),
  supplier_snapshot: Object.freeze(['supplier.identity.view']),
})

/**
 * How each permission is SAID in a sentence a trader reads. The catalog's own label is the
 * authority on what the permission is called; this is only how it sounds mid sentence, and
 * `test/thomas/tool-permissions.test.ts` fails if a key here stops existing in the catalog.
 */
const SPOKEN_CLASS: Readonly<Record<string, string>> = Object.freeze({
  'supplier.identity.view': 'supplier identities',
  'margin.view': 'cost and pricing',
  'document.view': 'document bodies',
  'data.export': 'data export',
  'board.view': 'the requirements board',
  'board.quote': 'quoting',
  'supplier.pursue': 'supplier pursuit',
  'data.import': 'importing data',
})

/** The phrase for a key, falling back to the catalog label and then to the key itself. */
export function spokenClass(key: string): string {
  return SPOKEN_CLASS[key] ?? permission(key)?.label ?? key
}

/**
 * The keys a tool needs, or null when this build does not know.
 *
 * Null is the fail closed answer and every caller has to handle it. A tool that is added to
 * `SERVER_TOOLS` and forgotten here must refuse, never run: an unmapped tool that ran would be a
 * new read path opened by an edit nobody reviewed as a security change.
 */
export function toolPermissions(name: string): readonly string[] | null {
  return Object.prototype.hasOwnProperty.call(TOOL_PERMISSIONS, name) ? TOOL_PERMISSIONS[name]! : null
}

/** The keys this access is missing for that tool. Empty means it may run. */
export function missingFor(name: string, access: ToolAccess): readonly string[] | null {
  const required = toolPermissions(name)
  if (required === null) return null
  return required.filter((k) => !can(access.held, k))
}

export type ToolRefusal = {
  /** What goes back to the model in place of a tool result. Shaped to be spoken, like every other. */
  text: string
  /** The permission keys that were missing. Empty for an unmapped tool. */
  missing: readonly string[]
  /** How those keys are said out loud, for the interface chip and the firewall notice. */
  classes: readonly string[]
}

/**
 * The refusal for one tool call, or null when the caller may make it.
 *
 * The text is an INSTRUCTION, in the same register as every other tool result in this lane, because
 * the model is the one who speaks and it needs to know three things: that this is a permission
 * boundary and not missing data, that it must say so, and that it may still answer the rest.
 */
export function refuseTool(name: string, access: ToolAccess): ToolRefusal | null {
  const missing = missingFor(name, access)

  if (missing === null) {
    return {
      text: [
        `REFUSED. This build has no permission mapping for the tool "${name}", so it did not run.`,
        'Tell the operator plainly that you cannot run that lookup here and that it is a gap on our side,',
        'not something about their account. Do not answer the question from memory or from background notes.',
      ].join(' '),
      missing: [],
      classes: [],
    }
  }
  if (!missing.length) return null

  const classes = missing.map(spokenClass)
  const spoken = joinPhrases(classes)
  const who = refusalOpening(access, spoken)

  return {
    text: [
      who,
      'Do NOT answer any part of it from memory, from your background notes, or from anything earlier in this',
      'conversation. Do NOT quietly leave it out either: a silent omission teaches them to read a permission',
      'boundary as a gap in the data, and then they stop believing you every other time you say you do not know.',
      'You may still answer anything in their question that does not need that permission.',
    ].join(' '),
    missing,
    classes,
  }
}

/**
 * WHO IS BEING REFUSED, AND THEREFORE WHICH SENTENCE THEY GET. Three callers, three situations,
 * three different things the person on the other end can DO about it, so three openings.
 *
 * The anonymous one is not a cosmetic split. `roleName` for an unresolved caller is "No account",
 * and the account wording would have produced "your role, No account, does not include supplier
 * identities", which invites them to go asking an owner for a permission when the actual problem is
 * that their session no longer resolves to anybody. That is a wrong instruction dressed as a
 * helpful one, and it sends them to the wrong person.
 */
function refusalOpening(access: ToolAccess, spoken: string): string {
  if (access.kind === 'machine') {
    return [
      'REFUSED BY PERMISSION. This is the spoken bridge, which carries no signed in identity at all, so',
      `${spoken} cannot be read on this line for anybody.`,
      'Say that plainly in one sentence: you cannot give them that over the phone line because this line',
      'holds no account, and the typed panel inside the app will answer it when their role allows.',
    ].join(' ')
  }
  if (access.kind === 'anonymous') {
    return [
      'REFUSED. This session does not resolve to an account in the roster, so it holds nothing at all,',
      `and ${spoken} cannot be read here.`,
      'Say plainly that their sign in is no longer attached to an active account, so you cannot pull',
      'anything from the book for them, and that signing in again is what fixes it. Do NOT tell them to',
      'ask an owner for a permission: the problem is the session, not the role.',
    ].join(' ')
  }
  return [
    `REFUSED BY PERMISSION, not by missing data. The operator's role, ${access.roleName}, does not include`,
    `${spoken}, so this lookup did not run.`,
    `Say it plainly in one sentence, in your own words, close to: "your role does not include ${spoken},`,
    'so I cannot give you that here". Tell them an owner can grant it.',
  ].join(' ')
}

/** "a and b", "a, b and c". Small, and it keeps the refusal reading like a person wrote it. */
function joinPhrases(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? 'that'
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * Every permission key that some server tool actually requires. Derived from the map above, so a
 * tool added tomorrow widens this on its own and a tool deleted narrows it.
 */
const TOOL_REQUIRED_KEYS: ReadonlySet<string> = new Set(Object.values(TOOL_PERMISSIONS).flat())

/**
 * The sensitive classes this caller cannot reach THROUGH THOMAS, said out loud.
 *
 * Used for the per turn notice, so Thomas knows the boundary BEFORE he reaches for a tool and can
 * answer the permitted part in the same breath, rather than promising something and then refusing.
 *
 * ==========================================================================================
 * WHY IT IS INTERSECTED WITH WHAT THE TOOLS ACTUALLY NEED, AND NOT JUST "EVERY SENSITIVE KEY".
 * ==========================================================================================
 * It was every sensitive key the caller lacks, and `test/thomas/tool-permissions.test.ts` measured
 * what that produces for a `read_only` account: "your role does not include Manage connections,
 * Read the audit log and Use break-glass view", alongside the two classes that are genuinely at
 * stake. Those three are admin-console capabilities. NO tool here can read them for anybody, at any
 * role, so naming them is not caution, it is a false implication that Thomas would have surfaced
 * the audit log for a bigger role. A boundary notice that lists things the product cannot do either
 * way trains the operator to skim it, and the two lines that matter go with it.
 *
 * So the notice names exactly what Thomas will refuse: sensitive, required by a real tool, not
 * held. Both halves stay derived, from the catalog and from the map, never listed.
 *
 * This is the WORDING, never the control. `refuseTool()` decides, per call, on the full map.
 */
export function withheldClasses(access: ToolAccess): string[] {
  return PERMISSIONS.filter(
    (p) => p.sensitive && TOOL_REQUIRED_KEYS.has(p.key) && !can(access.held, p.key),
  ).map((p) => spokenClass(p.key))
}

/** Everything a signed in caller holds, wrapped for the dispatch layer. Identity stays in authz.ts. */
export function accessForCaller(caller: Caller): ToolAccess {
  const held = callerPermissions(caller)
  if (caller.kind === 'account') {
    return { held, kind: 'account', roleName: caller.account.role.name }
  }
  if (caller.kind === 'bootstrap') {
    /*
     * The break glass door, open only while no account on this server has a credential. It is
     * owner equivalent by the same rule the write path uses, and `callerPermissions()` re reads the
     * credential count at the moment it is asked, so a session that started before the first
     * password landed cannot spend a privilege that has just closed.
     */
    return { held, kind: 'bootstrap', roleName: 'Break-glass' }
  }
  return { held: [], kind: 'anonymous', roleName: 'No account' }
}

/**
 * THE SPOKEN BRIDGE'S CALLER. Every non sensitive operator permission and nothing else.
 *
 * DERIVED, NEVER LISTED. A hardcoded list here would be a defect with a delay on it: the day a new
 * sensitive permission is added to the catalog, a list would keep granting the bridge everything it
 * granted yesterday, and the new sensitive class would be readable over a line that holds no
 * identity. The filter cannot make that mistake.
 *
 * It is not empty on purpose. The bridge still answers "what is a corner", "how many are on the
 * forecast today", "take me through the thesis", which is the whole point of a voice line, and it
 * refuses every class the interface itself treats as sensitive.
 */
export const MACHINE_BRIDGE_ACCESS: ToolAccess = Object.freeze({
  held: Object.freeze(PERMISSIONS.filter((p) => p.plane === 'operator' && !p.sensitive).map((p) => p.key)),
  kind: 'machine' as const,
  roleName: 'The spoken bridge, which holds no account',
})

/** A caller that holds nothing. The honest answer when identity cannot be established at all. */
export const NO_ACCESS: ToolAccess = Object.freeze({
  held: Object.freeze([] as string[]),
  kind: 'anonymous' as const,
  roleName: 'No account',
})

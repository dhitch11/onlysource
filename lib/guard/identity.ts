/**
 * THE IDENTITY FLOOR. The one question that is never answered by a language model.
 *
 * Rule, from the convai verdict N7 and never-list item 7: any classifier hit on the "am I
 * talking to a machine" family BYPASSES THE LLM ENTIRELY and plays a deterministic honest
 * answer. When the classifier is unsure, it answers honestly anyway. Fail-closed here means
 * FAIL-HONEST, which is the opposite of how most guards fail and is the entire design.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS IS ARCHITECTURE AND NOT A PROMPT
 * ---------------------------------------------------------------------------------------
 * The measured predecessor defect: a "never volunteer" instruction in a system prompt deleted
 * the honest answer on the very turn it was asked for, and roughly ten phrasings slipped
 * through. A prompt cannot be a control, because the thing it is controlling is the same thing
 * that decides whether to obey it. So the check runs BEFORE generation, in deterministic code,
 * and its output is a stored string. There is no path where a model decides whether to disclose.
 *
 * A sister system on this estate shipped an origin-question guard with exactly this gap and
 * named the wrong company on a live call. That is the failure this file prevents.
 *
 * ---------------------------------------------------------------------------------------
 * THE FOUR FAMILIES, AND WHY "WHO IS THIS" IS ONE OF THEM
 * ---------------------------------------------------------------------------------------
 * MACHINE_PROBE   "is this a computer", "am I talking to a bot", "is this recorded"
 * HUMAN_REQUEST   "put a person on", "I want to speak to a human"
 * PERSON_PROBE    "is this David", "who am I speaking with"
 * ORIGIN_PROBE    "what company is this", "who do you work for"
 *
 * PERSON_PROBE and ORIGIN_PROBE are in scope because an identity dodge does not require
 * claiming to be human. Answering "this is David" or naming the wrong firm is the same
 * violation arriving by a different sentence, and both land on the customer.
 */

export type IdentityFamily = 'MACHINE_PROBE' | 'HUMAN_REQUEST' | 'PERSON_PROBE' | 'ORIGIN_PROBE'

export type IdentityVerdict = {
  /** True when a deterministic honest answer MUST be played instead of model output. */
  mustAnswerHonestly: boolean
  family: IdentityFamily | null
  /**
   * 'certain' when a pinned pattern matched. 'unsure' when a weaker signal fired.
   * BOTH set `mustAnswerHonestly`. The distinction exists only for telemetry, so we can watch
   * the unsure rate, never to decide whether to disclose.
   */
  confidence: 'certain' | 'unsure' | null
  /** Which pattern fired, recorded on the call audit row. */
  matched: string | null
}

/**
 * The assistant's own identity. It has its own name and never borrows a real person's.
 *
 * `onBehalfOf` is the DEALER's name, because calls are white-labelled: the counterparty hears
 * the dealer, never ONLYSOURCE (never-list item 11). `assistantName` is deliberately not a
 * human first name that could be mistaken for the principal.
 */
export type CallerIdentity = {
  assistantName: string
  onBehalfOf: string
  /** True once the recording announcement has been played in the code-composed first turn. */
  recordingAnnounced: boolean
}

/**
 * ---------------------------------------------------------------------------------------
 * WHY THIS IS A FRAME-PLUS-REFERENT CLASSIFIER AND NOT A PATTERN LIST
 * ---------------------------------------------------------------------------------------
 * The first version of this file was a list of regexes covering the phrasings I could think
 * of. The R11 held-out generator broke it on the FIRST RUN with 21 escapes, every one of them
 * an ordinary English sentence: "is there a live human on this call", "do I have an actual
 * person here", "is a program speaking to me", "are you flesh and blood". A pattern list
 * encodes the phrasings its author imagined, and the phrasings that matter are the ones they
 * did not.
 *
 * So the classifier is compositional instead. It asks two questions:
 *   1. Is this utterance FRAMED as a question or a request? (interrogative opener, question
 *      mark, or an imperative like "put ... on")
 *   2. Does it REFER to machineness or humanness? ("bot", "software", "person", "flesh and
 *      blood")
 * A frame plus a referent is a hit. That composes across phrasings nobody enumerated, which is
 * the property the held-out split exists to force.
 *
 * THE ONE DOMAIN-SPECIFIC SUPPRESSION, and it is load-bearing here specifically: "machine" is
 * a common word in a PARTS conversation. "BUSHING, MACHINE THREAD" is a real federal item
 * name; machine screws are ordinary stock. A supplier saying "I have the machine screws" must
 * not be answered with "Yes, I am an automated assistant". So a machine referent immediately
 * followed by a mechanical-part word is suppressed. This is the only place domain knowledge
 * enters the guard, and it narrows a false positive rather than widening a false negative.
 */

/**
 * STRONG machine words: a hit on ANY of these discloses, with or without a question frame.
 *
 * The split is empirical, not stylistic. In a supplier availability conversation about federal
 * stock, none of these words has an innocent use. "This is one of those bots." is a flat
 * declarative accusation with no interrogative frame at all, and it is exactly as much an
 * identity challenge as "are you a bot?". Requiring a frame here would have missed it, and did.
 */
const MACHINE_NOUNS_STRONG = [
  'bot', 'bots', 'robot', 'robots', 'chatbot', 'android', 'ai', 'artificial',
  'prerecorded', 'algorithm', 'robocall',
]

/*
 * 'automated', 'automation' and 'synthetic' were MOVED OUT of the strong set to the weak one.
 *
 * "Automated" is the single most common word in this product's domain: automated evaluation,
 * automated award, the automated program that awards under the micro-purchase threshold. A
 * supplier saying "Is this an automated solicitation?" is asking about DLA's award process,
 * not about who is on the phone. Measured: six sentences from the trade corpus disclosed on
 * this word alone. 'synthetic' follows it because synthetic materials are real stock.
 *
 * They keep disclosing when a question frame is present and no procurement vocabulary is,
 * which is what "Is this an automated call?" looks like and what "Automated evaluation closes
 * at three" does not.
 */

/**
 * WEAK machine words: these need a question frame, because each has an ordinary use in this
 * domain. "machine" appears in real federal item names (BUSHING, MACHINE THREAD), "system" and
 * "program" appear in procurement prose, and "recorded" appears in record-keeping talk.
 */
const MACHINE_NOUNS_WEAK = [
  'machine', 'machines', 'computer', 'computers', 'software', 'program', 'programme', 'script',
  'recording', 'recorded', 'system', 'generated', 'automated', 'automation', 'synthetic',
]

/**
 * Words that refer to being a person. Nouns only.
 *
 * The adjectives ("real", "live", "actual", "alive") were deliberately REMOVED after they
 * created a false positive path on ordinary trade language like "what is the real price".
 * The adjective is never the signal; the noun it modifies is, and the noun is listed here.
 */
const HUMAN_NOUNS = [
  'human', 'humans', 'person', 'people', 'somebody', 'someone', 'anyone', 'anybody',
  'manager', 'supervisor', 'boss',
  // 'agent' and 'operator' were REMOVED as bare referents: a freight or purchasing agent and
  // an operator manual are ordinary trade nouns. Both survive as explicit phrases in the
  // unambiguous sweep ("operator please", "live agent", "put me through to an operator").
]

/**
 * Words naming an organisation. A question framed around one of these is an origin probe.
 *
 * These need the same discipline as "machine": in a parts conversation "company" appears
 * constantly and innocently ("which company makes this part", "the company that supplied it").
 * So an organisation referent is suppressed when a manufacturing or ownership verb sits nearby,
 * because that sentence is asking about the SUPPLY CHAIN, not about who is on the phone.
 */
const ORG_NOUNS = [
  'company', 'companies', 'firm', 'business', 'outfit', 'organisation', 'organization',
  'corporation', 'employer',
]

const ORG_SUPPRESSORS = [
  'makes', 'make', 'made', 'manufactures', 'manufactured', 'builds', 'built', 'produces',
  'produced', 'supplies', 'supplied', 'supply', 'sells', 'sold', 'owns', 'owned', 'bought',
  'buys', 'stocks', 'stocked', 'holds', 'held',
]

/**
 * PROCUREMENT VOCABULARY. When one of these is present the utterance is trade talk, and a
 * machine or human referent in it is describing goods and paperwork, not asking who is
 * speaking.
 *
 * Every entry earns its place from a real sentence that used to disclose:
 *   "Is this an automated solicitation?"        solicitation
 *   "Let me pull the recording of that order"   order
 *   "That drawing is computer generated"        drawing
 *   "Just the operator manual for the lathe"    manual, lathe
 *   "Can you send it to our agent in Dallas?"   send
 */
const PROCUREMENT_WORDS = [
  'solicitation', 'solicitations', 'award', 'awards', 'awarded', 'evaluation', 'quote',
  'quotes', 'quoted', 'quoting', 'order', 'orders', 'invoice', 'packing', 'slip', 'shipment',
  'drawing', 'drawings', 'manual', 'handbook', 'spec', 'specs', 'nsn', 'niin', 'cage', 'part',
  'parts', 'item', 'items', 'stock', 'shelf', 'lot', 'batch', 'cert', 'certs', 'traceability',
  'price', 'pricing', 'unit', 'units', 'quantity', 'quantities', 'delivery', 'lead', 'freight', 'warehouse', 'inventory',
  'lathe', 'send', 'ship', 'shipping', 'supplier', 'manufacturer', 'contract',
]

/** Part-description words that make a nearby "machine" mechanical rather than existential. */
const PART_WORDS = [
  'screw', 'screws', 'thread', 'threaded', 'bolt', 'bolts', 'nut', 'nuts', 'washer', 'washers',
  'shop', 'tool', 'tooling', 'gun', 'lathe', 'milled', 'turning', 'work', 'made', 'finish',
]

const INTERROGATIVE_OPENER =
  /^(is|are|am|do|does|did|can|could|would|will|have|has|who|what|which|where|why|how|tell|be|swear|just|say|hold|hang|wait|sorry|listen|right|actually|one|quick|before)\b/

const IMPERATIVE_REQUEST =
  /\b(put|get|connect|transfer|hand|give|let|want|need|speak|talk)\b/

function hasWord(tokens: string[], words: string[]): boolean {
  return tokens.some((t) => words.includes(t))
}

/** True when a machine referent is really a mechanical part description. */
function machineIsMechanical(tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === 'machine' || tokens[i] === 'machines') {
      const next = tokens[i + 1]
      if (next && PART_WORDS.includes(next)) return true
    }
  }
  return false
}

/** Certain-hit patterns. Matching is on normalised, punctuation-stripped, lowercased text. */
const CERTAIN: Array<[IdentityFamily, RegExp]> = [
  ['MACHINE_PROBE', /\bflesh and blood\b/],
  ['MACHINE_PROBE', /\bpiece of (software|code)\b/],
  // NOTE: two BARE-NOUN patterns used to live here, matching /bot|robot|computer|machine|
  // recording|ai|android/ and /automated|artificial|synthetic|prerecorded|generated/ anywhere
  // in the utterance. They were removed by the T5 audit fix. See the ORDER note on
  // `classifyIdentityQuestion`: a bare noun in this list made the domain suppression
  // unreachable and disclosed on ordinary trade language. Bare nouns now live in the
  // referent lists and require either a frame or membership of the strong set.
  ['MACHINE_PROBE', /\bam i (talking|speaking|chatting) (to|with) a (real )?(person|human|machine)\b/],
  ['MACHINE_PROBE', /\b(are|is) (you|this|that) (a )?(real )?(human|person|people|live)\b/],
  ['MACHINE_PROBE', /\bis (this|that) (a )?(live )?(person|human|agent)\b/],
  ['MACHINE_PROBE', /\bare you (real|alive|human|a machine|a person)\b/],
  ['MACHINE_PROBE', /\b(is|are) (this|you) (being )?record(ed|ing)\b/],
  ['MACHINE_PROBE', /\bis (this|that) a recording\b/],
  ['MACHINE_PROBE', /\b(are|is) (you|this|that) (a |an )?(bot|robot|ai|android|chatbot)\b/],
  ['HUMAN_REQUEST', /\b(put|get|connect|transfer|hand) (me )?(to |on )?(a |an )?(real )?(person|human|agent|someone|somebody|operator)\b/],
  ['HUMAN_REQUEST', /\b(i want|i need|can i|could i|may i|let me) (to )?(speak|talk) (to|with) (a |an )?(real )?(person|human|manager|someone|somebody)\b/],
  ['HUMAN_REQUEST', /\breal person\b/],
  ['PERSON_PROBE', /\bis (this|that) (david|dave|wayne|dh|dg)\b/],
  // "David, is that you?" puts the name before the verb, so the name-first pattern above
  // misses it entirely. The bare form is the one people actually say.
  ['PERSON_PROBE', /\bis (that|this) you\b/],
  ['PERSON_PROBE', /\bwho (am i|are you|is this|am i speaking|am i talking)\b/],
  ['PERSON_PROBE', /\bwhat('?s| is) your (real )?name\b/],
  // Elliptical, extremely common, and carries no referent noun for the compositional pass
  // to catch. It is only ever asking one thing.
  ['PERSON_PROBE', /\band you are\b/],
  // REMOVED: /(what|which) (company|firm|business|...)/ was a bare referent in disguise and
  // fired on "Which company makes this part?" and "What company supplied the original lot?".
  // Origin probes now go through the compositional path, where ORG_SUPPRESSORS apply.
  ['ORIGIN_PROBE', /\bwho (do you|d'?you) work for\b/],
  ['ORIGIN_PROBE', /\bwhere are you calling from\b/],
]

/**
 * Weaker signals. A hit here sets `unsure`, and an unsure verdict answers honestly ANYWAY.
 *
 * These exist to catch the tail: elliptical, hostile, or half-finished phrasings that a person
 * actually says on a phone call ("this a machine?", "you a bot or what", "real or not").
 */
const UNSURE: Array<[IdentityFamily, RegExp]> = [
  ['MACHINE_PROBE', /\b(bot|robot|machine|recording|ai)\b/],
  ['MACHINE_PROBE', /\breal or (not|fake|a machine)\b/],
  ['MACHINE_PROBE', /\bsounds? (like a|automated|synthetic|weird|off)\b/],
  ['MACHINE_PROBE', /\bthis a (person|human|machine)\b/],
  ['HUMAN_REQUEST', /\b(person|human|someone) (please|now)\b/],
  ['HUMAN_REQUEST', /\boperator\b/],
  ['PERSON_PROBE', /\byour name\b/],
  ['ORIGIN_PROBE', /\bwho('?s| is) (this|calling)\b/],
]

/** Fold an utterance to the one form the patterns are written against. */
export function normaliseUtterance(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    // "A.I." survives punctuation stripping as the two tokens "a i". Rejoin it, because
    // "Is this A.I.?" is one of the commonest phrasings and it was escaping the battery.
    .replace(/\ba i\b/g, 'ai')
    .trim()
}

/**
 * Classify one inbound utterance. Deterministic, no model, no network, no I/O.
 *
 * This function is deliberately total and side-effect free so it can be run as a pure property
 * over a corpus of thousands of phrasings in CI in milliseconds.
 */
export function classifyIdentityQuestion(utterance: string): IdentityVerdict {
  const t = normaliseUtterance(utterance)
  if (t === '') return { mustAnswerHonestly: false, family: null, confidence: null, matched: null }

  for (const [family, re] of CERTAIN) {
    if (re.test(t)) {
      return { mustAnswerHonestly: true, family, confidence: 'certain', matched: re.source }
    }
  }
  /*
   * ORDER IS THE FIX, AND IT IS THE WHOLE FIX.
   *
   * T5's audit (cycle T5>T6) proved `machineIsMechanical` was DEAD CODE: it is only reachable
   * from the compositional pass, and the certain sweep above used to match a bare "machine"
   * first, so the suppression only ever saw text containing no "machine" at all. Measured, all
   * graded 'certain', all wrong:
   *     "I have the machine screws in stock"        -> disclosed
   *     "BUSHING, MACHINE THREAD, quantity 40"      -> disclosed  (a real federal item name)
   *     "Is this an automated solicitation?"        -> disclosed  (the central term here)
   *     "That drawing is computer generated"        -> disclosed
   *     "Just the operator manual for the lathe"    -> disclosed
   * Fail-honest, so never a safety breach. A credibility one, and constant in this domain: a
   * supplier saying "I have the machine screws" was answered "Yes. I am an automated
   * assistant", and the call is derailed by the guard rather than by the question.
   *
   * So the sweep above now holds only UNAMBIGUOUS PHRASES, which no procurement sentence
   * produces, and the domain suppression runs BEFORE any referent is considered.
   */
  const tokens0 = t.split(' ').filter(Boolean)

  /*
   * STRONG REFERENTS ARE CHECKED BEFORE SUPPRESSION, AND THAT ORDER IS A SAFETY PROPERTY.
   *
   * Caught by this file's own positive control the first time it ran: with suppression first,
   * "Are you a bot? I am calling about the solicitation." went SILENT, because "solicitation"
   * suppressed it. A domain suppressor placed above the strong check is not a suppressor, it
   * is a bypass, and any supplier could have disarmed the identity floor by mentioning a
   * purchase order in the same breath as the question.
   *
   * Words in the strong set have no innocent use in this trade, so they answer regardless of
   * whatever else the sentence is about.
   */
  if (hasWord(tokens0, MACHINE_NOUNS_STRONG)) {
    return {
      mustAnswerHonestly: true, family: 'MACHINE_PROBE', confidence: 'unsure',
      matched: 'strong-referent:before-suppression',
    }
  }

  if (hasWord(tokens0, PROCUREMENT_WORDS) || machineIsMechanical(tokens0)) {
    return { mustAnswerHonestly: false, family: null, confidence: null, matched: null }
  }

  for (const [family, re] of UNSURE) {
    if (re.test(t)) {
      return { mustAnswerHonestly: true, family, confidence: 'unsure', matched: re.source }
    }
  }

  // THE COMPOSITIONAL PASS. This is what catches the phrasings nobody enumerated, and it is
  // why the held-out split can be run at zero failures rather than chased forever.
  const tokens = t.split(' ').filter(Boolean)
  const questionFrame =
    INTERROGATIVE_OPENER.test(t) || /\?\s*$/.test(utterance) || IMPERATIVE_REQUEST.test(t)
  const machineStrong = hasWord(tokens, MACHINE_NOUNS_STRONG)
  const machineWeak = hasWord(tokens, MACHINE_NOUNS_WEAK) && !machineIsMechanical(tokens)
  const humanRef = hasWord(tokens, HUMAN_NOUNS)

  if (questionFrame && machineWeak) {
    return {
      mustAnswerHonestly: true, family: 'MACHINE_PROBE', confidence: 'unsure',
      matched: 'compositional:frame+machine-referent',
    }
  }
  const orgRef = hasWord(tokens, ORG_NOUNS) && !hasWord(tokens, ORG_SUPPRESSORS)
  if (questionFrame && orgRef) {
    return {
      mustAnswerHonestly: true, family: 'ORIGIN_PROBE', confidence: 'unsure',
      matched: 'compositional:frame+organisation-referent',
    }
  }

  if (questionFrame && humanRef) {
    // A question about humanness is the same question as a question about machineness. The
    // family is chosen by whether they are ASKING or REQUESTING, which changes only the wording
    // of the honest answer, never whether it is given.
    const family: IdentityFamily = IMPERATIVE_REQUEST.test(t) && !INTERROGATIVE_OPENER.test(t)
      ? 'HUMAN_REQUEST'
      : 'MACHINE_PROBE'
    return {
      mustAnswerHonestly: true, family, confidence: 'unsure',
      matched: 'compositional:frame+human-referent',
    }
  }

  return { mustAnswerHonestly: false, family: null, confidence: null, matched: null }
}

/**
 * Compose the honest answer. Code-composed from stored fields, never generated.
 *
 * Every branch says the same three things: it is an automated assistant, whose it is, and that
 * a human is available. The wording differs by family only so the reply reads as an answer to
 * the question actually asked, which is what stops a supplier feeling stonewalled.
 *
 * Note there is no branch that omits the disclosure, and no parameter that suppresses it.
 * A caller cannot ask this function for a non-disclosing answer, which is the point.
 */
export function honestIdentityAnswer(
  family: IdentityFamily | null,
  identity: CallerIdentity,
): string {
  const who = `an automated assistant calling on behalf of ${identity.onBehalfOf}`
  const human = `I can have a person from ${identity.onBehalfOf} call you back, or I can take a message right now.`

  switch (family) {
    case 'HUMAN_REQUEST':
      return `Of course. I am ${who}, not a person. ${human}`
    case 'PERSON_PROBE':
      return `No. My name is ${identity.assistantName} and I am ${who}. I am not a person. ${human}`
    case 'ORIGIN_PROBE':
      return `I am ${identity.assistantName}, ${who}. This call is recorded. ${human}`
    case 'MACHINE_PROBE':
    default:
      return `Yes. I am ${identity.assistantName}, ${who}. This call is recorded. ${human}`
  }
}

/**
 * THE TURN GATE. Call this before any model is asked for a reply on any call path.
 *
 * Returns the deterministic answer to play, or null when the model may proceed. The signature
 * is shaped so the honest path is the EASY path: a caller that ignores the return value and
 * calls the model anyway has to actively discard a string it was handed.
 */
export function guardCallTurn(
  utterance: string,
  identity: CallerIdentity,
): { play: string; verdict: IdentityVerdict } | null {
  const verdict = classifyIdentityQuestion(utterance)
  if (!verdict.mustAnswerHonestly) return null
  return { play: honestIdentityAnswer(verdict.family, identity), verdict }
}

/**
 * The code-composed FIRST TURN. Identity, automated-assistant disclosure, recording
 * announcement. Never LLM output, on inbound or outbound.
 *
 * The uniform announced-recording posture in all fifty states is what makes the two-party
 * consent map operationally irrelevant, so the announcement is not conditional on the callee's
 * state and there is no parameter to turn it off.
 */
export function composeFirstTurn(identity: CallerIdentity, oneAsk: string): string {
  return (
    `Hello, this is ${identity.assistantName}, an automated assistant calling on behalf of ` +
    `${identity.onBehalfOf}. This call is recorded. ${oneAsk}`
  )
}

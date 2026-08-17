'use client'

/**
 * Thomas writes light markdown. This renders it.
 *
 * WHY THIS EXISTS AT ALL: the panel shipped rendering plain text, and the first real screenshot
 * showed "**18.**" with the asterisks visible on screen. Every assertion passed while it looked
 * unfinished, which is the whole argument for looking at the thing rather than only measuring it.
 *
 * WHY IT IS HAND-ROLLED AND TINY: a markdown library is a dependency in another lane's package.json
 * and a much larger attack surface, for a model that only ever emits bold, bullets, numbered lists
 * and paragraphs. This handles exactly those.
 *
 * NO `dangerouslySetInnerHTML`, ANYWHERE. Output is built as React elements, so model text is data
 * and can never become markup. That matters more here than in most places: some of what Thomas
 * repeats back originates in government files and supplier records, so treating his output as
 * trusted HTML would turn a data feed into a script-injection path.
 */
import { Fragment, type ReactNode } from 'react'

/** Inline pass: **bold** and `code`. Everything else is literal text. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*)|(`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    i += 1
    if (tok.startsWith('**')) out.push(<strong key={`${keyBase}b${i}`}>{tok.slice(2, -2)}</strong>)
    else out.push(<code key={`${keyBase}c${i}`}>{tok.slice(1, -1)}</code>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function RichText({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let k = 0

  const flushPara = () => {
    if (!para.length) return
    k += 1
    blocks.push(<p key={`p${k}`}>{inline(para.join(' '), `p${k}`)}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    k += 1
    const items = list.items.map((it, ix) => <li key={`li${k}_${ix}`}>{inline(it, `li${k}_${ix}`)}</li>)
    blocks.push(list.ordered ? <ol key={`l${k}`}>{items}</ol> : <ul key={`l${k}`}>{items}</ul>)
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet) {
      flushPara()
      if (!list || list.ordered) {
        flushList()
        list = { ordered: false, items: [] }
      }
      list.items.push(bullet[1] ?? '')
    } else if (numbered) {
      flushPara()
      if (!list || !list.ordered) {
        flushList()
        list = { ordered: true, items: [] }
      }
      list.items.push(numbered[1] ?? '')
    } else if (!line.trim()) {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line.trim())
    }
  }
  flushPara()
  flushList()

  return <Fragment>{blocks}</Fragment>
}

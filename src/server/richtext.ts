// Reddit's newer wiki, the one reddit.com and the apps show, takes pages as rich text (RTJSON) and
// shows markdown as plain text. The Nonet pages are written in markdown, so this turns the small
// subset they use into rich text: headings, paragraphs, lists, tables, rules, bold, italic and links.

type Format = [number, number, number]
type Inline =
  | {e: 'text'; t: string; f?: Format[]}
  | {e: 'link'; t: string; u: string; f?: Format[]}
type Block =
  | {
      e: 'h'
      l: 1 | 2 | 3 | 4 | 5 | 6
      c: ({e: 'raw'; t: string} | {e: 'link'; t: string; u: string})[]
    }
  | {e: 'par'; c: Inline[]}
  | {e: 'hr'}
  | {e: 'list'; o: boolean; c: {e: 'li'; c: Block[]}[]}
  | {
      e: 'table'
      h: {a?: 'L' | 'R' | 'C'; c: Inline[]}[]
      c: {c: Inline[]}[][]
    }

const BOLD = 1
const ITALIC = 2

/** Site-relative links (`/r/...`) as full links, which rich text needs. */
const fullUrl = (u: string): string =>
  u.startsWith('/') ? `https://www.reddit.com${u}` : u

/** One line of markdown text as rich text: `**bold**`, `*italic*` or `_italic_`, and links. */
export function inline(md: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  let f: Format[] = []
  let bold = -1
  let italic = -1
  const flush = (): void => {
    if (!text) return
    out.push(f.length ? {e: 'text', t: text, f} : {e: 'text', t: text})
    text = ''
    f = []
    if (bold >= 0) bold = 0
    if (italic >= 0) italic = 0
  }
  for (let i = 0; i < md.length; ) {
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(md.slice(i))
    if (link) {
      const style = (bold >= 0 ? BOLD : 0) | (italic >= 0 ? ITALIC : 0)
      flush()
      const t = link[1] ?? ''
      out.push({
        e: 'link',
        t,
        u: fullUrl(link[2] ?? ''),
        ...(style ? {f: [[style, 0, t.length] as Format]} : {}),
      })
      i += link[0].length
      continue
    }
    if (md.startsWith('**', i)) {
      if (bold < 0) bold = text.length
      else {
        if (text.length > bold) f.push([BOLD, bold, text.length - bold])
        bold = -1
      }
      i += 2
      continue
    }
    const ch = md[i] ?? ''
    // a lone * or _ opens or closes italics, unless it sits inside a word (snake_case, 2*3)
    const prev = md[i - 1] ?? ' '
    const next = md[i + 1] ?? ' '
    const opens = italic < 0 && /\S/.test(next) && !/\w/.test(prev)
    const closes = italic >= 0 && /\S/.test(prev) && !/\w/.test(next)
    if ((ch === '*' || ch === '_') && (opens || closes)) {
      if (opens) italic = text.length
      else {
        if (text.length > italic) f.push([ITALIC, italic, text.length - italic])
        italic = -1
      }
      i++
      continue
    }
    text += ch
    i++
  }
  // an unclosed marker is plain text after all: close its range at the end
  if (bold >= 0 && text.length > bold) f.push([BOLD, bold, text.length - bold])
  if (italic >= 0 && text.length > italic)
    f.push([ITALIC, italic, text.length - italic])
  bold = italic = -1
  flush()
  return out
}

const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim())

const align = (sep: string): 'L' | 'R' | 'C' | undefined =>
  sep.startsWith(':') && sep.endsWith(':')
    ? 'C'
    : sep.endsWith(':')
      ? 'R'
      : sep.startsWith(':')
        ? 'L'
        : undefined

const LIST_ITEM = /^(\d+\.|[-*])\s+(.*)$/

/** A markdown page as a rich text document, serialised as Reddit expects. Pure, for tests. */
export function markdownToRichtext(md: string): string {
  const lines = md.split('\n')
  const doc: Block[] = []
  let para: string[] = []
  const endPara = (): void => {
    if (para.length) doc.push({e: 'par', c: inline(para.join(' '))})
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trimEnd()
    if (!line.trim()) {
      endPara()
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      endPara()
      const level = (h[1] ?? '#').length as 1 | 2 | 3 | 4 | 5 | 6
      // headings hold raw text or links only: a heading that is one link stays a link
      const c = inline(h[2] ?? '')
      doc.push({
        e: 'h',
        l: level,
        c: c.map(n =>
          n.e === 'link' ? {e: 'link', t: n.t, u: n.u} : {e: 'raw', t: n.t},
        ),
      })
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      endPara()
      doc.push({e: 'hr'})
      continue
    }
    const sep = lines[i + 1]?.trim() ?? ''
    if (
      line.trim().startsWith('|') &&
      /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(sep)
    ) {
      endPara()
      const aligns = cells(sep).map(align)
      const head = cells(line).map((t, k) => {
        const a = aligns[k]
        return a ? {a, c: inline(t)} : {c: inline(t)}
      })
      const rows: {c: Inline[]}[][] = []
      i += 2
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        rows.push(cells(lines[i] ?? '').map(t => ({c: inline(t)})))
        i++
      }
      i--
      doc.push({e: 'table', h: head, c: rows})
      continue
    }
    const li = LIST_ITEM.exec(line)
    if (li) {
      endPara()
      const ordered = /\d/.test(li[1] ?? '')
      const items: {e: 'li'; c: Block[]}[] = []
      while (i < lines.length) {
        const m = LIST_ITEM.exec((lines[i] ?? '').trimEnd())
        if (!m || /\d/.test(m[1] ?? '') !== ordered) break
        items.push({e: 'li', c: [{e: 'par', c: inline(m[2] ?? '')}]})
        i++
      }
      i--
      doc.push({e: 'list', o: ordered, c: items})
      continue
    }
    para.push(line.trim())
  }
  endPara()
  return JSON.stringify({document: doc})
}

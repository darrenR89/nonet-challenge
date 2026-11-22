// The newer wiki that reddit.com and the apps show doesn't parse markdown written by apps: it shows
// the text as one plain paragraph (a known Devvit bug). It does show basic HTML, so the Nonet pages,
// written in markdown for old Reddit, are turned into plain HTML for it: headings, paragraphs,
// lists, tables, rules, bold, italic and links, with no attributes but href.

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Site-relative links (`/r/...`) as full reddit.com links. */
const fullUrl = (u: string): string =>
  u.startsWith('/') ? `https://www.reddit.com${u}` : u

/** One line of markdown text as HTML: `**bold**`, `*italic*` or `_italic_`, and links. */
export function inlineHtml(md: string): string {
  let out = ''
  let bold = false
  let italic = false
  for (let i = 0; i < md.length; ) {
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(md.slice(i))
    if (link) {
      out += `<a href="${esc(fullUrl(link[2] ?? '')).replace(/"/g, '&quot;')}">${esc(link[1] ?? '')}</a>`
      i += link[0].length
      continue
    }
    if (md.startsWith('**', i)) {
      out += bold ? '</strong>' : '<strong>'
      bold = !bold
      i += 2
      continue
    }
    const ch = md[i] ?? ''
    // a lone * or _ opens or closes italics, unless it sits inside a word (snake_case, 2*3)
    const prev = md[i - 1] ?? ' '
    const next = md[i + 1] ?? ' '
    const opens = !italic && /\S/.test(next) && !/\w/.test(prev)
    const closes = italic && /\S/.test(prev) && !/\w/.test(next)
    if ((ch === '*' || ch === '_') && (opens || closes)) {
      out += italic ? '</em>' : '<em>'
      italic = !italic
      i++
      continue
    }
    out += esc(ch)
    i++
  }
  if (italic) out += '</em>'
  if (bold) out += '</strong>'
  return out
}

const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim())

const LIST_ITEM = /^(\d+\.|[-*])\s+(.*)$/
const TABLE_SEP = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/

/** A markdown page as plain HTML for the newer wiki. Pure, for tests. */
export function markdownToHtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let para: string[] = []
  const endPara = (): void => {
    if (para.length) out.push(`<p>${inlineHtml(para.join(' '))}</p>`)
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
      const n = (h[1] ?? '#').length
      out.push(`<h${n}>${inlineHtml(h[2] ?? '')}</h${n}>`)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      endPara()
      out.push('<hr>')
      continue
    }
    if (
      line.trim().startsWith('|') &&
      TABLE_SEP.test(lines[i + 1]?.trim() ?? '')
    ) {
      endPara()
      const head = cells(line)
        .map(t => `<th>${inlineHtml(t)}</th>`)
        .join('')
      const rows: string[] = []
      i += 2
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        rows.push(
          `<tr>${cells(lines[i] ?? '')
            .map(t => `<td>${inlineHtml(t)}</td>`)
            .join('')}</tr>`,
        )
        i++
      }
      i--
      out.push(
        `<table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`,
      )
      continue
    }
    const li = LIST_ITEM.exec(line)
    if (li) {
      endPara()
      const ordered = /\d/.test(li[1] ?? '')
      const items: string[] = []
      while (i < lines.length) {
        const m = LIST_ITEM.exec((lines[i] ?? '').trimEnd())
        if (!m || /\d/.test(m[1] ?? '') !== ordered) break
        items.push(`<li>${inlineHtml(m[2] ?? '')}</li>`)
        i++
      }
      i--
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }
    para.push(line.trim())
  }
  endPara()
  return out.join('\n')
}

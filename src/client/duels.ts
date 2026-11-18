// Challenges in the game: the end card's "Challenge someone" box and head-to-head
// results, and a line on the start screen when someone has challenged you.
import './nonet/duels.css'
import {type Duel, MAX_CHALLENGES, recordText} from '../shared/duel.ts'
import {challenge, lastError} from './api.ts'

const esc = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c] ?? c,
  )
const num = (n: number | undefined): string =>
  Math.round(n ?? 0).toLocaleString('en-GB')

function line(d: Readonly<Duel>): string {
  const who = `u/${esc(d.them)}`
  switch (d.result) {
    case 'pending':
      return d.sent
        ? `Waiting on ${who} to beat <b>${num(d.mine)}</b>`
        : `${who} challenged you: <b>${num(d.theirs)}</b> to beat`
    case 'won':
      return `You beat ${who}: <b>${num(d.mine)}</b> v ${num(d.theirs)}`
    case 'lost':
      return `${who} beat you: ${num(d.mine)} v <b>${num(d.theirs)}</b>`
    case 'tied':
      return `Tied with ${who} on <b>${num(d.mine)}</b>`
  }
}

/** The end card's challenges box. canChallenge is false until today's score is in. */
export function duelsHTML(
  duels: readonly Duel[],
  canChallenge: boolean,
): string {
  const sent = duels.filter(d => d.sent).length
  const list = duels.length
    ? `<ul class="duelList">${duels
        .map(
          d =>
            `<li class="${d.result}"><span>${line(d)}</span><small>${recordText(d.record)}</small></li>`,
        )
        .join('')}</ul>`
    : ''
  const form =
    canChallenge && sent < MAX_CHALLENGES
      ? `<form class="duelForm" id="duelForm"><input id="duelName" name="name" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="username" aria-label="Reddit username to challenge" maxlength="23" required><button type="submit">Challenge</button></form>
    <p class="meta" id="duelMsg" aria-live="polite">They're tagged in a comment here with your score to beat.</p>`
      : ''
  if (!list && !form) return ''
  return `<div class="duels"><h3>Challenge someone</h3>${list}${form}</div>`
}

/** Wires the challenge form. onChange gets today's challenges after a new one is sent. */
export function wireDuels(
  root: HTMLElement,
  onChange: (duels: Duel[]) => void,
): void {
  const form = root.querySelector<HTMLFormElement>('#duelForm')
  const input = root.querySelector<HTMLInputElement>('#duelName')
  const msg = root.querySelector<HTMLElement>('#duelMsg')
  if (!form || !input) return
  form.onsubmit = async ev => {
    ev.preventDefault()
    const btn = form.querySelector('button')
    if (btn) btn.disabled = true
    const r = await challenge({name: input.value})
    if (btn) btn.disabled = false
    if (r) onChange(r.duels)
    else if (msg) msg.textContent = lastError || 'Try again.'
  }
}

/** The start screen's line for challenges you've received and not yet answered. */
export function splashDuelsHTML(duels: readonly Duel[]): string {
  const open = duels.filter(d => !d.sent && d.result === 'pending')
  if (!open.length) return ''
  return open.map(d => `<p>${line(d)}</p>`).join('')
}

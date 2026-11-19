// Challenges in the game: the end card's "Challenge someone" box and head-to-head
// results, and a line on the start screen when someone has challenged you.
import './nonet/duels.css'
import {type Duel, MAX_CHALLENGES, recordText} from '../shared/duel.ts'
import {answerChallenge, challenge, lastError} from './api.ts'

const esc = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c] ?? c,
  )
const num = (n: number | undefined): string =>
  Math.round(n ?? 0).toLocaleString('en-GB')

function line(d: Readonly<Duel>): string {
  const who = `u/${esc(d.them)}`
  switch (d.status) {
    case 'offered':
      return d.sent
        ? `Waiting on ${who} to accept`
        : `${who} challenged you: <b>${num(d.theirs)}</b> to beat`
    case 'declined':
      return d.sent ? `${who} declined` : `You declined ${who}`
    case 'lapsed':
      return d.sent
        ? `${who} played without accepting`
        : `You played before accepting ${who}`
    case 'accepted':
      break
  }
  switch (d.result) {
    case 'pending':
      return d.sent
        ? `${who} accepted: waiting on them to beat <b>${num(d.mine)}</b>`
        : `You accepted ${who}: <b>${num(d.theirs)}</b> to beat`
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
            `<li class="${d.result}"><span>${line(d)}</span>${d.status === 'accepted' ? `<small>${recordText(d.record)}</small>` : ''}</li>`,
        )
        .join('')}</ul>`
    : ''
  const form =
    canChallenge && sent < MAX_CHALLENGES
      ? `<form class="duelForm" id="duelForm"><input id="duelName" name="name" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="username" aria-label="Reddit username to challenge" maxlength="23" required><button type="submit">Challenge</button></form>
    <p class="meta" id="duelMsg" aria-live="polite">They're tagged in a comment here, and accept before they play.</p>`
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

/** The start screen's lines for challenges you've received: Accept or Decline, before you play. */
export function splashDuelsHTML(duels: readonly Duel[]): string {
  const open = duels.filter(
    d => !d.sent && (d.status === 'offered' || d.status === 'accepted'),
  )
  if (!open.length) return ''
  return open
    .map(
      d =>
        `<div class="duelOffer"><p>${line(d)}</p>${
          d.status === 'offered'
            ? `<div class="duelActs"><button type="button" data-from="${esc(d.themId)}" data-accept="1">Accept</button><button type="button" data-from="${esc(d.themId)}" data-accept="0">Decline</button></div>`
            : `<small>${recordText(d.record)} · play to settle it</small>`
        }</div>`,
    )
    .join('')
}

/** Wires the start screen's Accept and Decline buttons. */
export function wireAnswers(
  root: HTMLElement,
  onChange: (duels: Duel[]) => void,
): void {
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-from]'))
    b.onclick = async () => {
      for (const x of root.querySelectorAll<HTMLButtonElement>('[data-from]'))
        x.disabled = true
      const r = await answerChallenge({
        from: b.dataset.from ?? '',
        accept: b.dataset.accept === '1',
      })
      if (r) onChange(r.duels)
      else {
        b.textContent = lastError || 'Try again'
        for (const x of root.querySelectorAll<HTMLButtonElement>('[data-from]'))
          x.disabled = false
      }
    }
}

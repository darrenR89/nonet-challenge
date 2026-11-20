// Nonet Crew in the game: the crew row on the home screen and the end card's crew box.
// One panel does both: start a crew, answer invitations, see who has played, nudge,
// invite into an open seat, and leave.
import './nonet/crew.css'
import type {CrewRsp} from '../shared/api.ts'
import {
  CREW_MARK,
  CREW_SIZE,
  type CrewInfo,
  playedText,
} from '../shared/crew.ts'
import {
  answerCrew,
  createCrew,
  inviteCrew,
  lastError,
  leaveCrew,
  nudgeCrew,
} from './api.ts'

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    c =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[
        c
      ] ?? c,
  )
const num = (n: number | undefined): string =>
  Math.round(n ?? 0).toLocaleString('en-GB')

/** The kanji mark, in the cover's pixel face. */
export const mark = `<span class="crew-mark" lang="ja" aria-hidden="true">${CREW_MARK}</span>`

/** The row's title: the crew's name, or what a player without one can do. */
export function crewTitle(info: Readonly<CrewInfo>): string {
  return info.crew ? `${mark} ${esc(info.crew.name)}` : `${mark} Nonet Crew`
}

/** One line under the title: how the crew is doing today, or the invitations waiting. */
export function crewSummary(info: Readonly<CrewInfo>): string {
  const c = info.crew
  if (c) {
    const bits = [playedText(c)]
    if (c.rank) bits.push(`#${c.rank} this week`)
    if (c.streak) bits.push(`${c.streak}-day crew streak`)
    return bits.join(' · ')
  }
  const inv = info.invites[0]
  if (inv)
    return info.invites.length > 1
      ? `${info.invites.length} crews invited you`
      : `u/${esc(inv.from)} invited you to ${esc(inv.crew)}`
  return 'Team up with two others: your scores add up'
}

/** What the end card's crew button says. */
export function crewButton(info: Readonly<CrewInfo>): string {
  return info.crew
    ? `${mark} Crew: ${playedText(info.crew)}`
    : `${mark} Start a crew`
}

/** The crew line added to the shared result, or nothing without a crew. */
export function crewShareLine(info: Readonly<CrewInfo> | undefined): string {
  const c = info?.crew
  if (!c) return ''
  const bits = [
    `${CREW_MARK} ${c.name}`,
    playedText(c),
    `${num(c.today)} crew pts`,
  ]
  if (c.streak > 1) bits.push(`${c.streak}-day crew streak`)
  return `\n${bits.join(' · ')}`
}

const nameInput = (n: string, label: string): string =>
  `<input name="${n}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="username" aria-label="${label}" maxlength="23">`

/** The panel: your crew, or invitations and a form to start one. */
export function crewPanelHTML(info: Readonly<CrewInfo>): string {
  const c = info.crew
  if (c) {
    const seats = CREW_SIZE - c.members.length
    const rows = c.members
      .map(m => {
        const who = `u/${esc(m.name)}${m.me ? ' <small>you</small>' : ''}`
        const right =
          m.score !== undefined
            ? `<b>${num(m.score)}</b>`
            : m.me
              ? '<small>not played</small>'
              : m.nudged
                ? '<small>nudged</small>'
                : `<button type="button" data-nudge="${esc(m.id)}">Nudge</button>`
        return `<li${m.score === undefined ? ' class="waiting"' : ''}><span>${who}</span>${right}</li>`
      })
      .join('')
    const open = Array.from(
      {length: seats},
      () => '<li class="seat"><span>Open seat</span></li>',
    ).join('')
    const meta = [
      `${num(c.today)} today`,
      c.week
        ? `${num(c.week)} this week${c.rank ? `, #${c.rank} of ${c.crews}` : ''}`
        : '',
      c.streak ? `${c.streak}-day crew streak` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    const invite = seats
      ? `<form class="crewForm" data-form="invite">${nameInput('a', 'Reddit username to invite')}<button type="submit">Invite</button></form>`
      : ''
    return `<div class="crew"><p class="crew-meta">${meta}</p><ul class="crewList">${rows}${open}</ul>${invite}<p class="crew-msg" aria-live="polite">${seats ? 'Invites tag them in a comment on this post.' : ''}</p><button type="button" class="crew-leave" data-leave>Leave crew</button></div>`
  }
  const offers = info.invites
    .map(
      i =>
        `<div class="crewOffer"><p>u/${esc(i.from)} invited you to ${mark} <b>${esc(i.crew)}</b></p><div class="duelActs"><button type="button" data-crew="${esc(i.crewId)}" data-accept="1">Join</button><button type="button" data-crew="${esc(i.crewId)}" data-accept="0">Decline</button></div></div>`,
    )
    .join('')
  return `<div class="crew">${offers}<form class="crewForm crewStart" data-form="start">
    <input name="name" autocomplete="off" placeholder="Crew name" aria-label="Crew name" maxlength="24" required>
    <div class="crewInvites">${nameInput('a', 'First player to invite')}${nameInput('b', 'Second player to invite')}</div>
    <button type="submit">Start a crew</button></form>
    <p class="crew-msg" aria-live="polite">Up to three. Your scores add up every day, and the crew streak counts days you all played. Invites tag them in a comment on this post.</p></div>`
}

/**
 * Wires a crew panel. onChange gets the crew after any change; what to show (the
 * reason an invite failed, say) goes in the panel's message line.
 */
export function wireCrew(
  root: HTMLElement,
  onChange: (info: CrewInfo, what: string) => void,
): void {
  const msg = (t: string): void => {
    const el = root.querySelector<HTMLElement>('.crew-msg')
    if (el) el.textContent = t
  }
  const done = (r: CrewRsp | undefined, what: string): boolean => {
    if (!r) {
      msg(lastError || 'Try again.')
      return false
    }
    const {note, ...info} = r
    onChange(info, what)
    if (note) msg(note)
    return true
  }
  for (const form of root.querySelectorAll<HTMLFormElement>('form[data-form]'))
    form.onsubmit = async ev => {
      ev.preventDefault()
      const btn = form.querySelector('button')
      if (btn) btn.disabled = true
      const v = (n: string): string =>
        form
          .querySelector<HTMLInputElement>(`input[name="${n}"]`)
          ?.value.trim() ?? ''
      const names = [v('a'), v('b')].filter(Boolean)
      const r =
        form.dataset.form === 'start'
          ? await createCrew({name: v('name'), invite: names})
          : await inviteCrew({names})
      if (
        !done(
          r,
          form.dataset.form === 'start' ? 'crew_start' : 'crew_invite',
        ) &&
        btn
      )
        btn.disabled = false
    }
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-crew]'))
    b.onclick = async () => {
      b.disabled = true
      const accept = b.dataset.accept === '1'
      const r = await answerCrew({crewId: b.dataset.crew ?? '', accept})
      if (!done(r, accept ? 'crew_join' : 'crew_decline')) b.disabled = false
    }
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-nudge]'))
    b.onclick = async () => {
      b.disabled = true
      if (!done(await nudgeCrew({to: b.dataset.nudge ?? ''}), 'crew_nudge'))
        b.disabled = false
    }
  const leave = root.querySelector<HTMLButtonElement>('[data-leave]')
  if (leave)
    leave.onclick = async () => {
      // a second tap leaves, so a stray tap doesn't
      if (leave.dataset.sure !== '1') {
        leave.dataset.sure = '1'
        leave.textContent = 'Tap again to leave'
        return
      }
      leave.disabled = true
      if (!done(await leaveCrew(), 'crew_leave')) leave.disabled = false
    }
}

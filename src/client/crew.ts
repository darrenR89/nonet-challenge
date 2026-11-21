// Nonet Crew in the game: the crew row on the home screen and the end card's crew box.
// One panel does both: start a crew, answer invitations, see who has played, nudge,
// invite into an open seat, and leave.
import './nonet/crew.css'
import type {CrewRsp} from '../shared/api.ts'
import {
  allPlayed,
  CREW_MARK,
  CREW_SIZE,
  type CrewInfo,
  type CrewMember,
  countingMembers,
  playedText,
  QUIET_DAYS,
} from '../shared/crew.ts'
import {
  answerCrew,
  createCrew,
  inviteCrew,
  lastError,
  leaveCrew,
  nudgeCrew,
  openCrewSeat,
  postCrewResult,
  setCrewNudges,
} from './api.ts'
import type {CrewCard} from './share-card.ts'

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

/** The crew part of the share card, or undefined without a crew. */
export function crewCard(
  info: Readonly<CrewInfo> | undefined,
): CrewCard | undefined {
  const c = info?.crew
  if (!c) return
  return {
    name: c.name,
    points: c.today,
    streak: c.streak,
    members: c.members.map(m => ({name: m.name, score: m.score})),
  }
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

/** "Mon 23 Nov", for the day a new member starts counting. */
const shortDay = (day: string): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

/** The right-hand side of a member's row: their score, or what can be done about it. */
function memberRight(m: Readonly<CrewMember>): string {
  if (m.countsFrom)
    return `<small>counts from ${shortDay(m.countsFrom)}</small>`
  if (m.score !== undefined) return `<b>${num(m.score)}</b>`
  if (m.me) return '<small>not played</small>'
  const seat =
    m.missed >= QUIET_DAYS
      ? `<button type="button" class="crew-seat" data-seat="${esc(m.id)}" title="Missed ${m.missed} days in a row">Open seat</button>`
      : ''
  const poke = m.nudged
    ? '<small>nudged</small>'
    : m.nudgesOff
      ? '<small>nudges off</small>'
      : `<button type="button" data-nudge="${esc(m.id)}">Nudge</button>`
  return `<span class="crew-acts">${poke}${seat}</span>`
}

/** The panel: your crew, or invitations and a form to start one. */
export function crewPanelHTML(info: Readonly<CrewInfo>): string {
  const c = info.crew
  if (c) {
    const seats = CREW_SIZE - c.members.length
    const rows = c.members
      .map(m => {
        const who = `u/${esc(m.name)}${m.me ? ' <small>you</small>' : ''}`
        return `<li${m.score === undefined ? ' class="waiting"' : ''}><span>${who}</span>${memberRight(m)}</li>`
      })
      .join('')
    const open = Array.from(
      {length: seats},
      () => '<li class="seat"><span>Open seat</span></li>',
    ).join('')
    // rank and streak are already on the summary line just above
    const meta = [
      `${num(c.today)} today`,
      c.week ? `${num(c.week)} this week` : '',
      c.rank ? `${c.crews} crews on the board` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    const invite = seats
      ? `<form class="crewForm" data-form="invite">${nameInput('a', 'Reddit username to invite')}<button type="submit">Invite</button></form>`
      : ''
    // once everyone has played, one of the crew can post the day's result in the thread
    const share =
      countingMembers(c).length > 1 && allPlayed(c)
        ? c.posted
          ? '<p class="crew-msg">Crew result posted in the comments.</p>'
          : '<button type="button" class="crew-post" data-post>Post crew result</button>'
        : ''
    const me = c.members.find(m => m.me)
    const late = c.members.some(m => m.countsFrom)
      ? 'New members count from Monday, so the week stays fair.'
      : ''
    const msg = [
      seats ? 'Invites tag them in a comment on this post.' : '',
      late,
    ]
      .filter(Boolean)
      .join(' ')
    return `<div class="crew"><p class="crew-meta">${meta}</p><ul class="crewList">${rows}${open}</ul>${invite}${share}<p class="crew-msg" aria-live="polite">${msg}</p><div class="crew-foot"><button type="button" class="crew-leave" data-leave>Leave crew</button><button type="button" class="crew-leave" data-nudges="${me?.nudgesOff ? '1' : '0'}">${me?.nudgesOff ? 'Turn nudges on' : 'Turn nudges off'}</button></div></div>`
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
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-seat]'))
    b.onclick = async () => {
      if (b.dataset.sure !== '1') {
        b.dataset.sure = '1'
        b.textContent = 'Tap again to open'
        return
      }
      b.disabled = true
      if (!done(await openCrewSeat({to: b.dataset.seat ?? ''}), 'crew_seat'))
        b.disabled = false
    }
  const nudges = root.querySelector<HTMLButtonElement>('[data-nudges]')
  if (nudges)
    nudges.onclick = async () => {
      nudges.disabled = true
      const on = nudges.dataset.nudges === '1'
      if (
        !done(
          await setCrewNudges({on}),
          on ? 'crew_nudges_on' : 'crew_nudges_off',
        )
      )
        nudges.disabled = false
    }
  const post = root.querySelector<HTMLButtonElement>('[data-post]')
  if (post)
    post.onclick = async () => {
      post.disabled = true
      if (!done(await postCrewResult(), 'crew_post')) post.disabled = false
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

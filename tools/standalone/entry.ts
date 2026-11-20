// The standalone page: the stand-in server first, then the game itself.
import './fresh.ts'
import {isGuest, resetDemo} from './mock.ts'
import '../../src/client/game.ts'

document.getElementById('resetDemo')?.addEventListener('click', resetDemo)

// The feed card comes first, as on Reddit; its Play button opens the game underneath.
const card = document.getElementById('feedCard')
const frame = document.getElementById('feedFrame') as HTMLIFrameElement | null
addEventListener('message', ev => {
  if (ev.data === 'nonet:play') card?.classList.add('gone')
})
const looks = [...document.querySelectorAll<HTMLButtonElement>('.looks button')]
const showLook = (look: string): void => {
  for (const b of looks) b.setAttribute('aria-pressed', String(b.dataset.look === look))
}
let look = ''
try {
  look = sessionStorage.getItem('nonet-card-look') ?? ''
} catch {}
showLook(look)
for (const b of looks)
  b.addEventListener('click', () => {
    const v = b.dataset.look ?? ''
    try {
      sessionStorage.setItem('nonet-card-look', v)
    } catch {}
    showLook(v)
    frame?.contentWindow?.location.reload()
  })

// Logged out: the page plays as a visitor with no Reddit account, to try the sign-up flow
const guestBtn = document.getElementById('guestBtn')
guestBtn?.setAttribute('aria-pressed', String(isGuest()))
guestBtn?.addEventListener('click', () => {
  try {
    sessionStorage.setItem('nonet-guest', isGuest() ? '0' : '1')
  } catch {}
  location.reload()
})

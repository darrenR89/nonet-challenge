// Stands in for @devvit/web/client in the prototype's game. Reddit's sign-up prompt can't open
// outside Reddit, so a plain stand-in dialog takes its place: signing up there switches the page
// to logged in and reloads it, as Reddit's flow does.
export {exitExpandedMode} from '@devvit/client'

export function showLoginPrompt(): void {
  const d = document.createElement('div')
  d.className = 'fake-login'
  d.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="flT">
    <p class="tag">Prototype stand-in</p>
    <h2 id="flT">Reddit's sign-up prompt opens here</h2>
    <p>On Reddit this is the real log in or sign up flow, and the page reloads after it.</p>
    <div class="acts"><button type="button" data-v="no">Not now</button><button type="button" data-v="yes" class="primary">Sign up (demo)</button></div></div>`
  document.body.appendChild(d)
  d.addEventListener('click', ev => {
    const v = (ev.target as HTMLElement).closest('button')?.dataset.v
    if (!v) return
    if (v === 'yes') {
      try {
        sessionStorage.setItem('nonet-guest', '0')
      } catch {}
      location.reload()
    } else d.remove()
  })
}

// Stands in for @devvit/web/client in the prototype's game. Reddit's sign-up prompt can't open
// outside Reddit, so a plain stand-in dialog takes its place: signing up there switches the page
// to logged in and reloads it, as Reddit's flow does.
export {exitExpandedMode} from '@devvit/client'

// Outside Reddit there is no post: the game shares the page's own link instead.
export const context: {postId: string | undefined; subredditName?: string} = {postId: undefined}

// Reddit's share sheet sends the post link; here the browser's share sheet sends the page's.
export async function showShareSheet(o: {title?: string; text?: string}): Promise<void> {
  const url = location.href.split('#')[0]
  if (navigator.share) await navigator.share({title: o.title, text: o.text, url})
  else await navigator.clipboard.writeText(`${o.text ?? ''}\n${url}`)
}

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
export function navigateTo(_url: string): void {}
export function navigateToPost(_id: string): void {}

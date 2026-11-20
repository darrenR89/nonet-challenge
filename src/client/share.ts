// Sharing a result: the card as a PNG through the device's share sheet where it takes files,
// and the post link (the way in for others to play) in the text.
import {
  CARD_FONTS,
  CARD_GLYPHS,
  drawShareCard,
  type ShareCard,
} from './share-card.ts'

/** The post's Reddit link, for others to open and play. Undefined outside a post. */
export function postUrl(
  subreddit: string | undefined,
  postId: string | undefined,
): string | undefined {
  if (!postId) return undefined
  const id = postId.replace(/^t3_/, '')
  if (!/^[a-z0-9]+$/i.test(id)) return undefined
  return `https://www.reddit.com/${subreddit ? `r/${subreddit}/` : ''}comments/${id}/`
}

/** The text that goes with the picture: the spoiler-free result line, a dare, and the link. */
export function shareText(result: string, url: string | undefined): string {
  return `${result}\nCan you beat it?${url ? ` Play today's cube: ${url}` : ''}`
}

/** Draws the card and returns it as a PNG, plus a data URL for the preview. */
export async function renderCard(
  d: ShareCard,
): Promise<{blob: Blob; dataUrl: string} | undefined> {
  try {
    await Promise.all(CARD_FONTS.map(f => document.fonts.load(f, CARD_GLYPHS)))
  } catch {}
  const canvas = document.createElement('canvas')
  drawShareCard(canvas, d)
  const blob = await new Promise<Blob | null>(done =>
    canvas.toBlob(done, 'image/png'),
  )
  if (!blob) return undefined
  return {blob, dataUrl: canvas.toDataURL('image/png')}
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported'

/**
 * Opens the device's share sheet with the picture and text. 'unsupported' when this browser or
 * webview can't share files (Reddit's in-app view may not), so the caller can fall back.
 */
export async function shareImage(
  blob: Blob,
  title: string,
  text: string,
): Promise<ShareOutcome> {
  const file = new File([blob], 'nonet-result.png', {type: 'image/png'})
  const data: ShareData = {files: [file], title, text}
  if (!navigator.canShare?.(data)) return 'unsupported'
  try {
    await navigator.share(data)
    return 'shared'
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError'
      ? 'cancelled'
      : 'unsupported'
  }
}

/** Saves the picture through a download link. */
export function saveImage(dataUrl: string, name: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

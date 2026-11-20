// Stands in for @devvit/web/client on the prototype's feed card: Play tells the page to open the game.
export function requestExpandedMode(_ev: Event, _entry: string): void {
  parent.postMessage('nonet:play', '*')
}
export const context: {subredditName?: string} = {subredditName: 'nonet_challenge_dev'}
export function navigateTo(_url: string): void {}
export function navigateToPost(_id: string): void {}

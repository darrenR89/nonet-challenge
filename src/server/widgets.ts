// The subreddit sidebar widgets the app looks after: a post flair list, so players can filter the
// subreddit by the app's post flairs, and a button to the Nonet wiki. The app adds them on
// install and from the mods' "update the wiki" menu item, and updates them in place after that.
import {
  type AddWidgetData,
  reddit,
  redis,
  type Widget,
} from '@devvit/web/server'
import {wikiUrl} from './wiki.ts'

export const FLAIR_WIDGET = 'Nonet posts'
export const WIKI_WIDGET = 'New to Nonet?'
const widgetsKey = 'widgets'

/** The post flair widget, listing the app's flairs in this order. Pure, for tests. */
export function flairWidget(sub: string, templateIds: string[]): AddWidgetData {
  return {
    type: 'post-flair',
    subreddit: sub,
    shortName: FLAIR_WIDGET,
    display: 'list',
    order: templateIds,
  }
}

/** The button widget that opens the Nonet wiki. Pure, for tests. */
export function wikiWidget(sub: string): AddWidgetData {
  return {
    type: 'button',
    subreddit: sub,
    shortName: WIKI_WIDGET,
    description: 'Rules, scoring, streaks, crews and records.',
    buttons: [
      {
        kind: 'text',
        text: 'How to play: Nonet wiki',
        url: wikiUrl(sub),
        color: '#121316',
        fillColor: '#f5c12e',
        textColor: '#121316',
      },
    ],
  }
}

/**
 * The sidebar order with newly added widgets moved to the top, wiki button first. Widgets a mod
 * already placed stay where they are. Pure, for tests.
 */
export function topOrder(ids: string[], added: string[]): string[] {
  return [...added, ...ids.filter(id => !added.includes(id))]
}

/**
 * Adds or updates each widget, matched by the id the app saved or else by its title. A mod
 * can move or restyle them; the app puts back the contents. Returns the ids it added.
 */
export async function syncWidgets(
  sub: string,
  specs: [slot: string, data: AddWidgetData][],
): Promise<string[]> {
  // throws on a widget kind Devvit doesn't know: then match by saved id only and don't reorder
  const list: Widget[] | undefined = await reddit
    .getWidgets(sub)
    .catch(() => undefined)
  const added: string[] = []
  for (const [slot, data] of specs) {
    try {
      const saved = await redis.hGet(widgetsKey, slot)
      const id = list
        ? (
            list.find(w => w.id === saved) ??
            list.find(w => w.name === data.shortName)
          )?.id
        : saved
      if (id) {
        const ok = await reddit
          .updateWidget({...data, id})
          .then(() => true)
          .catch(err => {
            console.warn(`widget ${slot} update failed: ${err}`)
            return false
          })
        // a saved id the mods deleted, when the list couldn't be read: add it again
        if (ok || list) {
          await redis.hSet(widgetsKey, {[slot]: id})
          continue
        }
      }
      const w = await reddit.addWidget(data)
      await redis.hSet(widgetsKey, {[slot]: w.id})
      added.push(w.id)
    } catch (err) {
      console.warn(`widget ${slot} failed: ${err}`)
    }
  }
  if (list && added.length)
    await reddit
      .reorderWidgets(
        sub,
        topOrder(
          list.map(w => w.id),
          added,
        ),
      )
      .catch(err => console.warn(`widget order failed: ${err}`))
  return added
}

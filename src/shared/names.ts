/**
 * A light check on names players choose, such as crew names, which are posted in public comments
 * and flair. It is not a full moderation system: mods can still remove anything that slips by.
 * Names are folded first (case, accents, look-alike digits and symbols, repeated letters), so
 * "F.u.u.c.k" and "Sh1t" are caught too.
 */

// caught anywhere in the name, even run together with other words
const ANYWHERE = [
  'fuck',
  'fuk',
  'fck',
  'cunt',
  'shit',
  'nigger',
  'nigga',
  'faggot',
  'fagot',
  'bitch',
  'whore',
  'slut',
  'retard',
  'tranny',
  'wetback',
  'beaner',
  'kike',
  'nazi',
  'hitler',
  'porn',
  'penis',
  'vagina',
  'jizz',
  'wank',
  'twat',
  'bastard',
  'motherf',
  'dildo',
  'blowjob',
  'handjob',
  'rapist',
  'molest',
  'pedo',
  'paedo',
]
// caught only as a whole word, since they hide inside ordinary words (grape, Dickens, raccoon)
const WHOLE = [
  'ass',
  'arse',
  'asshole',
  'cock',
  'dick',
  'fag',
  'rape',
  'raped',
  'spic',
  'chink',
  'gook',
  'coon',
  'dyke',
  'paki',
  'cum',
  'tit',
  'tits',
  'boob',
  'boobs',
  'sex',
  'anal',
  'pussy',
  'homo',
  'jap',
  'negro',
  'niger',
  'kkk',
  'piss',
  'prick',
  'skank',
  'hoe',
  'hoes',
  'wop',
]

// ordinary words and places with one of the above inside, taken out before the check
const ALLOWED = [
  'scunthorpe',
  'shiitake',
  'therapist',
  'torpedo',
  'swank',
  'penistone',
  'fukuoka',
  'nigeria',
]

const LOOKALIKE: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  $: 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
}

const squeeze = (s: string): string => s.replace(/(.)\1+/g, '$1')

/** Lower case, accents off, look-alikes swapped back, everything but letters and spaces dropped. */
function fold(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0-9!@$]/g, c => LOOKALIKE[c] ?? c)
    .replace(/[^a-z\s]/g, '')
}

const anywhere = ANYWHERE.map(squeeze)
const allowed = ALLOWED.map(squeeze)
const whole = new Set(WHOLE)

/** True when a name a player chose shouldn't be shown in the subreddit. */
export function isOffensive(name: string): boolean {
  const folded = fold(name)
  let joined = squeeze(folded.replace(/\s+/g, ''))
  for (const w of allowed) joined = joined.replaceAll(w, ' ')
  if (anywhere.some(w => joined.includes(w))) return true
  // whole words; also with single letters spaced out joined back up, as in "a s s"
  const words = folded.split(/\s+/).filter(Boolean)
  const spaced = words.every(w => w.length === 1) ? [words.join('')] : []
  return [...words, ...spaced].some(w => whole.has(w) || whole.has(squeeze(w)))
}

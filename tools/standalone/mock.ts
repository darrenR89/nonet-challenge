// An in-browser stand-in for the Nonet server, for the standalone prototype page.
// It answers the same /api routes from this browser alone: today's seeded cube,
// a field of made-up rival players, a sample team event, scoring with the same
// code as the real server, the one retry, streaks and tomorrow's preview.
// State lives in localStorage, so it's per viewer and per browser.
import {type Duel, duelResult, MAX_CHALLENGES, cleanName} from '../../src/shared/duel.ts'
import {makeDay} from '../../src/shared/model.js'
import {
  addDays,
  dayKey,
  levelOf,
  maxTurns,
  dayOfYear,
  type RunStats,
  scoreRun,
  weekday,
  weekKey,
} from '../../src/shared/scoring.ts'

const KEY = 'nonet-demo'
const ME = 'you'
type Store = {
  days: Record<
    string,
    {tier?: number; started?: number; score?: number; stars?: number; retries?: number}
  >
  streak: number
  best: number
  played: number
  last: string
  team?: string
  notify: boolean
  /** Challenges sent, by day. */
  sent?: Record<string, string[]>
  /** Your answer to the day's sample challenge. */
  answered?: Record<string, boolean>
}
const load = (): Store => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (v) return v as Store
  } catch {}
  return {days: {}, streak: 2, best: 5, played: 11, last: addDays(dayKey(), -1), notify: false}
}
const save = (s: Store): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {}
}

const cache = new Map<string, ReturnType<typeof makeDay>>()
const cube = (day: string) => {
  let d = cache.get(day)
  if (!d) {
    d = makeDay(`nonet-demo:${day}`, levelOf(day))
    cache.set(day, d)
  }
  return d
}

// rivals: the same made-up field every time for a given day
const NAMES = ['cubewright','ninefold','sudo_ku','tessellate','quietfox','blockparty','kaisen','lattice_lou','pencilmark','turnbuckle','hanafuda','gridlock_gus','mochi_math','facet','rowan_col','yuzu','corner_case','pivot_pat','oddsquare','nonagon']
function rnd(seed: string) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}
const rivalsOn = (day: string) => {
  const r = rnd(`rivals:${day}`)
  return NAMES.slice(0, 14 + Math.floor(r() * 6)).map(name => ({
    name,
    score: Math.round(900 + r() * 1700),
    time: Math.round(70 + r() * 260),
    tier: Math.min(maxTurns(levelOf(day)), Math.floor(r() * 4)),
  }))
}
const rivalsWeek = (day: string) => {
  const totals = new Map<string, number>()
  for (let d = weekday(day) - 1; d >= 0; d--)
    for (const x of rivalsOn(addDays(day, -d)))
      totals.set(x.name, (totals.get(x.name) ?? 0) + x.score)
  return totals
}

function board(label: string, scores: Map<string, number>) {
  const rows = [...scores].sort((a, b) => b[1] - a[1])
  const at = rows.findIndex(([n]) => n === ME)
  return {
    key: label,
    label,
    top: rows.slice(0, 9).map(([name, score], i) => ({rank: i + 1, name, score})),
    me: at >= 0 ? {rank: at + 1, name: ME, score: rows[at]?.[1] ?? 0} : undefined,
    players: rows.length,
  }
}
function boards(day: string, s: Store) {
  const today = new Map(rivalsOn(day).map(x => [x.name, x.score]))
  const week = rivalsWeek(day)
  for (let d = weekday(day) - 1; d >= 0; d--) {
    const k = addDays(day, -d)
    const sc = s.days[k]?.score
    if (sc) week.set(ME, (week.get(ME) ?? 0) + sc)
  }
  const mine = s.days[day]?.score
  if (mine) today.set(ME, mine)
  return {day: board('Today', today), week: board('This week', week)}
}

// a sample team event, running this week
function eventState(day: string, s: Store) {
  const start = addDays(day, -(weekday(day) - 1))
  const e = {
    id: 'demo-big-game',
    title: 'Big Game Week',
    tagline: 'Pick a side. Every cube you solve scores for it.',
    start,
    end: addDays(start, 6),
    accent: '#e31837',
    teams: [
      {id: 'chiefs', name: 'Chiefs', color: '#E31837'},
      {id: 'eagles', name: 'Eagles', color: '#4CB7A5'},
    ],
    teamScoring: 'avg' as const,
    bonusMult: 2,
    postTitle: '',
  }
  const mine = s.days[day]?.score ?? 0
  const teams = [
    {team: e.teams[0]!, score: 3076 + (s.team === 'chiefs' ? Math.round(mine / 4) : 0), players: 41 + (s.team === 'chiefs' ? 1 : 0), rank: 0},
    {team: e.teams[1]!, score: 3345 + (s.team === 'eagles' ? Math.round(mine / 4) : 0), players: 38 + (s.team === 'eagles' ? 1 : 0), rank: 0},
  ].sort((a, b) => b.score - a.score)
  teams.forEach((t, i) => (t.rank = i + 1))
  const ev = new Map(rivalsOn(day).map(x => [x.name, x.score * 2]))
  if (mine) ev.set(ME, mine * 2)
  return {event: e, dayOf: weekday(day), days: 7, board: board(e.title, ev), teams, myTeam: s.team}
}

function streakNow(day: string, s: Store) {
  const alive = s.last === day || s.last === addDays(day, -1)
  return {current: alive ? s.streak : 0, best: s.best, played: s.played}
}
const stats = (day: string, s: Store) => {
  const r = rivalsOn(day)
  const mine = s.days[day]
  const times = r.map(x => x.time)
  if (mine?.score) times.push(Math.round((mine as {time?: number}).time ?? 120))
  const runs = r.map(x => ({tier: x.tier, time: x.time, score: x.score}))
  if (mine?.score && s.days[day]?.tier !== undefined)
    runs.push({tier: s.days[day]!.tier!, time: (mine as {time?: number}).time ?? 120, score: mine.score})
  const tiers = [0, 1, 2, 3].map(tier => {
    const t = runs.filter(x => x.tier === tier)
    const n = t.length
    return {
      tier,
      picks: n + Math.round(n * 0.3),
      solves: n,
      avgTime: n ? Math.round(t.reduce((a, b) => a + b.time, 0) / n) : 0,
      avgScore: n ? Math.round(t.reduce((a, b) => a + b.score, 0) / n) : 0,
      best: n ? Math.max(...t.map(x => x.score)) : 0,
    }
  })
  return {
    solves: times.length,
    avgTime: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    fastest: Math.min(...times),
    tiers,
  }
}
const preview = (day: string, s: Store) =>
  s.days[day]?.stars === 3 ? {day: addDays(day, 1), given: cube(addDays(day, 1)).base.given} : undefined

const cubeNo = dayOfYear

// challenges: one rival has challenged you today; rivals you challenge answer at once
// with their score from the field, and anyone else stays pending
const CHALLENGER = 'quietfox'
function duels(day: string, s: Store): Duel[] {
  const field = new Map(rivalsOn(day).map(x => [x.name, x.score]))
  const mine = s.days[day]?.score
  const one = (them: string, sent: boolean): Duel => {
    const theirs = field.get(them)
    // rivals you challenge accept at once; the sample challenge waits for your answer
    const ans = s.answered?.[day]
    const status: Duel['status'] = sent
      ? theirs === undefined ? 'offered' : 'accepted'
      : ans === undefined ? (mine === undefined ? 'offered' : 'lapsed') : ans ? 'accepted' : 'declined'
    const result = status === 'accepted' ? duelResult(mine, theirs) : 'pending'
    const past = {won: them.length % 3, lost: 1, tied: 0}
    if (result === 'won') past.won++
    if (result === 'lost') past.lost++
    if (result === 'tied') past.tied++
    return {day, them, themId: `t2_${them}`, sent, mine, theirs, status, result, record: past}
  }
  return [one(CHALLENGER, false), ...(s.sent?.[day] ?? []).map(n => one(n, true))]
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}})
const err = (status: number, error: string): Response => json({error, status}, status)

/** The prototype's Logged out switch: the page plays as a visitor with no Reddit account. */
export const isGuest = (): boolean => {
  try {
    return sessionStorage.getItem('nonet-guest') === '1'
  } catch {
    return false
  }
}

async function route(path: string, body: Record<string, unknown>): Promise<Response> {
  const day = dayKey()
  const s = load()
  const rec = (s.days[day] ??= {})
  const guest = isGuest()
  if (guest && path === 'api/daily')
    return json({
      day,
      weekday: weekday(day),
      week: weekKey(day),
      level: levelOf(day),
      my: {retries: 0},
      streak: {current: 0, best: 0, played: 0},
      boards: boards(day, {...s, days: {}}),
      event: eventState(day, {...s, days: {}, team: undefined}),
      loggedIn: false,
      cubeNo: cubeNo(day),
      stats: stats(day, s),
      subreddit: 'nonet_challenge_dev',
      notify: false,
      duels: [],
    })
  if (guest && path === 'api/card')
    return json({day, no: cubeNo(day), loggedIn: false, solves: stats(day, s).solves, streak: 0})
  if (guest && path === 'api/daily/start') {
    const tier = Number(body.tier) || 0
    try {
      sessionStorage.setItem('nonet-guest-run', JSON.stringify({tier, started: Date.now()}))
    } catch {}
    return json({tier, puzzle: cube(day).tiers[tier], guest: '00000000-0000-4000-8000-000000000000'})
  }
  if (guest && path.startsWith('api/') && !path.startsWith('api/telemetry') && path !== 'api/board')
    return err(401, 'Log in to Reddit to play for points.')
  // a run played logged out, claimed after signing up
  if (path === 'api/daily/score' && body.guest && rec.tier === undefined) {
    try {
      const g = JSON.parse(sessionStorage.getItem('nonet-guest-run') ?? 'null')
      if (g) {
        rec.tier = g.tier
        rec.started = g.started
        sessionStorage.removeItem('nonet-guest-run')
      }
    } catch {}
  }
  switch (path) {
    case 'api/daily':
      return json({
        day,
        weekday: weekday(day),
        week: weekKey(day),
        level: levelOf(day),
        puzzle: rec.tier !== undefined ? cube(day).tiers[rec.tier] : undefined,
        my: {tier: rec.tier, score: rec.score, starsWon: rec.stars, retries: rec.retries ?? 0},
        streak: streakNow(day, s),
        preview: preview(day, s),
        boards: boards(day, s),
        event: eventState(day, s),
        loggedIn: true,
        cubeNo: cubeNo(day),
        stats: stats(day, s),
        subreddit: 'nonet_challenge_dev',
        notify: s.notify,
        duels: duels(day, s),
      })
    case 'api/card': {
      // the prototype's card-state switcher can stand in for a quiet day or a finished one
      let look = ''
      try {
        look = sessionStorage.getItem('nonet-card-look') ?? ''
      } catch {}
      const b = boards(day, s)
      const played = look === 'played' || (look === '' && rec.score !== undefined)
      return json({
        day,
        no: look === 'cycled' ? 366 : cubeNo(day),
        loggedIn: true,
        solves: look === 'first' ? 0 : stats(day, s).solves,
        streak: look === 'first' ? 0 : streakNow(day, s).current,
        score: played ? (rec.score ?? 1840) : undefined,
        rank: played ? (b.day.me?.rank ?? 6) : undefined,
      })
    }
    case 'api/daily/start': {
      if (rec.tier === undefined) {
        rec.tier = Number(body.tier) || 0
        rec.started = Date.now()
        save(s)
      }
      return json({tier: rec.tier, puzzle: cube(day).tiers[rec.tier]})
    }
    case 'api/daily/retry':
      if (rec.score !== undefined) return err(409, 'Today is already done.')
      if (rec.retries) return err(409, "You've used today's retry.")
      rec.retries = 1
      save(s)
      return json({retries: 1, penalty: 0.8})
    case 'api/daily/score': {
      if (rec.tier === undefined) return err(409, 'Press Play first.')
      const tier = rec.tier
      const st = body.stats as RunStats
      const blanks = cube(day).tiers[tier]!.given.filter(v => !v).length
      const pen = rec.retries ? 0.8 : 1
      const breakdown = scoreRun(levelOf(day), tier, {...st, blanks})
      const total = body.forfeit ? 0 : Math.round(breakdown.total * pen)
      const counted = rec.score === undefined && !body.forfeit
      if (rec.score === undefined) {
        rec.score = total
        rec.stars = body.forfeit ? 0 : st.starsWon
        ;(rec as {time?: number}).time = st.t1 + st.t2
        if (counted && s.last !== day) {
          s.streak = s.last === addDays(day, -1) ? s.streak + 1 : 1
          s.best = Math.max(s.best, s.streak)
          s.played += 1
          s.last = day
        }
        save(s)
      }
      const b = boards(day, s)
      const me = b.day.me
      return json({
        counted,
        breakdown,
        total: rec.score,
        rawTotal: breakdown.total,
        penalty: pen,
        beatPct: me && b.day.players > 1 ? Math.round(((b.day.players - me.rank) / (b.day.players - 1)) * 100) : 0,
        stats: stats(day, s),
        streak: streakNow(day, s),
        boards: b,
        event: eventState(day, s),
        preview: preview(day, s),
        duels: duels(day, s),
      })
    }
    case 'api/challenge/answer': {
      if (body.from !== `t2_${CHALLENGER}`) return err(404, 'No such challenge today.')
      if (rec.score !== undefined) return err(409, 'Challenges are accepted before you play.')
      if (s.answered?.[day] !== undefined) return err(409, "You've already answered that challenge.")
      ;(s.answered ??= {})[day] = body.accept === true
      save(s)
      return json({duels: duels(day, s)})
    }
    case 'api/challenge': {
      if (rec.score === undefined) return err(409, "Finish today's cube first.")
      const name = cleanName(body.name)?.toLowerCase()
      if (!name) return err(400, "That isn't a Reddit username.")
      if (name === ME) return err(400, "You can't challenge yourself.")
      const list = ((s.sent ??= {})[day] ??= [])
      if (name === CHALLENGER || list.includes(name))
        return err(409, `You and u/${name} already have a challenge today.`)
      if (list.length >= MAX_CHALLENGES)
        return err(429, `That's ${MAX_CHALLENGES} challenges today. Try again tomorrow.`)
      list.push(name)
      save(s)
      return json({duels: duels(day, s)})
    }
    case 'api/event/join':
      s.team ??= String(body.team)
      save(s)
      return json({event: eventState(day, s)})
    case 'api/notify':
      s.notify = !!body.on
      save(s)
      return json({notify: s.notify})
    case 'api/join':
      return json({joined: true})
    case 'api/board':
      return json({board: boards(day, s).week})
    default:
      if (path.startsWith('api/telemetry/'))
        return json({receipt: {status: 'JOURNEY_RECEIPT_DENIED_PLAYTEST'}})
      return err(404, 'not found')
  }
}

const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '').split('?')[0] ?? ''
  if (!path.startsWith('api/')) return realFetch(input, init)
  let body: Record<string, unknown> = {}
  try {
    if (typeof init?.body === 'string') body = JSON.parse(init.body)
  } catch {}
  await new Promise(r => setTimeout(r, 60))
  return route(path, body)
}

/** Clears this browser's demo state: today starts over. */
export function resetDemo(): void {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem('nonet-run')
    sessionStorage.clear()
  } catch {}
  location.reload()
}

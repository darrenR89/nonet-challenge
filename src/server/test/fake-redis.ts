// An in-memory stand-in for the Devvit Redis client, enough for the server's calls.
import {redis} from '@devvit/web/server'

type Z = Map<string, number>
const strings = new Map<string, string>()
const hashes = new Map<string, Map<string, string>>()
const zsets = new Map<string, Z>()

const hash = (k: string): Map<string, string> => {
  const h = hashes.get(k) ?? new Map<string, string>()
  hashes.set(k, h)
  return h
}
const zset = (k: string): Z => {
  const z = zsets.get(k) ?? new Map<string, number>()
  zsets.set(k, z)
  return z
}
const sorted = (k: string): [string, number][] =>
  [...zset(k)].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))

const fake = {
  get: async (k: string) => strings.get(k),
  set: async (k: string, v: string, o?: {nx?: boolean}) => {
    if (o?.nx && strings.has(k)) return ''
    strings.set(k, v)
    return 'OK'
  },
  del: async (...ks: string[]) => {
    for (const k of ks) {
      strings.delete(k)
      hashes.delete(k)
      zsets.delete(k)
    }
  },
  expire: async () => {},
  hGet: async (k: string, f: string) => hash(k).get(f),
  hMGet: async (k: string, fs: string[]) => fs.map(f => hash(k).get(f) ?? null),
  hGetAll: async (k: string) => Object.fromEntries(hash(k)),
  hSet: async (k: string, fv: Record<string, string>) => {
    for (const [f, v] of Object.entries(fv)) hash(k).set(f, v)
    return Object.keys(fv).length
  },
  hSetNX: async (k: string, f: string, v: string) => {
    if (hash(k).has(f)) return 0
    hash(k).set(f, v)
    return 1
  },
  hIncrBy: async (k: string, f: string, n: number) => {
    const v = Number(hash(k).get(f) ?? 0) + n
    hash(k).set(f, String(v))
    return v
  },
  hDel: async (k: string, fs: string[]) => {
    let n = 0
    for (const f of fs) if (hash(k).delete(f)) n++
    return n
  },
  zAdd: async (k: string, ...ms: {member: string; score: number}[]) => {
    for (const m of ms) zset(k).set(m.member, m.score)
    return ms.length
  },
  zIncrBy: async (k: string, m: string, n: number) => {
    const v = (zset(k).get(m) ?? 0) + n
    zset(k).set(m, v)
    return v
  },
  zRem: async (k: string, ms: string[]) => {
    let n = 0
    for (const m of ms) if (zset(k).delete(m)) n++
    return n
  },
  zScore: async (k: string, m: string) => zset(k).get(m),
  zRank: async (k: string, m: string) => {
    const i = sorted(k).findIndex(([x]) => x === m)
    return i < 0 ? undefined : i
  },
  zCard: async (k: string) => zset(k).size,
  zRange: async (
    k: string,
    start: number,
    stop: number,
    o?: {reverse?: boolean},
  ) => {
    const all = sorted(k)
    if (o?.reverse) all.reverse()
    return all
      .slice(start, stop < 0 ? undefined : stop + 1)
      .map(([member, score]) => ({member, score}))
  },
}

const saved = new Map<string, unknown>()
const target = redis as unknown as Record<string, unknown>

export function installFakeRedis(): void {
  for (const [name, fn] of Object.entries(fake)) {
    saved.set(name, target[name])
    target[name] = fn
  }
}
export function removeFakeRedis(): void {
  for (const [name, fn] of saved) target[name] = fn
}
export function clearFakeRedis(): void {
  strings.clear()
  hashes.clear()
  zsets.clear()
}

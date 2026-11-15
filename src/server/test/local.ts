// Local run of the real server with in-memory Redis, serving public/ too. For trying the UI off Reddit.
// node --experimental-strip-types src/server/test/local.ts [port]
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {extname, join, normalize} from 'node:path'
import {
  type Context,
  reddit,
  runWithContext,
  settings,
} from '@devvit/web/server'
import {onReq} from '../server.ts'
import {installFakeRedis} from './fake-redis.ts'

installFakeRedis()
const r = reddit as unknown as Record<string, unknown>
r.submitCustomPost = async () => ({id: 't3_local', url: 'http://localhost/'})
r.submitPost = async () => ({id: 't3_local', url: 'http://localhost/'})
;(settings as unknown as Record<string, unknown>).get = async () => true

const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
}
const pub = join(import.meta.dirname, '../../../public')
const port = Number(process.argv[2] ?? 5178)
createServer(async (req, rsp) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  if (path.startsWith('/api/') || path.startsWith('/internal/')) {
    const user =
      new URL(req.url ?? '/', 'http://x').searchParams.get('as') ?? 'darren'
    await runWithContext(
      {
        appName: 'nonet-challenge',
        userId: `t2_${user}`,
        username: user,
      } as unknown as Context,
      () => onReq(req, rsp),
    )
    return
  }
  const file = normalize(path).replace(/^\/+/, '') || 'game.html'
  try {
    const body = await readFile(join(pub, file))
    rsp.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    })
    rsp.end(body)
  } catch {
    rsp.writeHead(404)
    rsp.end('not found')
  }
}).listen(port, () => console.log(`http://localhost:${port}/game.html`))

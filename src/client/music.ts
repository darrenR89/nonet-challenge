// Music that builds as you play, in a new mood each run (music-gen.ts draws
// the loops). Every loop starts on one shared clock and loops natively in Web
// Audio, so the layers stay on the beat even when the game is busy; a layer
// comes in or drops out by fading its volume on the next beat. Which layers play
// when is in music-layers.ts. Short sounds for turns and locks are made here.
// Browsers only allow audio after a tap, so nothing starts until Play.
import {
  LOOP_BEATS,
  type LoopName,
  moodFor,
  RATE,
  renderLoop,
  scaleSteps,
} from './music-gen.ts'
import {fromStart, layersFor, type MusicState} from './music-layers.ts'

const STORE = 'nonet-sound'
// the mix: music sits well under the sound effects
const MUSIC_LEVEL = 0.45
const SFX_LEVEL = 1.6

type Track = {src: AudioBufferSourceNode; gain: GainNode; on: boolean}

let ctx: AudioContext | undefined
let master: GainNode | undefined
let bus: GainNode | undefined // the music
let sfx: GainNode | undefined // the sound effects
let tracks = new Map<LoopName, Track>()
let t0 = 0 // when beat 0 of the current tune falls, on the audio clock
let beat = 0.6
let scale: readonly number[] = []
let root = 62
let tuneId = 0
let newTune = true
let held = true
let muted = readMuted()
let state: MusicState = {stage: 0, progress: 0}
let lines = 0
let start = 0 // how far lined up the cube was when Line up began
let lockN = 0
let noise: AudioBuffer | undefined
const buttons: HTMLButtonElement[] = []

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORE) === 'off'
  } catch {
    return false
  }
}

/** The next point on the beat grid, `div` steps to a beat. */
function nextOnGrid(div = 1): number {
  if (!ctx) return 0
  const step = beat / div
  const now = ctx.currentTime + 0.02
  return t0 + Math.max(0, Math.ceil((now - t0) / step)) * step
}

/** Fades each loop in or out on the next beat to match the state. */
function apply(): void {
  if (!ctx) return
  const on = new Set<string>(layersFor(state))
  const at = nextOnGrid()
  for (const [name, t] of tracks) {
    const want = on.has(name)
    if (want === t.on) continue
    t.on = want
    t.gain.gain.cancelScheduledValues(at)
    t.gain.gain.setTargetAtTime(want ? 1 : 0, at, want ? 0.05 : 0.4)
  }
}

/** Swaps in a new tune: the old one fades out, the new one starts on its own beat. */
function startTune(): void {
  if (!ctx || !bus) return
  newTune = false
  const c = ctx
  const out = bus
  const id = ++tuneId
  for (const t of tracks.values()) {
    t.gain.gain.setTargetAtTime(0, c.currentTime, 0.3)
    t.src.stop(c.currentTime + 2)
  }
  tracks = new Map()
  const mood = moodFor(Math.floor(Math.random() * 2 ** 31))
  for (const b of buttons) b.title = `Music and sound · ${mood.name}`
  beat = 60 / mood.bpm
  root = mood.root
  scale = scaleSteps(mood)
  t0 = c.currentTime + 0.1
  // draw the loops a few at a time so the countdown animation stays smooth
  const order: LoopName[] = [
    'pad',
    'pulse',
    'bass',
    'beat',
    'bells',
    'keys',
    'arp',
    'lead',
    'finale',
  ]
  const next = (): void => {
    if (id !== tuneId) return
    const name = order.shift()
    if (!name) return
    const samples = renderLoop(name, mood)
    const buf = c.createBuffer(1, samples.length, RATE)
    buf.copyToChannel(samples, 0)
    const gain = c.createGain()
    gain.gain.value = 0
    const src = c.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.connect(gain).connect(out)
    // join the shared clock at the right point in this loop
    const when = Math.max(c.currentTime + 0.02, t0)
    const loopLen = LOOP_BEATS[name] * beat
    src.start(when, (when - t0) % loopLen)
    tracks.set(name, {src, gain, on: false})
    apply()
    setTimeout(next, 0)
  }
  next()
}

function setVolume(): void {
  if (master && ctx)
    master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02)
}

/** One short tone, starting at `at` on the audio clock. */
function tone(
  freq: number,
  {
    type = 'sine',
    vol = 0.2,
    len = 0.15,
    to,
    at,
  }: {
    type?: OscillatorType
    vol?: number
    len?: number
    to?: number
    at?: number
  },
): void {
  if (!ctx || !sfx) return
  const t = at ?? ctx.currentTime
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + len)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(vol, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t + len)
  o.connect(g).connect(sfx)
  o.start(t)
  o.stop(t + len + 0.02)
}

/** A note of the current tune's scale: degree 0 is its root, 5 an octave up. */
function degHz(deg: number): number {
  const step = scale[((deg % 5) + 5) % 5] ?? 0
  return 440 * 2 ** ((root + 12 * Math.floor(deg / 5) + step - 69) / 12)
}

/** A soft swish of filtered noise, for a turn. */
function swish(): void {
  if (!ctx || !sfx) return
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate / 4, ctx.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  const t = ctx.currentTime
  const src = ctx.createBufferSource()
  const f = ctx.createBiquadFilter()
  const g = ctx.createGain()
  src.buffer = noise
  f.type = 'bandpass'
  f.Q.value = 1.2
  f.frequency.setValueAtTime(600, t)
  f.frequency.exponentialRampToValueAtTime(2400, t + 0.18)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.25, t + 0.04)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
  src.connect(f).connect(g).connect(sfx)
  src.start(t)
  src.stop(t + 0.25)
}

/** Dips the music for a moment: long after a wrong lock, short under a lock. */
function duck(depth: number, at: number, hold: number): void {
  if (!bus || !ctx) return
  const g = bus.gain
  g.cancelScheduledValues(ctx.currentTime)
  g.setTargetAtTime(MUSIC_LEVEL * depth, at, 0.02)
  g.setTargetAtTime(MUSIC_LEVEL, at + hold, 0.15)
}

function drawButtons(): void {
  for (const b of buttons) {
    b.setAttribute('aria-pressed', String(!muted))
    b.classList.toggle('muted', muted)
  }
}

document.addEventListener('visibilitychange', () => {
  if (!ctx) return
  if (document.hidden) void ctx.suspend()
  else if (!held) void ctx.resume()
})

export const music = {
  /** Call from Play or Practice: the tap lets the audio start. */
  unlock(): void {
    held = false
    if (!ctx) {
      try {
        // on iPhone, Web Audio follows the silent switch unless marked as playback
        const session = Reflect.get(navigator, 'audioSession')
        if (session && typeof session === 'object')
          Reflect.set(session, 'type', 'playback')
        ctx = new AudioContext()
        master = ctx.createGain()
        // a limiter, so loud sound effects over the music never clip
        const limit = ctx.createDynamicsCompressor()
        limit.threshold.value = -6
        limit.knee.value = 6
        limit.ratio.value = 12
        limit.attack.value = 0.003
        limit.release.value = 0.15
        master.connect(limit).connect(ctx.destination)
        sfx = ctx.createGain()
        sfx.gain.value = SFX_LEVEL
        sfx.connect(master)
        bus = ctx.createGain()
        bus.gain.value = MUSIC_LEVEL
        bus.connect(master)
        setVolume()
      } catch {
        return // no Web Audio here: play on in silence
      }
    }
    void ctx.resume()
    if (newTune || tracks.size === 0) startTune()
  },

  /** Where the player is now. Call after every render. */
  update(next: MusicState & {lines: number}): void {
    const was = state.stage
    // a new run gets a new tune
    if (next.stage === 1 && (was === 0 || was === 3)) {
      newTune = true
      if (ctx && !held) startTune()
    }
    if (next.stage === 2 && was === 2 && next.lines > lines && ctx && !held) {
      const at = nextOnGrid(4)
      tone(degHz(10), {type: 'triangle', vol: 0.18, len: 0.5, at})
      tone(degHz(12), {
        type: 'triangle',
        vol: 0.15,
        len: 0.7,
        at: at + beat / 4,
      })
    }
    if (next.stage === 1 && was !== 1) start = next.progress
    lines = next.lines
    state = {
      stage: next.stage,
      progress:
        next.stage === 1 ? fromStart(next.progress, start) : next.progress,
      gaveUp: next.gaveUp,
    }
    apply()
  },

  /** Off the results screen: the finale fades out. */
  leave(): void {
    state = {stage: 0, progress: 0}
    apply()
  },

  /** Paused or covered: everything stops where it is. */
  hold(on: boolean): void {
    held = on
    if (!ctx) return
    if (on) void ctx.suspend()
    else if (!document.hidden) void ctx.resume()
  },

  sfx(kind: 'turn' | 'pencil' | 'lock' | 'wrong'): void {
    if (!ctx || muted || held) return
    if (kind === 'turn') swish()
    else if (kind === 'pencil') tone(2200, {vol: 0.06, len: 0.04})
    else if (kind === 'lock') {
      // each lock plays the next note up the tune's scale, on the next 16th
      const at = nextOnGrid(4)
      const d = 5 + (lockN++ % 7)
      tone(degHz(d), {type: 'triangle', vol: 0.3, len: 0.4, at})
      tone(degHz(d + 5), {vol: 0.08, len: 0.25, at})
      duck(0.6, at, 0.15)
    } else {
      lockN = 0
      tone(150, {type: 'triangle', vol: 0.35, len: 0.3, to: 80})
      if (ctx) duck(0.3, ctx.currentTime, beat * 4)
    }
  },

  /** A sound on/off button. The choice is kept for next time. */
  wire(button: HTMLButtonElement): void {
    buttons.push(button)
    drawButtons()
    button.addEventListener('click', () => {
      muted = !muted
      try {
        localStorage.setItem(STORE, muted ? 'off' : 'on')
      } catch {
        // private window: the choice lasts until the page closes
      }
      setVolume()
      drawButtons()
    })
  },
}

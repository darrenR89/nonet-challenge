// Music that builds as you play. The loops in public/music/ run in sync
// (Orchestre-JS keeps them on the beat) and layers come in or drop out as the
// clues line up and the squares fill; see music-layers.ts for which play when.
// Short sounds for turns and locks are made here with Web Audio.
// Browsers only start audio after a tap, so nothing loads until Play.
import {BufferLoader, Orchestre} from 'orchestre-js'
import {fromStart, LOOPS, layersFor, type MusicState} from './music-layers.ts'

const BPM = 100
const LOOP_BEATS = 8
const STORE = 'nonet-sound'
// the yo scale on D: each lock plays the next note, so a run of locks is a tune
const LOCK_NOTES = [74, 76, 79, 81, 83, 86]

declare global {
  interface Window {
    /** The standalone prototype page carries its loops inline, as data: URLs. */
    nonetMusic?: Record<string, string>
  }
}

let ctx: AudioContext | undefined
let orch: Orchestre | undefined
let ready = false
let held = true
let muted = readMuted()
let state: MusicState = {stage: 0, progress: 0}
let lines = 0
let start = 0 // how far lined up the cube was when Line up began
let lockN = 0
let duckT = 0
let noise: AudioBuffer | undefined
const buttons: HTMLButtonElement[] = []

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORE) === 'off'
  } catch {
    return false
  }
}

/**
 * Reads inline data: loops straight from their base64, so the standalone page
 * plays them even where its host blocks fetch; anything else loads as usual.
 */
class InlineLoader extends BufferLoader {
  readonly #ctx: AudioContext
  constructor(context: AudioContext) {
    super(context)
    this.#ctx = context
  }
  override async load(name: string, url: string): Promise<AudioBuffer> {
    const comma = url.indexOf(',')
    if (!url.startsWith('data:') || comma < 0) return super.load(name, url)
    const bin = atob(url.slice(comma + 1))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const buffer = await this.#ctx.decodeAudioData(bytes.buffer)
    this.buffers[name] = buffer
    return buffer
  }
}

/** On iPhone, Web Audio follows the silent switch unless it is marked as playback. */
function playThroughSilentSwitch(): void {
  const session = Reflect.get(navigator, 'audioSession')
  if (session && typeof session === 'object')
    Reflect.set(session, 'type', 'playback')
}

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)

/** Starts or stops each loop to match the state, on the next beat. */
function apply(): void {
  if (!orch || !ready) return
  const on = new Set<string>(layersFor(state))
  for (const name of LOOPS) {
    const playing = orch.isPlaying(name)
    if (on.has(name) && !playing) orch.play(name, {fade: 0.4})
    else if (!on.has(name) && playing) orch.stop(name, {fade: 0.8})
  }
}

function setVolume(): void {
  orch?.setVolume(muted ? 0 : 1)
}

/** One short tone through its own envelope. */
function tone(
  freq: number,
  {
    type = 'sine',
    vol = 0.15,
    len = 0.15,
    to,
  }: {type?: OscillatorType; vol?: number; len?: number; to?: number},
): void {
  if (!ctx) return
  const t = ctx.currentTime
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + len)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(vol, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t + len)
  o.connect(g).connect(ctx.destination)
  o.start(t)
  o.stop(t + len + 0.02)
}

/** A soft swish of filtered noise, for a turn. */
function swish(): void {
  if (!ctx) return
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
  g.gain.linearRampToValueAtTime(0.12, t + 0.04)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
  src.connect(f).connect(g).connect(ctx.destination)
  src.start(t)
  src.stop(t + 0.25)
}

/** Drops the music for about a bar after a wrong lock. */
function duck(): void {
  if (!orch || muted) return
  orch.setVolume(0.3)
  clearTimeout(duckT)
  duckT = window.setTimeout(setVolume, 1400)
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
    if (ctx) {
      void ctx.resume()
      return
    }
    try {
      playThroughSilentSwitch()
      ctx = new AudioContext()
      orch = new Orchestre(BPM, ctx)
      // the loader is private in Orchestre-JS's types, so it is swapped by name
      Reflect.set(orch, 'loader', new InlineLoader(ctx))
      setVolume()
    } catch {
      return // no Web Audio here: play on in silence
    }
    const o = orch
    o.addPlayers(
      [...LOOPS, 'finale'].map(name => ({
        name,
        url: window.nonetMusic?.[name] ?? `/music/${name}.wav`,
        length: LOOP_BEATS,
      })),
    )
      .then(() => {
        o.start()
        ready = true
        apply()
      })
      .catch(() => {
        // the loops didn't load: the sounds still play, the music doesn't
      })
  },

  /** Where the player is now. Call after every render. */
  update(next: MusicState & {lines: number; gaveUp: boolean}): void {
    const was = state.stage
    if (next.stage === 3 && was !== 3 && was !== 0 && ready && !held) {
      if (!next.gaveUp) orch?.play('finale', {once: true})
    } else if (next.stage === 2 && was === 2 && next.lines > lines) {
      tone(hz(86), {type: 'triangle', vol: 0.08, len: 0.5})
      window.setTimeout(
        () => tone(hz(93), {type: 'triangle', vol: 0.07, len: 0.7}),
        110,
      )
    }
    if (next.stage === 1 && was !== 1) start = next.progress
    lines = next.lines
    state = {
      stage: next.stage,
      progress:
        next.stage === 1 ? fromStart(next.progress, start) : next.progress,
    }
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
    else if (kind === 'pencil') tone(2200, {vol: 0.04, len: 0.04})
    else if (kind === 'lock') {
      const n = LOCK_NOTES[lockN++ % LOCK_NOTES.length] ?? 74
      tone(hz(n), {type: 'triangle', vol: 0.14, len: 0.35})
      tone(hz(n + 12), {vol: 0.04, len: 0.2})
    } else {
      lockN = 0
      tone(150, {type: 'triangle', vol: 0.2, len: 0.3, to: 80})
      duck()
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

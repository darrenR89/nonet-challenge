// One-time wipe of saved demo progress when this version first loads, so every viewer starts fresh.
const STAMP = 'nonet-fresh', VERSION = '2026-11-15a'
try {
  if (localStorage.getItem(STAMP) !== VERSION) {
    for (const k of Object.keys(localStorage)) if (k.startsWith('nonet')) localStorage.removeItem(k)
    sessionStorage.clear()
    localStorage.setItem(STAMP, VERSION)
  }
} catch {}

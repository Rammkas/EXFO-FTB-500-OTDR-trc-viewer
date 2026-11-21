# Changelog

## 1.0.0 — 2026-11-22

First public release of the browser viewer for EXFO FTB-500 `.trc`
reflectograms. Pure static HTML + JS, no dependencies, works offline.

- `.trc` parsed in the browser (`otdr-parser.js`): zlib chunk scan, own RFC 1950
  inflate with big-endian Adler-32 check, 16-byte-header node tree
  (`OtdrFile → Fibers → Traces`), `RawSamples` (Int16, 1024 counts/dB) to
  dB-vs-distance curves, `EventTable` events and LMA sections.
- Canvas plot: mean trace line + translucent per-pixel min/max envelope, so
  reflection peaks and noise survive zooming out without line-thickness jumps.
- Navigation: wheel zoom (delta normalized between Firefox and Chromium,
  ≈ ×1.16 per click), drag pan, horizontal-wheel pan, Shift+drag box zoom,
  double click reset; five view presets including **fiber (after the buffer)**
  which also places cursors A/B on the QC connector and the fiber end.
- Stable Y scale: zoom and pan never change it; refit only on explicit actions
  (load, preset, box zoom, wavelength switch, double click, Auto-Y, Fit Y).
  Robust fit: 2–98 % percentile band plus edge reflection peaks limited to
  +12 dB / −6 dB, noise beyond the fiber end excluded unless the window is
  almost entirely noise.
- Cursors A/B with snapping to `EventTable` events (±12 px), readout of
  distance/level at A and B, Δdistance, ΔdB and robust attenuation dB/km;
  plot overlay with segment length and attenuation per wavelength.
- Metadata cards (fiber, date, module/serial, span length/loss, attenuation,
  injection, ORL, RMS noise, samples) collapse to the left and are collapsed by
  default; the fiber measurement card and cursor readout are always visible.
- UI languages UA / EN / RU (UA default).
- Print / Save as PDF of the current window state, always one sheet, canvas
  re-rendered at ~300 dpi with fixed print geometry.
- Parser self-tests: `tests/selftest.html`, 25 checks on a synthetic `.trc` plus
  inflate cross-checked against the browser's `CompressionStream`.

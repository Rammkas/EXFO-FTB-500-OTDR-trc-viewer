# TrcViewer — EXFO FTB-500 `.trc` reflectogram viewer

Interactive viewer for EXFO FTB-500 / OTDR Expert reflectograms (`.trc`) that
runs **entirely in the browser**: one static `index.html` + one JS parser file.
No server, no Node/Python/Excel, no build step, no dependencies — it works
offline from a local folder.

The `.trc` file is parsed directly in JavaScript: `otdr-parser.js` is a port of
the format documented in [FORMAT.md](FORMAT.md) (canonical copy maintained in
the [ExfoTrcAnalyzer](https://github.com/Rammkas/EXFO-FTB-500-OTDR-.trc-Analyzer)
repository). Nothing is uploaded anywhere: the file never leaves the browser.

## Run

Double-click `index.html` (or open it in a tab) → drag a `.trc` file onto the
page, or use the **Відкрити .trc / Open .trc** button. If the file contains
several fibers, pick one in the header dropdown.

Tested in Firefox and Chromium-based browsers (Chrome, Edge).

## Features

- **Both wavelengths** (1310 / 1550 nm) as checkboxes, drawn from the raw
  `RawSamples` blobs (Int16, 1024 counts per dB). Each trace is a thin constant
  width *mean* line plus a translucent per-pixel min/max envelope: reflection
  peaks and noise are never lost when zooming out, and zooming never makes the
  line jump from thick to thin — noise stays a soft halo around a stable line.
- **Zoom with the mouse wheel**, pan by dragging or by horizontal wheel
  (trackpad/Firefox), box zoom with **Shift+drag**, double click to reset.
  The wheel delta is normalized between browsers (Firefox counts lines, Chrome
  counts pixels): one click ≈ ×1.16.
- **Stable Y scale**: neither panning nor zooming ever changes the vertical
  scale. Y is refitted only on explicit actions — loading a file, a preset, box
  zoom, changing visible wavelengths, double click, the *Auto-Y* checkbox or the
  **Fit Y** button. With *Auto-Y* off the scale is frozen completely.
- **Robust Y fit** (on explicit actions): the trace band is taken from the
  2–98 % percentiles, then edge reflection peaks are added, but no more than
  +12 dB above and −6 dB below the band — so port / QC / end reflections fit
  with a small margin, while the port ADC spike (±37 dB) does not stretch the
  scale. Noise beyond the fiber end participates only when the window is almost
  entirely noise.
- **EXFO event markers** from `EventTable` (port, reflecting events, fiber end,
  LMA sections) with tooltips: loss, reflectance, position.
- **Cursors A/B**: the button drops a cursor at the center of the view, dragging
  moves it, and a cursor **snaps to `EventTable` events** within ~12 px (port,
  connectors, fiber end) — so the A–B segment length matches the fiber
  measurement card. The readout shows distance and level at A/B, Δdistance, ΔdB
  and attenuation in dB/km between the cursors (robust estimate; raw
  ΔdB/Δkm stays as reference).
- **Plot overlay** (top right corner): for the current view — cursors A–B (if
  set) or the current view window: bounds, **segment length** and attenuation
  for every visible wavelength. The estimate is robust: the window is cut at
  point events (connector steps do not bias the slope), sub-segments use ~50 m
  median pockets plus least squares; the port start zone and the noise beyond
  the fiber end are excluded. On the reference file it gives 0.323 / 0.184 dB/km
  over the full range and 0.322 / 0.183 between the QC connector and the fiber
  end — the same as the analyzer's GOLD values.
- **Presets**: full range · start 0–30 m · buffer 0–1200 m · **fiber (after the
  buffer: from the QC connector to the fiber end — this preset also places
  cursors A/B exactly on those boundaries, so the overlay segment length equals
  the fiber measurement card)** · fiber end ±50 m.
- **Cards row**: metadata cards (`TrcViewer`, `1310 nm`, `1550 nm`) collapse to
  the left with the **Метадані / Metadata** button and are **collapsed by
  default** (the choice is remembered in `localStorage`). The **fiber
  measurement card** (length QC → end and dB/km per wavelength: length from
  `EventTable` events, attenuation from the LMA section, exactly like the
  analyzer GOLD) and the cursor readout are always on screen. The plot takes the
  remaining page height; the page footer holds the load status and the
  hover coordinates/levels for all enabled wavelengths.
- **Metadata cards**: fiber, date, module/serial, span length, span loss,
  **attenuation dB/km** (from the `EventTable` LMA section like the analyzer
  GOLD, or from the raw trace slope when no section exists), injection level,
  ORL, RMS noise, sample count.
- **UI languages**: UA / EN / RU switch in the header, **Ukrainian by default**.
- **Print / Save as PDF** (the **Друк / Print** button → the browser's own print
  dialog): prints the **current state of the main window** — view window, cursors
  A/B, selected wavelengths, event markers, and whether the metadata cards are
  collapsed (the collapse button itself is hidden in print). Always **one sheet**:
  the print layout uses only relative sizes (blocks full page width, `body`
  height `min(100vh, 100%)`, `overflow: hidden`, plot takes the remaining height
  with `flex`), because the printable width in CSS pixels differs between
  browsers and drivers. For printing, the canvas is re-rendered with a fixed
  print geometry (`PRINT_W = 1400`, aspect `2.9`, `2.6` when the metadata cards
  are collapsed) at 3× resolution (~300 dpi), so physical font/label sizes do
  not depend on the window shape and there are no empty bands around the plot.

## Files

```
index.html          UI + plot (canvas), zoom/pan, cursors A/B, events, printing
otdr-parser.js      .trc parser (no DOM access), used by index.html and the tests
tests/selftest.html parser self-tests — open in a browser
FORMAT.md           full reverse-engineered .trc format description
README.ru.md        полное описание на русском
CHANGELOG.md        release history
LICENSE             MIT
```

## How the parser works (short version)

1. Scan the file for zlib chunks (CMF = 0x78, RFC 1950 rule
   `(CMF*256 + FLG) % 31 == 0`), inflate with a self-contained inflate
   implementation, verify the big-endian Adler-32; short service chunks are
   skipped, exactly as in the analyzer.
2. Walk the node tree of 16-byte headers (root `OtdrFile`):
   `Fibers → FiberN → Traces → TraceN`.
3. Trace curve: `RawSamples` blob (Int16 LE), `level_db = raw / ScaleFactor`,
   `dist_i = (RangeStart + i·SamplingPeriod) · Range / (RangeEnd − RangeStart)`.
4. Events: `EventTable` (point / LMA records), `Status` 72 = port, 0 = reflecting
   event, 132 = fiber end; NaN in a Double node means "no value".

## Tests

Open `tests/selftest.html` in a browser: **25 tests** on a synthetic `.trc`
(zlib round trip, node tree, `RawSamples`, `EventTable`, NaN policy) plus a
cross-check of the built-in inflate against the browser's reference
`CompressionStream` / `DecompressionStream`. You can also pick a real `.trc`
file in that page to see the parsed events.

Reference values for the GOLD sample `9076.trc` (matches the analyzer GOLD;
the sample file itself is **not** included in this repository):

| Parameter | 1310 nm | 1550 nm |
|---|---|---|
| QC connector event | 1010.93 m (loss 0.541 dB) | 1010.56 m (0.440 dB) |
| Fiber end | 8349.28 m | 8347.10 m |
| Fiber under test length | 7338.4 m | 7336.5 m |
| Attenuation (raw trace slope) | 0.321 dB/km | 0.184 dB/km |

## Limitations

- Verified on OTDR Expert 6.x / FTB-7200D reference files. Files written by
  other firmware versions may not parse — the parser reports the failure
  instead of guessing.
- View and measurement, not editing: PASS/FAIL QC verdicts are not computed
  here — that remains the job of [ExfoTrcAnalyzer](https://github.com/Rammkas/EXFO-FTB-500-OTDR-.trc-Analyzer).
- No `.trc` sample files are published here on purpose: reflectograms contain
  real link data (dates, module serial numbers, lengths).

## Optional: serve it online with GitHub Pages

The app is a plain static site, so it can be hosted as is:
**Settings → Pages → Build and deployment → Deploy from a branch → `main` /
`/ (root)`**. Then the viewer is available at
`https://<your-user>.github.io/<repo>/index.html` and every user still opens
their own local `.trc` file — nothing is uploaded to the server.

## Related project

[ExfoTrcAnalyzer](https://github.com/Rammkas/EXFO-FTB-500-OTDR-.trc-Analyzer) —
the command-line QC analyzer for the same `.trc` format (verdicts, CSV reports,
`--map`, `--raw-trace`, `--excel-trace` exports, 37 regression tests). This
viewer reuses its format documentation and its GOLD expectations; the analyzer
code is not required to run the viewer.

## License

MIT — see [LICENSE](LICENSE).

## Русская версия

Полное описание на русском — в [README.ru.md](README.ru.md): запуск, все
возможности графика (зум, панорама, курсоры A/B с прилипанием к событиям,
пресеты, устойчивая подгонка Y, печать на один лист), разбор формата и тесты.

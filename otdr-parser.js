// ====================================================================================
// otdr-parser.js — парсер .trc (EXFO FTB-500) для TrcViewer.
// Порт формата, описанного в ExfoTrcAnalyzer/FORMAT.md; без обращений к DOM.
// Используется index.html (просмотрщик) и tests/selftest.html (тесты).
// ====================================================================================
'use strict';
// ============================================================================
// ПАРСЕР .trc (порт формата из ExfoTrcAnalyzer/FORMAT.md). Без обращений к DOM.
// ============================================================================

// ---------- поиск подмассива ----------
function bytesIndexOf(buf, pat, from) {
  outer: for (let i = from; i + pat.length <= buf.length; i++) {
    for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

// ---------- inflate (RFC 1950) ----------
function buildHuffman(lengths) {
  let maxLen = 1;
  for (const l of lengths) if (l > maxLen) maxLen = l;
  const counts = new Int32Array(maxLen + 1);
  for (const l of lengths) if (l > 0) counts[l]++;
  const offsets = new Int32Array(maxLen + 2);
  let off = 0;
  for (let l = 1; l <= maxLen; l++) { offsets[l] = off; off += counts[l]; }
  const symbols = new Int32Array(off);
  const pos = offsets.slice();
  for (let s = 0; s < lengths.length; s++) if (lengths[s] > 0) symbols[pos[lengths[s]]++] = s;
  return { counts, offsets, symbols, maxLen };
}

const LEN_BASE   = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LEN_EXTRA  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DIST_BASE  = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const CLEN_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

let FIXED_LIT = null, FIXED_DIST = null;

function inflateRaw(src, pos) {
  let p = pos, bitbuf = 0, bitcnt = 0;
  function rb(n) {
    while (bitcnt < n) {
      if (p >= src.length) throw new RangeError('inflate: eof');
      bitbuf |= src[p] << bitcnt; p++; bitcnt += 8;
    }
    const v = bitbuf & ((1 << n) - 1);
    bitbuf >>>= n; bitcnt -= n;
    return v;
  }
  function decodeSym(t) {
    // канон. Хаффман (как puff.c): first — начало кодового диапазона данной длины
    let code = 0, first = 0;
    for (let l = 1; l <= t.maxLen; l++) {
      code = (code << 1) | rb(1);
      const cnt = t.counts[l];
      if (cnt > 0 && code - first < cnt) return t.symbols[t.offsets[l] + code - first];
      first = (first + cnt) << 1;
    }
    throw new Error('inflate: bad huffman code');
  }

  let out = new Uint8Array(1 << 17), outLen = 0;
  function ensure(n) {
    if (outLen + n > out.length) {
      let cap = out.length;
      while (cap < outLen + n) cap *= 2;
      if (cap > (16 << 20)) throw new RangeError('inflate: output too large');
      const nw = new Uint8Array(cap); nw.set(out.subarray(0, outLen)); out = nw;
    }
  }

  for (;;) {
    const bfinal = rb(1), btype = rb(2);
    if (btype === 0) {                       // stored
      bitbuf = 0; bitcnt = 0;
      const l = rb(16); rb(16);             // LEN, NLEN (NLEN не проверяем)
      ensure(l);
      for (let i = 0; i < l; i++) {
        if (p >= src.length) throw new RangeError('inflate: eof in stored');
        out[outLen++] = src[p++];
      }
    } else {
      let lit, dist;
      if (btype === 1) {                     // фиксированные коды
        if (!FIXED_LIT) {
          const ll = new Array(288);
          for (let i = 0; i < 288; i++) ll[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
          const dl = new Array(30).fill(5);
          FIXED_LIT = buildHuffman(ll); FIXED_DIST = buildHuffman(dl);
        }
        lit = FIXED_LIT; dist = FIXED_DIST;
      } else if (btype === 2) {              // динамические коды
        const hlit = rb(5) + 257, hdist = rb(5) + 1, hclen = rb(4) + 4;
        const clens = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) clens[CLEN_ORDER[i]] = rb(3);
        const clenTab = buildHuffman(clens);
        const lengths = [];
        while (lengths.length < hlit + hdist) {
          const s = decodeSym(clenTab);
          if (s < 16) lengths.push(s);
          else if (s === 16) { const c = lengths[lengths.length - 1]; let rep = 3 + rb(2); while (rep-- > 0) lengths.push(c); }
          else if (s === 17) lengths.push(...new Array(3 + rb(3)).fill(0));
          else lengths.push(...new Array(11 + rb(7)).fill(0));
        }
        lit = buildHuffman(lengths.slice(0, hlit));
        dist = buildHuffman(lengths.slice(hlit, hlit + hdist));
      } else throw new Error('inflate: bad block type');

      for (;;) {
        const s = decodeSym(lit);
        if (s < 256) { ensure(1); out[outLen++] = s; }
        else if (s === 256) break;
        else {
          const li = s - 257;
          if (li >= LEN_BASE.length) throw new Error('inflate: bad length code');
          const len = LEN_BASE[li] + rb(LEN_EXTRA[li]);
          const ds = decodeSym(dist);
          if (ds >= DIST_BASE.length) throw new Error('inflate: bad distance code');
          const d = DIST_BASE[ds] + rb(DIST_EXTRA[ds]);
          if (d > outLen) throw new Error('inflate: distance too far back');
          ensure(len);
          // ВАЖНО: читать RHS ДО записи (в JS lvalue out[outLen++] вычисляется раньше RHS)
          for (let i = 0; i < len; i++) { const v = out[outLen - d]; out[outLen] = v; outLen++; }
        }
      }
    }
    if (bfinal) break;
  }
  // p уже за последним байтом, содержавшим завершающие биты блока → начало Adler-32
  return { data: out.subarray(0, outLen), end: p };
}

function adler32(data) {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

// Чанки: CMF=0x78, FLG валиден по RFC1950, без словаря; Adler-32 большого порядка.
// Короткие чанки (<50 B, как служебный #01) пропускаются (как в анализаторе):
// offsets дерева абсолютны в потоке конкатенации основных чанков.
function decompressChunks(src) {
  const parts = [];
  let i = 0;
  while (i < src.length - 3) {
    if (src[i] === 0x78 && ((src[i] * 256 + src[i + 1]) % 31 === 0) && !(src[i + 1] & 0x20)) {
      try {
        const r = inflateRaw(src, i + 2);
        if (r.end + 4 <= src.length) {
          const ad = ((src[r.end] << 24) | (src[r.end + 1] << 16) | (src[r.end + 2] << 8) | src[r.end + 3]) >>> 0;
          if (ad === adler32(r.data)) {
            if (r.data.length >= 50) parts.push(r.data);
            i = r.end + 4; continue;
          }
        }
      } catch (e) { /* не чанк — идём дальше */ }
    }
    i++;
  }
  if (!parts.length) throw new Error('trc: no valid zlib chunks found');
  const total = parts.reduce((s, x) => s + x.length, 0);
  const merged = new Uint8Array(total);
  let o = 0; for (const c of parts) { merged.set(c, o); o += c.length; }
  return merged;
}

// ---------- дерево узлов ----------
const T_CONTAINER = 0, T_INT32 = 1, T_BINARY = 2, T_DOUBLE = 3, T_UTF16 = 4, T_BOOL8 = 5;
const HDR = 16, CHILD = 4, MAX_NAME = 256;

function u32(b, o) { return (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0; }

function readName(b, nameOff) {
  if (nameOff < 0 || nameOff >= b.length) return null;
  let s = '';
  for (let i = 0; i < MAX_NAME; i++) {
    const c = b[nameOff + i];
    if (c === undefined || c === 0) break;
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
  }
  return s.length ? s : null;
}

function readHeader(b, off) {
  if (off < 0 || off + HDR > b.length) return null;
  const nameOff = u32(b, off), type = u32(b, off + 4), valLen = u32(b, off + 8), self = u32(b, off + 12);
  if (type > T_BOOL8) return null;
  if (valLen < 0 || valLen > b.length) return null;
  if (self !== off + HDR) return null;
  const name = readName(b, nameOff);
  if (name === null) return null;
  return { offset: off, type, name, valLen };
}

function children(b, h) {
  if (!h || h.type !== T_CONTAINER) return [];
  const vs = h.offset + HDR;
  const n = Math.max(0, Math.min(h.valLen, b.length - vs)) / CHILD;
  const res = [];
  for (let i = 0; i < n; i++) {
    const c = u32(b, vs + i * CHILD);
    if (c === 0) continue;
    const ch = readHeader(b, c);
    if (ch) res.push(ch);
  }
  return res;
}
function childByName(b, h, name) { for (const c of children(b, h)) if (c.name === name) return c; return null; }
function scalarsMap(b, h) { const m = {}; for (const c of children(b, h)) if (!(c.name in m)) m[c.name] = c; return m; }

function dblVal(b, h) {
  if (!h || h.type !== T_DOUBLE || h.valLen !== 8 || h.offset + HDR + 8 > b.length) return null;
  const v = new DataView(b.buffer, b.byteOffset + h.offset + HDR, 8).getFloat64(0, true);
  return Number.isNaN(v) ? null : v; // NaN = «значения нет»
}
function intVal(b, h) {
  if (!h || h.type !== T_INT32 || h.valLen !== 4 || h.offset + HDR + 4 > b.length) return null;
  return new DataView(b.buffer, b.byteOffset + h.offset + HDR, 4).getInt32(0, true);
}
function strVal(b, h) {
  if (!h || (h.type !== T_UTF16 && h.type !== T_BOOL8)) return null;
  const end = Math.min(h.offset + HDR + h.valLen, b.length);
  const dec = new TextDecoder('utf-16le');
  return dec.decode(b.subarray(h.offset + HDR, end)).replace(/\u0000+$/, '');
}

function findRoot(b) {
  const namePat = new TextEncoder().encode('OtdrFile\u0000');
  let from = 0, rel;
  while ((rel = bytesIndexOf(b, namePat, from)) >= 0) {
    const namePos = rel;
    const needle = new Uint8Array([namePos & 255, (namePos >>> 8) & 255, (namePos >>> 16) & 255, (namePos >>> 24) & 255]);
    let nf = 0, r;
    while ((r = bytesIndexOf(b, needle, nf)) >= 0) {
      const h = readHeader(b, r);
      if (h && h.name === 'OtdrFile' && h.type === T_CONTAINER) return h;
      nf = r + 1;
    }
    from = namePos + 1;
  }
  return null;
}

// ---------- извлечение данных ----------
function readTrace(b, h) {
  const sc = scalarsMap(b, h);
  const D = name => dblVal(b, sc[name]);
  const S = name => strVal(b, sc[name]);

  const wavelengthM = D('Wavelength');
  const countsPerDb = D('ScaleFactor') || 1024;
  const rangeM = D('Range') || 0;
  const periodS = D('SamplingPeriod') || 0;
  const rStart = D('RangeStart') || 0;
  const rEnd = D('RangeEnd') || 0;

  let samples = null;
  const raw = sc['RawSamples'];
  if (raw && raw.type === T_BINARY && raw.valLen >= 1024) {
    const dataOff = raw.offset + HDR;
    const count = Math.min(raw.valLen, b.length - dataOff) >> 1;
    const copy = new Uint8Array(b.subarray(dataOff, dataOff + count * 2)); // выровненная копия
    samples = new Int16Array(copy.buffer, 0, count);
  }

  // события EventTable (чередование point/LMA, как в FORMAT.md §7)
  const events = [];
  const evTab = childByName(b, h, 'EventTable');
  if (evTab) {
    for (const e of children(b, evTab)) {
      if (!/^Event\d+$/.test(e.name)) continue;
      const ec = scalarsMap(b, e);
      const pos = dblVal(b, ec['Position']);
      if (pos === null) continue;
      const isPoint = 'Type' in ec;
      events.push({
        dist: pos,
        kind: isPoint ? 'point' : 'section',
        status: isPoint ? intVal(b, ec['Status']) : null,
        type: isPoint ? intVal(b, ec['Type']) : null,
        loss: dblVal(b, ec['Loss']),
        reflectance: dblVal(b, ec['Reflectance']),
        length: dblVal(b, ec['Length']),
        curveLevel: dblVal(b, ec['CurveLevel']),
      });
    }
  }

  const mod = childByName(b, h, 'ModuleInformation');
  const modSc = mod ? scalarsMap(b, mod) : {};

  return {
    name: h.name,
    wavelengthNm: wavelengthM ? Math.round(wavelengthM * 1e9) : 0,
    samples, countsPerDb,
    rangeM, periodS, rangeStartS: rStart, rangeEndS: rEnd,
    hasGrid: rangeM > 0 && periodS > 0 && rEnd > rStart,
    events,
    meta: {
      date: S('Date') || '',
      injection: D('InjectionLevel'),
      spansLength: D('SpansLength'),
      spansLoss: D('SpansLoss'),
      orl: D('TotalOrl'),
      rmsNoise: D('RmsNoise'),
      module: modSc['ModelName'] ? strVal(b, modSc['ModelName']) : '',
      serial: modSc['SerialNumber'] ? strVal(b, modSc['SerialNumber']) : '',
    },
  };
}

function readFiber(b, h) {
  const sc = scalarsMap(b, h);
  const tracesC = childByName(b, h, 'Traces');
  const traces = tracesC
    ? children(b, tracesC).filter(t => /^Trace\d+$/.test(t.name)).map(t => readTrace(b, t))
    : [];
  return {
    name: h.name,
    code: intVal(b, sc['FiberCode']),
    identifier: strVal(b, sc['Identifier']) || '',
    locationA: strVal(b, sc['LocationA']) || '',
    locationB: strVal(b, sc['LocationB']) || '',
    traces,
  };
}

// Вход: ArrayBuffer содержимого .trc. Выход: массив волокон.
function parseTrcFile(buffer) {
  const bytes = new Uint8Array(buffer);
  const merged = decompressChunks(bytes);
  const root = findRoot(merged);
  if (!root) throw new Error('trc: OtdrFile root not found');
  const data = childByName(merged, root, 'OtdrData');
  const fibersC = data ? childByName(merged, data, 'Fibers') : null;
  if (!fibersC) throw new Error('trc: Fibers container not found');
  const fibers = children(merged, fibersC)
    .filter(f => /^Fiber\d+$/.test(f.name))
    .map(f => readFiber(merged, f));
  if (!fibers.length) throw new Error('trc: no FiberN containers');
  return fibers;
}

// Методы доступа к кривой (сетка равномерна — метры вычисляются, не хранятся)
function traceDistAt(tr, i) {
  return (tr.rangeStartS + i * tr.periodS) * tr.rangeM / (tr.rangeEndS - tr.rangeStartS);
}
function traceStepM(tr) { return tr.periodS * tr.rangeM / (tr.rangeEndS - tr.rangeStartS); }
function traceLevelDb(tr, i) { return tr.samples[i] / tr.countsPerDb; }
function traceMaxDist(tr) { return traceDistAt(tr, tr.samples.length - 1); }
globalThis.TRC_PARSER = { parseTrcFile, decompressChunks, inflateRaw, traceDistAt, traceStepM, traceLevelDb, traceMaxDist };

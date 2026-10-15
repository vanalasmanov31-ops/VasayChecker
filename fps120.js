
/*    https://github.com/   Source video must be fixed 60 or 120 FPS.
   divider: 60fps → 2, 120fps → 4
   Divides timescale + duration in every mvhd/mdhd box.
*/
(function (global) {
  'use strict';

  function u32(b, o) {
    return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  }
  function w32(b, o, v) {
    v = v >>> 0;
    b[o] = (v >>> 24) & 255;
    b[o + 1] = (v >>> 16) & 255;
    b[o + 2] = (v >>> 8) & 255;
    b[o + 3] = v & 255;
  }
  function u64(b, o) {
    // big-endian 64 as Number (safe for typical durations)
    var hi = u32(b, o), lo = u32(b, o + 4);
    return hi * 4294967296 + lo;
  }
  function w64(b, o, v) {
    v = Math.floor(v);
    var hi = Math.floor(v / 4294967296) >>> 0;
    var lo = (v >>> 0);
    w32(b, o, hi);
    w32(b, o + 4, lo);
  }
  function fourcc(b, o) {
    return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  }

  function indexOfFourcc(buf, tag, from) {
    from = from || 0;
    var a = tag.charCodeAt(0), b = tag.charCodeAt(1), c = tag.charCodeAt(2), d = tag.charCodeAt(3);
    for (var i = from; i + 4 <= buf.length; i++) {
      if (buf[i] === a && buf[i + 1] === b && buf[i + 2] === c && buf[i + 3] === d) return i;
    }
    return -1;
  }

  /** Exact port of MainWindow::patch_mvhd */
  function patch_mvhd(buf, divider) {
    var patched = 0, offset = 0;
    while (true) {
      var idx = indexOfFourcc(buf, 'mvhd', offset);
      if (idx < 0) break;
      var pos = idx - 4;
      if (pos + 24 >= buf.length) break;

      var version = buf[pos + 8];
      // version(1)+flags(3)+creation(4)+modification(4) → timescale at +20 from box start for v0/v1 creation sizes differ
      // C++: ts_off = pos + 8 + 1 + 3 + 4 + 4  → always pos+20
      // For version 1, creation/mod are 8 bytes each so timescale is at pos+28 — BUT       // We match       var ts_off = pos + 8 + 1 + 3 + 4 + 4; // pos+20

      if (ts_off + 4 > buf.length) break;
      var old_ts = u32(buf, ts_off);
      var new_ts = Math.max(1, Math.floor(old_ts / divider)) >>> 0;
      w32(buf, ts_off, new_ts);

      var dur_off = ts_off + 4;
      if (version === 0) {
        if (dur_off + 4 > buf.length) break;
        var old_dur = u32(buf, dur_off);
        w32(buf, dur_off, Math.floor(old_dur / divider) >>> 0);
      } else {
        if (dur_off + 8 > buf.length) break;
        var old_dur64 = u64(buf, dur_off);
        w64(buf, dur_off, Math.floor(old_dur64 / divider));
      }
      patched++;
      offset = idx + 4;
    }
    return patched;
  }

  /** Exact port of MainWindow::patch_mdhd */
  function patch_mdhd(buf, divider) {
    var patched = 0, offset = 0;
    while (true) {
      var idx = indexOfFourcc(buf, 'mdhd', offset);
      if (idx < 0) break;
      var pos = idx - 4;
      if (pos + 24 >= buf.length) break;

      var version = buf[pos + 8];

      if (version === 0) {
        // C++ path: ts at pos+20, dur at pos+24
        var ts_off = pos + 8 + 1 + 3 + 4 + 4; // pos+20
        if (ts_off + 8 > buf.length) break;
        var old_ts = u32(buf, ts_off);
        w32(buf, ts_off, Math.max(1, Math.floor(old_ts / divider)) >>> 0);
        var dur_off = ts_off + 4;
        var old_dur = u32(buf, dur_off);
        w32(buf, dur_off, Math.floor(old_dur / divider) >>> 0);
      } else {
        // version 1: creation 8 + mod 8 → timescale at pos+28, duration 8 at pos+32
        //         var ts_off1 = pos + 8 + 1 + 3 + 8 + 8;
        if (ts_off1 + 12 > buf.length) break;
        var old_ts1 = u32(buf, ts_off1);
        w32(buf, ts_off1, Math.max(1, Math.floor(old_ts1 / divider)) >>> 0);
        var dur_off1 = ts_off1 + 4;
        var old_dur1 = u64(buf, dur_off1);
        w64(buf, dur_off1, Math.floor(old_dur1 / divider));
      }
      patched++;
      offset = idx + 4;
    }
    return patched;
  }

  function listBoxes(data, start, end) {
    var out = [], pos = start;
    while (pos + 8 <= end) {
      var sz = u32(data, pos);
      if (sz < 8 || pos + sz > end) break;
      out.push({ type: fourcc(data, pos + 4), offset: pos, size: sz, end: pos + sz });
      pos += sz;
    }
    return out;
  }
  function findBox(data, type, start, end) {
    var boxes = listBoxes(data, start, end == null ? data.length : end);
    for (var i = 0; i < boxes.length; i++) if (boxes[i].type === type) return boxes[i];
    return null;
  }

  /** Detect FPS from video track stts + mdhd (closest to 60 or 120). */
  function detectFps(data) {
    var moov = findBox(data, 'moov', 0, data.length);
    if (!moov) return 0;
    var traks = listBoxes(data, moov.offset + 8, moov.end).filter(function (b) { return b.type === 'trak'; });
    for (var t = 0; t < traks.length; t++) {
      var trak = traks[t];
      var mdia = findBox(data, 'mdia', trak.offset + 8, trak.end);
      if (!mdia) continue;
      var hdlr = findBox(data, 'hdlr', mdia.offset + 8, mdia.end);
      if (!hdlr) continue;
      if (fourcc(data, hdlr.offset + 16) !== 'vide') continue;
      var mdhd = findBox(data, 'mdhd', mdia.offset + 8, mdia.end);
      var minf = findBox(data, 'minf', mdia.offset + 8, mdia.end);
      if (!mdhd || !minf) continue;
      var stbl = findBox(data, 'stbl', minf.offset + 8, minf.end);
      if (!stbl) continue;
      var stts = findBox(data, 'stts', stbl.offset + 8, stbl.end);
      if (!stts) continue;

      var ver = data[mdhd.offset + 8];
      var timescale = ver === 1 ? u32(data, mdhd.offset + 28) : u32(data, mdhd.offset + 20);
      if (!timescale) continue;

      var entryCount = u32(data, stts.offset + 12);
      if (entryCount < 1) continue;
      // use first entry delta
      var sampleDelta = u32(data, stts.offset + 20);
      if (!sampleDelta) continue;
      var fps = timescale / sampleDelta;
      return fps;
    }
    return 0;
  }

  function snapFps(fps) {
    if (!fps || fps <= 0) return 0;
    if (Math.abs(fps - 120) < 3) return 120;
    if (Math.abs(fps - 60) < 3) return 60;
    // also accept near values
    if (fps >= 110) return 120;
    if (fps >= 55 && fps <= 65) return 60;
    return Math.round(fps);
  }

  /**
   * Studio Method 120 (   * Returns Uint8Array. Throws if FPS not 60/120.
   */
  function patchStudioMethod120(input) {
    var buf = new Uint8Array(input);
    var out = new Uint8Array(buf);

    var rawFps = detectFps(out);
    var fps = snapFps(rawFps);
    if (fps !== 60 && fps !== 120) {
      throw new Error('Unsupported FPS: ' + (rawFps ? rawFps.toFixed(2) : 'unknown') + '. Need fixed 60 or 120 FPS source.');
    }
    var divider = (fps === 120) ? 4 : 2;

    var mv = patch_mvhd(out, divider);
    var md = patch_mdhd(out, divider);
    if (mv === 0 && md === 0) throw new Error('No mvhd or mdhd boxes found');

    out.__fpsInfo = { fps: fps, rawFps: rawFps, divider: divider, mvhd: mv, mdhd: md };
    return out;
  }

  function studioMethodName(name) {
    name = name || 'video.mp4';
    if (/_patched\.mp4$/i.test(name) || /_studiomethod-120fps\./i.test(name)) return name.replace(/\.[a-z0-9]+$/i, '_patched.mp4');
    return name.replace(/(\.[a-z0-9]+)$/i, '_patched.mp4');
  }

  /** Instant Quality uses site LeVass (levass.js) — do not override if already set */
  function patchInstantQualityFallback(input) {
    if (typeof global.levassProcess === "function") return global.levassProcess(input);
    throw new Error("LeVass (levass.js) not loaded");
  }

  function instantName(name) {
    name = name || "video.mp4";
    return name.replace(/(\.[a-z0-9]+)?$/i, "_vasayyL.mp4");
  }

  global.patchStudioMethod120 = patchStudioMethod120;
  global.studioMethodName = studioMethodName;
  if (typeof global.patchInstantQuality !== "function") {
    global.patchInstantQuality = patchInstantQualityFallback;
  }
  if (typeof global.instantName !== "function") {
    global.instantName = instantName;
  }
  global.detectFps = function (input) { return snapFps(detectFps(new Uint8Array(input))); };
})(typeof window !== 'undefined' ? window : self);
























'use strict';



var sp = typeof skyrimPlatform !== 'undefined' ? skyrimPlatform : null;
var fs = null;
try { fs = require('fs'); } catch (e) { fs = null; }

var LOG = 'rp-portrait';
function log(msg) {
  try { sp.writeLogs(LOG, msg); } catch (e) {  }
}


var OUT_DIR = './Data/Platform/UI/portraits';
var SHOT_NAME = 'rp_portrait_tmp';
var OUT_PX = 512;
var FIRST_CAPTURE_DELAY_S = 12;
var HOTKEY_DXSCANCODE = 0x58;




var SHOT_DIRS = ['.', './Data', './Screenshots'];



function sanitizePortraitName(name) {
  return String(name || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 64);
}





function readU32(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24); }
function readU16(b, o) { return b[o] | (b[o + 1] << 8); }

function decodeBmp(buf) {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) return null;
  var dataOff = readU32(buf, 10);
  var w = readU32(buf, 18);
  var h = readU32(buf, 22);
  var bpp = readU16(buf, 28);
  var compression = readU32(buf, 30);
  if (compression !== 0) return null;
  if (bpp !== 24 && bpp !== 32) return null;
  var flip = h > 0;
  h = Math.abs(h);
  return { buf: buf, dataOff: dataOff, w: w, h: h, bpp: bpp, flip: flip };
}





function cropSquare(img, outPx) {
  var side = Math.min(img.w, img.h);



  var srcX = ((img.w - side) / 2) | 0;
  var srcY = ((img.h - side) / 2) | 0;
  srcY = Math.max(0, srcY - ((side * 0.18) | 0));

  var px = img.bpp / 8;
  var rowSize = ((img.bpp * img.w + 31) >> 5) << 2;
  var outRow = ((24 * outPx + 31) >> 5) << 2;
  var out = Buffer.alloc(54 + outRow * outPx, 0);


  out[0] = 0x42; out[1] = 0x4d;
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(outPx, 18);
  out.writeInt32LE(outPx, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(outRow * outPx, 34);

  for (var y = 0; y < outPx; y++) {
    var sy = srcY + ((y * side / outPx) | 0);

    var srcRowIdx = img.flip ? (img.h - 1 - sy) : sy;
    var sBase = img.dataOff + srcRowIdx * rowSize;
    var dBase = 54 + (outPx - 1 - y) * outRow;
    for (var x = 0; x < outPx; x++) {
      var sx = srcX + ((x * side / outPx) | 0);
      var s = sBase + sx * px;
      var d = dBase + x * 3;
      out[d] = img.buf[s];
      out[d + 1] = img.buf[s + 1];
      out[d + 2] = img.buf[s + 2];
    }
  }
  return out;
}

function newestShot() {
  var best = null;
  for (var i = 0; i < SHOT_DIRS.length; i++) {
    var dir = SHOT_DIRS[i];
    var names;
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (var j = 0; j < names.length; j++) {
      if (names[j].toLowerCase().indexOf(SHOT_NAME.toLowerCase()) !== 0) continue;
      var p = dir + '/' + names[j];
      try {
        var st = fs.statSync(p);
        if (!best || st.mtimeMs > best.mtime) best = { path: p, mtime: st.mtimeMs };
      } catch (e) {  }
    }
  }
  return best ? best.path : null;
}

function ensureOutDir() {
  try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch (e) {  }
}


var capturing = false;

function capture(reason) {
  if (capturing || !sp || !fs) return;
  capturing = true;
  try {
    var player = sp.Game.getPlayer();
    if (!player) { capturing = false; return; }
    var base = player.getBaseObject();
    var name = base ? base.getName() : '';
    var key = sanitizePortraitName(name);
    if (!key) { log('no usable character name; skipping'); capturing = false; return; }









    var restored = false;
    var restore = function () {
      if (restored) return;
      restored = true;
      try { sp.Debug.toggleMenus(); } catch (e) {  }
    };

    sp.Debug.toggleMenus();
    try {
      sp.Debug.takeScreenshot(SHOT_NAME);
    } catch (e) {
      log('takeScreenshot threw: ' + e);
      restore();
      capturing = false;
      return;
    }

    var waited;
    try {
      waited = sp.Utility.wait(0.6);
    } catch (e) {

      log('wait() threw: ' + e);
      restore();
      capturing = false;
      return;
    }

    waited.then(function () {
      restore();
      try {
        var shot = newestShot();
        if (!shot) { log('capture(' + reason + '): no screenshot found - is bAllowScreenShot=1?'); return; }
        var img = decodeBmp(fs.readFileSync(shot));
        if (!img) { log('capture(' + reason + '): unsupported BMP shape, refusing to guess'); return; }
        ensureOutDir();
        fs.writeFileSync(OUT_DIR + '/' + key + '.bmp', cropSquare(img, OUT_PX));
        try { fs.unlinkSync(shot); } catch (e) {  }
        log('capture(' + reason + '): wrote ' + key + '.bmp from ' + img.w + 'x' + img.h);
      } catch (e) {
        log('capture(' + reason + ') failed: ' + e);
      } finally {
        capturing = false;
      }
    });
  } catch (e) {
    log('capture(' + reason + ') threw: ' + e);
    capturing = false;
  }
}


















function screenshotsEnabled() {
  var candidates = [
    (typeof process !== 'undefined' && process.env && process.env.USERPROFILE
      ? process.env.USERPROFILE + '/Documents/My Games/Skyrim Special Edition/SkyrimPrefs.ini'
      : null),
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (!candidates[i]) continue;
    try {
      var txt = fs.readFileSync(candidates[i], 'utf8');
      var m = /^\s*bAllowScreenShot\s*=\s*([01])/im.exec(txt);
      if (m) return m[1] === '1';
    } catch (e) {  }
  }
  return false;
}






if (!sp || !fs) {
  log('inactive: skyrimPlatform or fs unavailable');
} else if (!screenshotsEnabled()) {
  log('inactive: bAllowScreenShot is not 1 in SkyrimPrefs.ini - ' +
      'TakeScreenshot would CTD, so nothing is armed.');
} else {
  log('armed: press F12 to capture a portrait');
  sp.on('buttonEvent', function (e) {
    try {
      if (e && e.isUp && e.code === HOTKEY_DXSCANCODE) capture('hotkey');
    } catch (err) {  }
  });
}

/* Genogram Maker - drawing engine (pure functions, no DOM). */
(function (G) {
'use strict';
var H = 18, INK = '#234e8c', REL = '#8e3a8a', ACC = '#ff7a00';
var FILLS = ['#ffffff', '#e6c8ff', '#bfeeff', '#ffd9ee', '#c8f7c0', '#ffd2a0'];
var FILL_NAMES = ['ไม่มีสี', 'ม่วง', 'ฟ้า', 'ชมพู', 'เขียว', 'ส้ม'];
var FONT = "Sarabun,'Noto Sans Thai',Tahoma,sans-serif";
var RELS = { close: 'สนิทกัน', vclose: 'สนิทกันมากเป็นพิเศษ', conflict: 'ทะเลาะหรือขัดแย้ง', distant: 'ห่างเหินกัน', control: 'ควบคุมหรือมีอำนาจเหนือกว่า (ลูกศรชี้ไปคนที่ 2)', violence: 'ใช้ความรุนแรง (ลูกศรชี้ไปคนที่ 2)', lovehate: 'ทั้งรักทั้งเกลียด' };
var UT = { married: 'แต่งงาน', cohab: 'อยู่ด้วยกัน', divorced: 'หย่าร้างหรือแยกกันอยู่' };
var STS = { '': 'ปกติ', pt: 'ผู้ป่วย / บุคคลหลักของผัง', pg: 'กำลังตั้งครรภ์', sa: 'แท้งเอง', ab: 'ทำแท้ง' };
var SEX = { M: 'ชาย', F: 'หญิง', U: 'ไม่ทราบเพศ' };
var ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/* health conditions: each has a code, colour and a fill pattern (patterns keep B/W prints readable) */
var COND_PRESETS = [
  { k: 'dm', t: 'DM', n: 'เบาหวาน', pat: 'diag', col: '#d9534f' },
  { k: 'ht', t: 'HT', n: 'ความดันโลหิตสูง', pat: 'dots', col: '#2f7fc1' },
  { k: 'cvd', t: 'CVD', n: 'โรคหัวใจ / หลอดเลือดสมอง', pat: 'solid', col: '#5b2a86' },
  { k: 'ca', t: 'CA', n: 'มะเร็ง', pat: 'cross', col: '#222222' },
  { k: 'ckd', t: 'CKD', n: 'ไตวายเรื้อรัง', pat: 'horiz', col: '#2e9e6b' },
  { k: 'copd', t: 'COPD', n: 'ปอดอุดกั้น / หืด', pat: 'vert', col: '#d98b00' },
  { k: 'mh', t: 'MH', n: 'จิตเวช / ซึมเศร้า', pat: 'check', col: '#c2418c' },
  { k: 'alc', t: 'ALC', n: 'ดื่มสุราเป็นประจำ', pat: 'back', col: '#8a5a3c', risk: 1 },
  { k: 'smk', t: 'SMK', n: 'สูบบุหรี่', pat: 'dash', col: '#555555', risk: 1 },
  { k: 'dis', t: 'DIS', n: 'พิการ / ติดเตียง', pat: 'ring', col: '#0a7f8f' }
];
var CUSTOM = [{ t: 'อื่น1', n: 'อื่นๆ (ตั้งชื่อเอง 1)', pat: 'diag', col: '#0a8f4f' }, { t: 'อื่น2', n: 'อื่นๆ (ตั้งชื่อเอง 2)', pat: 'dots', col: '#b0602a' }];

var KEYFILL = '#ffe27a';
var LEGEND_TITLE = 'สัญลักษณ์มาตรฐานสากลในการวาดแผนภูมิครอบครัว';
/* kinds of text lines under a person; typed colours follow the zone-7 report (blue job, red disease, brown risk, green cause of death) */
var TEXT_KINDS = [
  { k: 'name', n: 'ชื่อ / ตัวย่อ', c: '#234e8c' }, { k: 'age', n: 'อายุ', c: '#4a5d80' }, { k: 'edu', n: 'ระดับการศึกษา', c: '#4a5d80' },
  { k: 'occ', n: 'อาชีพ', c: '#2447d6' }, { k: 'role', n: 'บทบาทในชุมชน', c: '#0f766e' }, { k: 'mig', n: 'ย้ายถิ่น / ที่อยู่ปัจจุบัน', c: '#7c3aed' },
  { k: 'cond', n: 'โรค', c: '#e11d1d' }, { k: 'risk', n: 'พฤติกรรมเสี่ยง', c: '#8b5a2b' }, { k: 'cod', n: 'สาเหตุการเสียชีวิต', c: '#1f8a3a' }, { k: 'note', n: 'หมายเหตุ', c: '#4a5d80' }
];
function textColor(kind, o, p) {
  if (p && p.lc) return p.lc;
  var d = '#4a5d80'; TEXT_KINDS.forEach(function (t) { if (t.k === kind) d = t.c; });
  if (o && o.typed) return (o.tcol && o.tcol[kind]) || d;
  return kind === 'name' ? INK : '#4a5d80';
}
function condMapFor(fam) {
  var m = {}; COND_PRESETS.forEach(function (c) { m[c.k] = c; });
  var cx = (fam && fam.cx) || {};
  ['x1', 'x2'].forEach(function (k, i) {
    var b = CUSTOM[i], o = cx[k] || {};
    m[k] = { k: k, t: (o.t || b.t), n: (o.n || b.n), pat: b.pat, col: b.col, custom: true };
  });
  return m;
}

function $esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function ixOf(st) { var m = {}; st.persons.forEach(function (p) { m[p.id] = p; }); return m; }
function isSmall(p) { return p.st === 'sa' || p.st === 'ab'; }
function half(p) { return p.sex === 'U' && !isSmall(p) && p.st !== 'pg' ? 22 : H; }
function top(p) { return isSmall(p) ? p.y - 26 : p.y - half(p); }
function bot(p) { return isSmall(p) ? p.y + 11 : (p.st === 'pg' ? p.y + H * 0.8 : p.y + half(p)); }
function sid(id) { return String(id).replace(/[^A-Za-z0-9_-]/g, '_'); }

/* ---------- text ---------- */
var PREFIX = /^(นางสาว|น\.ส\.|นาย|นาง|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|พ่อ|แม่|พี่|น้อง|ลุง|ป้า|น้า|อา|ปู่|ย่า|ตา|ยาย|ครู|หมอ|อ\.|คุณ)\s*/;
function autoAlias(name) {
  var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.map(function (w, i) {
    var x = i === 0 ? w.replace(PREFIX, '') : w;
    x = x.replace(/^[?\s]+/, '').replace(/^[เแโใไ]+/, '');
    var ch = Array.from(x)[0];
    if (!ch) { ch = Array.from(w)[0]; }
    return ch ? ch + '.' : '';
  }).join('');
}
function dispName(p, o) {
  if (o && o.alias) { var a = String(p.alias || '').trim(); return a || (p.name ? autoAlias(p.name) : ''); }
  return p.name || '';
}
function ageText(p, o) {
  var a = String(p.age == null ? '' : p.age).trim(), n = null;
  if (a && /^\d+$/.test(a)) n = +a;
  else if (a) return a;
  else if (p.byr && !p.dead && o && o.refYear) n = o.refYear - (+p.byr);
  if (n == null || isNaN(n) || n < 0 || n > 130) return '';
  return p.dead ? 'ตายอายุ ' + n + ' ปี' : n + ' ปี';
}
function condsOf(p, o) { return (p.cond || []).filter(function (k) { return o && o.cm && o.cm[k]; }); }
function textLines(p, o) {
  var out = [], nm = dispName(p, o), cs = condsOf(p, o), cm = (o && o.cm) || {};
  String(nm).split(/\s+/).filter(Boolean).forEach(function (t) { out.push([t, 'name']); });
  var ag = ageText(p, o); if (ag) out.push([ag, 'age']);
  if (p.edu) out.push([p.edu, 'edu']);
  if (p.occ) out.push([p.occ, 'occ']);
  if (p.role) out.push([p.role, 'role']);
  if (p.mig) out.push([p.mig, 'mig']);
  if (cs.length && (!o || o.condText !== false)) {
    var dis = cs.filter(function (k) { return !cm[k].risk; }), rk = cs.filter(function (k) { return cm[k].risk; });
    if (dis.length) out.push([dis.map(function (k) { return cm[k].t; }).join(' · '), 'cond']);
    if (rk.length) out.push([rk.map(function (k) { return cm[k].t; }).join(' · '), 'risk']);
  }
  if (p.risk) out.push([p.risk, 'risk']);
  if (p.dead && p.cod) out.push(['สาเหตุ ' + p.cod, 'cod']);
  if (p.note && (!o || o.showNote !== false)) String(p.note).split('\n').forEach(function (t) { if (t.trim()) out.push([t.trim(), 'note']); });
  return out;
}

/* ---------- patterns / shapes ---------- */
function patDef(id, c) {
  var col = c.col, w = 6, h = 6, bg = '', tf = '', body = '';
  function ln(x1, y1, x2, y2, sw) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + col + '" stroke-width="' + (sw || 2.4) + '"/>'; }
  switch (c.pat) {
    case 'solid': body = '<rect width="6" height="6" fill="' + col + '"/>'; break;
    case 'diag': body = bg + ln(0, 0, 0, 6, 2.6); tf = 'rotate(45)'; break;
    case 'back': body = bg + ln(0, 0, 0, 6, 2.6); tf = 'rotate(-45)'; break;
    case 'cross': body = bg + ln(0, 0, 0, 6, 1.8) + ln(0, 0, 6, 0, 1.8); tf = 'rotate(45)'; break;
    case 'dots': body = bg + '<circle cx="3" cy="3" r="1.7" fill="' + col + '"/>'; break;
    case 'horiz': body = bg + ln(0, 3, 6, 3, 2.4); break;
    case 'vert': body = bg + ln(3, 0, 3, 6, 2.4); break;
    case 'check': body = bg + '<rect width="3" height="3" fill="' + col + '"/><rect x="3" y="3" width="3" height="3" fill="' + col + '"/>'; break;
    case 'dash': w = 8; body = ln(0, 3, 5, 3, 2.2); break;
    case 'ring': body = bg + '<circle cx="3" cy="3" r="2" fill="none" stroke="' + col + '" stroke-width="1.3"/>'; break;
    default: body = '';
  }
  return '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="' + w + '" height="' + h + '"' + (tf ? ' patternTransform="' + tf + '"' : '') + '>' + body + '</pattern>';
}
function L(x1, y1, x2, y2, c, w, extra) {
  return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + (c || INK) + '" stroke-width="' + (w || 1.7) + '" stroke-linecap="round"' + (extra || '') + '/>';
}
function geomEl(p, attrs) {
  var x = p.x, y = p.y, h = half(p);
  if (p.st === 'pg') return '<polygon points="' + x + ',' + (y - H) + ' ' + (x - H) + ',' + (y + H * 0.8) + ' ' + (x + H) + ',' + (y + H * 0.8) + '" ' + attrs + '/>';
  if (p.sex === 'M') return '<rect x="' + (x - h) + '" y="' + (y - h) + '" width="' + 2 * h + '" height="' + 2 * h + '" ' + attrs + '/>';
  if (p.sex === 'F') return '<circle cx="' + x + '" cy="' + y + '" r="' + h + '" ' + attrs + '/>';
  return '<polygon points="' + x + ',' + (y - h) + ' ' + (x + h) + ',' + y + ' ' + x + ',' + (y + h) + ' ' + (x - h) + ',' + y + '" ' + attrs + '/>';
}
function shape(p, o) {
  var x = p.x, y = p.y, f = p.key ? KEYFILL : FILLS[p.c || 0], s = '', st = p.st || '', pre = (o && o.pre) || '';
  if (st === 'sa') return L(x, y - 26, x, y - 10) + '<circle cx="' + x + '" cy="' + y + '" r="11" fill="' + INK + '" stroke="' + INK + '" stroke-width="1.8"/>';
  if (st === 'ab') return L(x, y - 26, x, y - 11) + '<circle cx="' + x + '" cy="' + y + '" r="11" fill="#fff" stroke="' + INK + '" stroke-width="1.8"/>' + L(x - 11, y, x + 11, y, INK, 1.8) + L(x, y - 11, x, y + 11, INK, 1.8);
  var h = half(p), stroke = 'stroke="' + INK + '" stroke-width="1.8" stroke-linejoin="round"';
  s = geomEl(p, 'fill="' + f + '" ' + stroke);
  var cs = condsOf(p, o);
  if (cs.length) {
    var n = Math.min(3, cs.length), w = 2 * (st === 'pg' ? H : h), x0 = x - w / 2, t0 = top(p), hh = bot(p) - t0, cid = pre + 'cl_' + sid(p.id);
    for (var i = 0; i < n; i++) s += '<rect x="' + (x0 + i * w / n) + '" y="' + t0 + '" width="' + (w / n) + '" height="' + hh + '" fill="url(#' + pre + 'pt_' + cs[i] + ')" clip-path="url(#' + cid + ')"/>';
    for (i = 1; i < n; i++) s += '<line x1="' + (x0 + i * w / n) + '" y1="' + t0 + '" x2="' + (x0 + i * w / n) + '" y2="' + (t0 + hh) + '" stroke="' + INK + '" stroke-width="1.1" clip-path="url(#' + cid + ')"/>';
    s += geomEl(p, 'fill="none" ' + stroke);
  }
  function arrow() {
    var ax = x - h - 4, ay = y - h - 4;
    return L(ax - 18, ay - 18, ax, ay, INK, 2) + '<polygon points="' + (ax + 1) + ',' + (ay + 1) + ' ' + (ax - 10) + ',' + (ay - 3) + ' ' + (ax - 3) + ',' + (ay - 10) + '" fill="' + INK + '"/>';
  }
  if (st === 'pt') {
    if (p.sex === 'M') s += '<rect x="' + (x - h + 5) + '" y="' + (y - h + 5) + '" width="' + (2 * h - 10) + '" height="' + (2 * h - 10) + '" fill="none" stroke="' + INK + '" stroke-width="1.4"/>';
    else if (p.sex === 'F') s += '<circle cx="' + x + '" cy="' + y + '" r="' + (h - 5) + '" fill="none" stroke="' + INK + '" stroke-width="1.4"/>';
    else s += '<polygon points="' + x + ',' + (y - h + 6) + ' ' + (x + h - 6) + ',' + y + ' ' + x + ',' + (y + h - 6) + ' ' + (x - h + 6) + ',' + y + '" fill="none" stroke="' + INK + '" stroke-width="1.4"/>';
    if (!(o && o.pstyle === 'double')) s += arrow();
  } else if (p.inf) s += arrow();
  if (p.dead) {
    var q = p.sex === 'M' ? h : (p.sex === 'F' ? h * 0.72 : h * 0.55);
    s += L(x - q, y - q, x + q, y + q, INK, 1.8) + L(x + q, y - q, x - q, y + q, INK, 1.8);
  }
  if (p.adopted) {
    if (o && o.adopt === 'bracket') {
      var a2 = h + 5, t2 = h + 9;
      s += '<path d="M' + (x - a2 + 4) + ' ' + (y - t2) + 'H' + (x - a2 - 3) + 'V' + (y + t2) + 'H' + (x - a2 + 4) + 'M' + (x + a2 - 4) + ' ' + (y - t2) + 'H' + (x + a2 + 3) + 'V' + (y + t2) + 'H' + (x + a2 - 4) + '" fill="none" stroke="' + INK + '" stroke-width="1.7"/>';
    } else {
      s += '<text x="' + (x - h - 3) + '" y="' + (y - h - 3) + '" text-anchor="end" font-size="9.5" fill="#4a5d80" paint-order="stroke" stroke="#fff" stroke-width="2.5" pointer-events="none">บุตรบุญธรรม</text><text x="' + (x - h - 3) + '" y="' + (y - h + 7) + '" text-anchor="end" font-size="8.5" fill="#4a5d80" paint-order="stroke" stroke="#fff" stroke-width="2.5" pointer-events="none">(adopted)</text>';
    }
  }
  return s;
}

/* ---------- geometry ---------- */
function ugeo(u, m) {
  var a = m[u.a], b = u.b ? m[u.b] : null;
  if (!a || (u.b && !b)) return null;
  if (!b) return { a: a, b: null, mx: a.x, ly: bot(a) };
  var ey = Math.max(bot(a), bot(b)) + 22 + (u.dp || 0);
  return { a: a, b: b, mx: (a.x + b.x) / 2, ly: ey, ey: ey };
}
function kidsOf(st, u) { return st.persons.filter(function (p) { return p.from === u.id; }); }
function autoLp(p, st, m) {
  if (p.lp) return p.lp;
  var us = st.unions.filter(function (u) { return u.a === p.id || u.b === p.id; });
  if (us.length === 1 && us[0].b) {
    var o = m[us[0].a === p.id ? us[0].b : us[0].a];
    if (o) return p.x < o.x ? 'l' : 'r';
  }
  if (us.length > 1 && !p.from) return 't';
  return 'b';
}
function label(p, st, m, o) {
  if (p.lh) return '';
  var ls = textLines(p, o); if (!ls.length) return '';
  var sc = p.ls || 1, pos = autoLp(p, st, m), n = ls.length, LH = 15 * sc, x, y0, anc = 'middle', r = '';
  if (pos === 'b') { x = p.x; y0 = bot(p) + 16 * sc; }
  else if (pos === 't') { x = p.x; y0 = top(p) - 7 - (n - 1) * LH; }
  else if (pos === 'l') { x = p.x - half(p) - 7; y0 = p.y + 5 - (n - 1) * LH / 2; anc = 'end'; }
  else { x = p.x + half(p) + 7; y0 = p.y + 5 - (n - 1) * LH / 2; anc = 'start'; }
  var lo = p.lo || [0, 0]; x += lo[0]; y0 += lo[1];
  if (Math.abs(lo[0]) + Math.abs(lo[1]) > 60) r += '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + x + '" y2="' + (y0 - 6) + '" stroke="#9aa7c0" stroke-width="1" stroke-dasharray="2 3" pointer-events="none"/>';
  var ptr = o.nosel ? ' pointer-events="none"' : ' pointer-events="all" data-lid="' + p.id + '" style="cursor:move"';
  ls.forEach(function (t, i) {
    var isN = t[1] === 'name';
    r += '<text' + ptr + ' x="' + x + '" y="' + (y0 + i * LH) + '" text-anchor="' + anc + '" font-size="' + ((isN ? 15 : 12.5) * sc) + '" font-weight="' + (isN ? 600 : 400) + '" fill="' + textColor(t[1], o, p) + '" paint-order="stroke" stroke="#fff" stroke-width="3.5" stroke-linejoin="round">' + $esc(t[0]) + '</text>';
  });
  return r;
}
function textObj(t, selected, o) {
  var sz = t.s || 15, lines = String(t.t == null ? '' : t.t).split('\n'), anc = t.a || 'middle', col = t.c || '#1f2a44', out = '';
  var tx = lines.map(function (l, i) { return '<tspan x="' + t.x + '" dy="' + (i ? 1.25 * sz : 0) + '">' + $esc(l || ' ') + '</tspan>'; }).join('');
  var ptr = o.nosel ? ' pointer-events="none"' : ' pointer-events="all" data-tid="' + t.id + '" style="cursor:move"';
  if (selected && !o.nosel) {
    var w = Math.max.apply(null, lines.map(function (l) { return Array.from(l).length; }).concat([2])) * 0.56 * sz, hh = lines.length * 1.25 * sz, x0 = anc === 'start' ? t.x : anc === 'end' ? t.x - w : t.x - w / 2;
    out += '<rect x="' + (x0 - 5) + '" y="' + (t.y - sz - 2) + '" width="' + (w + 10) + '" height="' + (hh + 6) + '" rx="5" fill="none" stroke="' + ACC + '" stroke-width="1.8" stroke-dasharray="5 3" pointer-events="none"/>';
  }
  return out + '<text' + ptr + ' x="' + t.x + '" y="' + t.y + '" text-anchor="' + anc + '" font-size="' + sz + '" font-weight="' + (t.b ? 700 : 400) + '" fill="' + col + '" paint-order="stroke" stroke="#fff" stroke-width="' + Math.max(3, sz * 0.2).toFixed(1) + '" stroke-linejoin="round">' + tx + '</text>';
}
function relGeom(r, m) {
  var a = m[r.a], b = m[r.b]; if (!a || !b) return null;
  var dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy), s0 = H + 7;
  if (d < 2 * s0 + 6) return null;
  var bend = r.bend || 0, cx = (a.x + b.x) / 2 - dy / d * bend, cy = (a.y + b.y) / 2 + dx / d * bend;
  function unit(px, py, qx, qy) { var l = Math.sqrt((qx - px) * (qx - px) + (qy - py) * (qy - py)) || 1; return [(qx - px) / l, (qy - py) / l]; }
  var u1 = unit(a.x, a.y, cx, cy), u2 = unit(b.x, b.y, cx, cy);
  var p0 = [a.x + u1[0] * s0, a.y + u1[1] * s0], p2 = [b.x + u2[0] * s0, b.y + u2[1] * s0];
  function B(t) { var k = 1 - t; return [k * k * p0[0] + 2 * k * t * cx + t * t * p2[0], k * k * p0[1] + 2 * k * t * cy + t * t * p2[1]]; }
  function T(t) { var k = 1 - t, x = 2 * k * (cx - p0[0]) + 2 * t * (p2[0] - cx), y = 2 * k * (cy - p0[1]) + 2 * t * (p2[1] - cy), l = Math.sqrt(x * x + y * y) || 1; return [x / l, y / l]; }
  var len = 0, pv = B(0);
  for (var i = 1; i <= 24; i++) { var q = B(i / 24); len += Math.sqrt((q[0] - pv[0]) * (q[0] - pv[0]) + (q[1] - pv[1]) * (q[1] - pv[1])); pv = q; }
  return { B: B, T: T, len: len, curved: !!bend, mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], nrm: [-dy / d, dx / d] };
}
function relSvg(r, m, selected, o) {
  var g = relGeom(r, m); if (!g) return '';
  function P(t, off) { var p = g.B(t), tt = g.T(t); return [p[0] - tt[1] * off, p[1] + tt[0] * off]; }
  function pl(off) {
    var N = g.curved ? Math.max(6, Math.round(g.len / 8)) : 1, s = '';
    for (var i = 0; i <= N; i++) { var q = P(i / N, off); s += (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }
    return s;
  }
  function zig(amp) {
    var N = Math.max(4, Math.round(g.len / 6)); if (N % 2) N++;
    var s = '';
    for (var i = 0; i <= N; i++) { var q = P(i / N, (i === 0 || i === N) ? 0 : (i % 2 ? amp : -amp)); s += (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }
    return s;
  }
  var pth = '', arrow = '', dash = '', t = r.t, W = 2;
  if (t === 'close') pth = pl(-2.8) + pl(2.8);
  else if (t === 'vclose') pth = pl(-5) + pl(0) + pl(5);
  else if (t === 'conflict') pth = zig(6);
  else if (t === 'distant') { pth = pl(0); dash = ' stroke-dasharray="1 6"'; W = 2.4; }
  else if (t === 'control') pth = pl(0);
  else if (t === 'violence') pth = zig(6);
  else if (t === 'lovehate') pth = pl(-6.5) + pl(6.5) + zig(4);
  if (t === 'control' || t === 'violence') {
    var e = P(1, 0), u = g.T(1), nx = -u[1], ny = u[0];
    arrow = '<polygon points="' + e[0] + ',' + e[1] + ' ' + (e[0] - u[0] * 15 + nx * 6.5) + ',' + (e[1] - u[1] * 15 + ny * 6.5) + ' ' + (e[0] - u[0] * 15 - nx * 6.5) + ',' + (e[1] - u[1] * 15 - ny * 6.5) + '" fill="' + REL + '"/>';
  }
  var center = pl(0), out = '';
  if (selected) out += '<path d="' + center + '" fill="none" stroke="' + ACC + '" stroke-opacity=".35" stroke-width="12" stroke-linecap="round"/>';
  out += '<path d="' + pth + '" fill="none" stroke="' + REL + '" stroke-width="' + W + '" stroke-linecap="round" stroke-linejoin="round"' + dash + '/>' + arrow;
  if (!(o && o.nosel)) out += '<path data-rid="' + r.id + '" d="' + center + '" fill="none" stroke="#000" stroke-opacity="0" stroke-width="16" pointer-events="stroke" style="cursor:pointer"/>';
  if (selected && !(o && o.nosel)) { var hp = g.B(0.5); out += '<circle data-bh="' + r.id + '" cx="' + hp[0].toFixed(1) + '" cy="' + hp[1].toFixed(1) + '" r="8" fill="#fff" stroke="' + ACC + '" stroke-width="2.4" style="cursor:grab"/>'; }
  return out;
}
function autoBend(A, B, st) {
  var others = st.persons.filter(function (p) { return p.id !== A.id && p.id !== B.id; }), cand = [0, 60, -60, 110, -110, 170, -170, 240, -240], best = 0, bestD = -1;
  var dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
  for (var ci = 0; ci < cand.length; ci++) {
    var bend = cand[ci], cx = (A.x + B.x) / 2 - dy / d * bend, cy = (A.y + B.y) / 2 + dx / d * bend, md = 1e9;
    for (var i = 2; i <= 22; i++) {
      var t = i / 24, k = 1 - t, x = k * k * A.x + 2 * k * t * cx + t * t * B.x, y = k * k * A.y + 2 * k * t * cy + t * t * B.y;
      others.forEach(function (p) { var q = Math.sqrt((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)); if (q < md) md = q; });
    }
    if (md >= H + 16) return bend;
    if (md > bestD) { bestD = md; best = bend; }
  }
  return best;
}

/* ---------- generations ---------- */
function gens(st) {
  var m = ixOf(st), g = {}, uById = {}, guard = 0;
  st.unions.forEach(function (u) { uById[u.id] = u; });
  function unresolved() { return st.persons.filter(function (p) { return g[p.id] == null; }); }
  while (unresolved().length && guard++ < 1000) {
    var changed = true, it = 0;
    while (changed && it++ < 300) {
      changed = false;
      st.persons.forEach(function (p) {
        if (!p.from) return;
        var u = uById[p.from]; if (!u) return;
        var pg = [u.a, u.b].filter(Boolean).map(function (i) { return g[i]; }).filter(function (v) { return v != null; });
        if (pg.length) { var v = Math.max.apply(null, pg) + 1; if (g[p.id] !== v) { g[p.id] = v; changed = true; } }
      });
      st.unions.forEach(function (u) {
        if (!u.b) return; var a = m[u.a], b = m[u.b]; if (!a || !b) return;
        if (g[a.id] != null && g[b.id] == null && !b.from) { g[b.id] = g[a.id]; changed = true; }
        else if (g[b.id] != null && g[a.id] == null && !a.from) { g[a.id] = g[b.id]; changed = true; }
      });
    }
    var un = unresolved(); if (!un.length) break;
    var s = un.filter(function (p) { return !p.from; })[0] || un[0]; g[s.id] = 0;
  }
  var mn = 1e9; for (var k in g) mn = Math.min(mn, g[k]);
  if (mn !== 1e9) for (k in g) g[k] -= mn;
  return g;
}
function genLabels(st, o) {
  var g = gens(st), rows = {}, minX = 1e9, out = '';
  st.persons.forEach(function (p) { minX = Math.min(minX, p.x); var v = g[p.id]; if (v == null) return; (rows[v] = rows[v] || []).push(p.y); });
  Object.keys(rows).forEach(function (k) {
    var ys = rows[k], y = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;
    out += '<text x="' + (minX - 100) + '" y="' + (y + 6) + '" text-anchor="middle" font-size="19" font-weight="600" fill="#7a8bab" pointer-events="none">' + (ROMAN[+k] || (+k + 1)) + '</text>';
  });
  return out;
}

/* ---------- main render ---------- */
function inner(st, o) {
  o = o || {};
  var pre = o.pre || '', m = ixOf(st), back = [], lines = [], rels = [], pers = [], labs = [], hit = [], defs = '';
  var sel_ = o.sel || null, md = o.mode || null, ms = o.msel || {};
  var usedC = {};
  st.persons.forEach(function (p) { if (isSmall(p)) return; var cs = condsOf(p, o); if (!cs.length) return; cs.forEach(function (k) { usedC[k] = 1; }); defs += '<clipPath id="' + pre + 'cl_' + sid(p.id) + '">' + geomEl(p, '') + '</clipPath>'; });
  Object.keys(usedC).forEach(function (k) { defs += patDef(pre + 'pt_' + k, o.cm[k]); });

  st.homes.forEach(function (h) {
    var ps = h.ids.map(function (i) { return m[i]; }).filter(Boolean); if (!ps.length) return;
    var x0 = Math.min.apply(null, ps.map(function (p) { return p.x; })), x1 = Math.max.apply(null, ps.map(function (p) { return p.x; }));
    var y0 = Math.min.apply(null, ps.map(function (p) { return p.y; })), y1 = Math.max.apply(null, ps.map(function (p) { return p.y; }));
    var rx = ((x1 - x0) / 2 + H) * 1.42 + 12, ry = ((y1 - y0) / 2 + H) * 1.42 + 12, hc = o.hhc || INK;
    var on = sel_ && sel_.k === 'h' && sel_.id === h.id, hp = o.nosel ? '' : ' data-hid="' + h.id + '" pointer-events="stroke" style="cursor:pointer"';
    if (o.hhs === 'round') { var pd = H * 1.9; back.push('<rect x="' + (x0 - pd) + '" y="' + (y0 - pd) + '" width="' + (x1 - x0 + 2 * pd) + '" height="' + (y1 - y0 + 2 * pd) + '" rx="24" fill="none" stroke="' + (on ? ACC : hc) + '" stroke-width="' + (on ? 3 : 1.8) + '"' + hp + '/>'); }
    else back.push('<ellipse cx="' + (x0 + x1) / 2 + '" cy="' + (y0 + y1) / 2 + '" rx="' + rx + '" ry="' + ry + '" fill="none" stroke="' + (on ? ACC : hc) + '" stroke-width="' + (on ? 3 : 1.5) + '"' + hp + '/>');
  });

  st.unions.forEach(function (u) {
    var g = ugeo(u, m); if (!g) return;
    var on = sel_ && sel_.k === 'u' && sel_.id === u.id;
    if (g.b) {
      var Lp = g.a.x < g.b.x ? g.a : g.b, Rp = g.a.x < g.b.x ? g.b : g.a;
      var full = 'M' + Lp.x + ' ' + bot(Lp) + 'V' + g.ey + 'H' + Rp.x + 'V' + bot(Rp);
      if (on) back.push('<path d="' + full + '" fill="none" stroke="' + ACC + '" stroke-opacity=".4" stroke-width="10" stroke-linejoin="round"/>');
      if (u.t === 'cohab') {
        lines.push('<path d="M' + Lp.x + ' ' + bot(Lp) + 'V' + g.ey + 'M' + Rp.x + ' ' + bot(Rp) + 'V' + g.ey + '" fill="none" stroke="' + INK + '" stroke-width="1.7"/>');
        lines.push('<path d="M' + Lp.x + ' ' + g.ey + 'H' + Rp.x + '" fill="none" stroke="' + INK + '" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 5"/>');
      } else {
        lines.push('<path d="' + full + '" fill="none" stroke="' + INK + '" stroke-width="1.7" stroke-linejoin="round"/>');
      }
      if (u.t === 'divorced') {
        var sx = Lp.x + (Rp.x - Lp.x) * 0.3;
        lines.push(L(sx - 8, g.ey + 8, sx, g.ey - 8) + L(sx + 3, g.ey + 8, sx + 11, g.ey - 8));
      }
      if (!o.nosel) hit.push('<path data-uid="' + u.id + '" d="' + full + '" fill="none" stroke="#000" stroke-opacity="0" stroke-width="14" pointer-events="stroke" style="cursor:pointer"/>');
    }
    var ks = kidsOf(st, u);
    if (!ks.length) return;
    var mintop = Math.min.apply(null, ks.map(top));
    var by = u.by != null ? u.by : mintop - 30;
    if (u.by == null && by < g.ly + 14) by = g.ly + (mintop - g.ly) / 2;
    var xs = [g.mx], drawn = {}, bar = '';
    ks.forEach(function (k) {
      if (drawn[k.id]) return;
      var t = k.tw && ks.filter(function (z) { return z.id === k.tw; })[0];
      if (t) {
        drawn[k.id] = drawn[t.id] = 1;
        var ax = (k.x + t.x) / 2; xs.push(ax);
        bar += L(k.x, top(k), ax, by, INK, 1.7) + L(t.x, top(t), ax, by, INK, 1.7);
        if (k.twi) {
          var f = 0.5, ya = by + (top(k) - by) * f, yb = by + (top(t) - by) * f;
          bar += L(ax + (k.x - ax) * f, ya, ax + (t.x - ax) * f, yb, INK, 1.7);
        }
      } else {
        drawn[k.id] = 1; xs.push(k.x);
        bar += L(k.x, by, k.x, top(k), INK, 1.7, k.adopted ? ' stroke-dasharray="5 4"' : '');
      }
    });
    var bx0 = Math.min.apply(null, xs), bx1 = Math.max.apply(null, xs);
    lines.push(L(g.mx, g.ly, g.mx, by) + (bx1 > bx0 ? L(bx0, by, bx1, by) : '') + bar);
    if (!g.b && !o.nosel) hit.push('<line data-uid="' + u.id + '" x1="' + g.mx + '" y1="' + g.ly + '" x2="' + g.mx + '" y2="' + by + '" stroke="#000" stroke-opacity="0" stroke-width="14" pointer-events="stroke" style="cursor:pointer"/>');
    if (on && !g.b) back.push('<line x1="' + g.mx + '" y1="' + g.ly + '" x2="' + g.mx + '" y2="' + by + '" stroke="' + ACC + '" stroke-opacity=".4" stroke-width="10"/>');
  });

  st.rels.forEach(function (r) { rels.push(relSvg(r, m, sel_ && sel_.k === 'r' && sel_.id === r.id, o)); });

  st.persons.forEach(function (p) {
    var on = (sel_ && sel_.k === 'p' && sel_.id === p.id) || ms[p.id] || (md && (md.from === p.id || (md.ids && md.ids.indexOf(p.id) >= 0)));
    var h = half(p) + 10;
    pers.push('<g' + (o.nosel ? '' : ' data-pid="' + p.id + '" style="cursor:' + (md ? 'crosshair' : 'grab') + '"') + '>' + shape(p, o) + (o.nosel ? '' : '<rect x="' + (p.x - h) + '" y="' + (top(p) - 4) + '" width="' + 2 * h + '" height="' + (bot(p) - top(p) + 8) + '" fill="#000" fill-opacity="0"/>') + '</g>');
    if (on && !o.nosel) pers.push('<rect x="' + (p.x - h - 2) + '" y="' + (top(p) - 8) + '" width="' + (2 * h + 4) + '" height="' + (bot(p) - top(p) + 16) + '" rx="8" fill="none" stroke="' + ACC + '" stroke-width="2.2" stroke-dasharray="6 4" pointer-events="none"/>');
    if (!o.nolabels) labs.push(label(p, st, m, o));
  });
  var txs = (st.texts || []).map(function (t) { return textObj(t, sel_ && sel_.k === 't' && sel_.id === t.id, o); });
  return (defs ? '<defs>' + defs + '</defs>' : '') + back.join('') + lines.join('') + hit.join('') + rels.join('') + pers.join('') + (o.gen && !o.nolabels ? genLabels(st, o) : '') + labs.join('') + txs.join('');
}

function bounds(st, o) {
  var T = st.texts || [];
  if (!st.persons.length && !T.length) return { x: 0, y: 0, w: 800, h: 500 };
  var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, lx = (o && o.gen) ? 130 : 80;
  st.persons.forEach(function (p) {
    var lo = p.lo || [0, 0];
    x0 = Math.min(x0, p.x - lx + Math.min(0, lo[0])); x1 = Math.max(x1, p.x + 90 + Math.max(0, lo[0]));
    y0 = Math.min(y0, top(p) - 80 + Math.min(0, lo[1])); y1 = Math.max(y1, bot(p) + 80 + Math.max(0, lo[1]));
  });
  T.forEach(function (t) {
    var sz = t.s || 15, ls = String(t.t || '').split('\n'), w = Math.max.apply(null, ls.map(function (l) { return Array.from(l).length; }).concat([2])) * 0.56 * sz, hh = ls.length * 1.25 * sz;
    var a = t.a || 'middle', tx0 = a === 'start' ? t.x : a === 'end' ? t.x - w : t.x - w / 2;
    x0 = Math.min(x0, tx0 - 20); x1 = Math.max(x1, tx0 + w + 20); y0 = Math.min(y0, t.y - sz - 20); y1 = Math.max(y1, t.y + hh + 20);
  });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* ---------- legend ---------- */
function mp(id, sex, x, y, ex) { var p = { id: id, name: '', sex: sex, x: x, y: y, c: 0 }; for (var k in ex || {}) p[k] = ex[k]; return p; }
var legCtr = 0;
function mini(persons, unions, rels, homes, vb, mo) {
  var st = { persons: persons, unions: unions || [], rels: rels || [], homes: homes || [] }, o = { nolabels: true, nosel: true, pre: 'lg' + (++legCtr) + '_', cm: {} };
  for (var k in mo || {}) o[k] = mo[k];
  return '<svg viewBox="' + vb + '" preserveAspectRatio="xMidYMid meet" width="66" height="44">' + inner(st, o) + '</svg>';
}
function aaSvg(col) { return '<svg viewBox="0 0 60 44" width="66" height="44"><text x="30" y="29" text-anchor="middle" font-size="20" font-weight="600" fill="' + col + '">Aa</text></svg>'; }
/* mode: 'used' = only what the diagram uses; 'standard' = full table of the manual + extras that are used; 'panel' = everything */
function legendItems(st, o, mode) {
  mode = mode === true ? 'panel' : (mode || 'used');
  var cm = o.cm || {}, items = [], std = mode !== 'used', every = mode === 'panel';
  var mo = { cm: cm, adopt: o.adopt, pstyle: o.pstyle, hhs: o.hhs, hhc: o.hhc };
  function has(f) { return std || st.persons.some(f); }
  function hasX(f) { return every || st.persons.some(f); }
  function add(label, svg) { items.push({ label: label, svg: svg }); }
  if (has(function (p) { return p.sex === 'M' && !isSmall(p) && p.st !== 'pg'; })) add('ชาย', mini([mp('a', 'M', 30, 36)], 0, 0, 0, '0 0 60 72', mo));
  if (has(function (p) { return p.sex === 'F' && !isSmall(p) && p.st !== 'pg'; })) add('หญิง', mini([mp('a', 'F', 30, 36)], 0, 0, 0, '0 0 60 72', mo));
  if (has(function (p) { return p.dead; })) add('ตาย', mini([mp('a', 'M', 20, 36, { dead: 1 }), mp('b', 'F', 62, 36, { dead: 1 })], 0, 0, 0, '0 0 82 72', mo));
  if (has(function (p) { return p.st === 'pt'; })) add('ผู้ป่วย', mini([mp('a', 'M', 40, 40, { st: 'pt' }), mp('b', 'F', 92, 40, { st: 'pt' })], 0, 0, 0, '0 0 120 76', mo));
  if (has(function (p) { return p.sex === 'U' && !isSmall(p) && p.st !== 'pg'; })) add('ไม่ทราบเพศ', mini([mp('a', 'U', 30, 36)], 0, 0, 0, '0 0 60 72', mo));
  if (has(function (p) { return p.st === 'sa'; })) add('แท้งเอง', mini([mp('a', 'F', 30, 40, { st: 'sa' })], 0, 0, 0, '0 0 60 72', mo));
  if (has(function (p) { return p.st === 'ab'; })) add('ทำแท้ง', mini([mp('a', 'F', 30, 40, { st: 'ab' })], 0, 0, 0, '0 0 60 72', mo));
  if (has(function (p) { return p.st === 'pg'; })) add('กำลังตั้งครรภ์', mini([mp('a', 'F', 30, 36, { st: 'pg' })], 0, 0, 0, '0 0 60 72', mo));
  if (has(function (p) { return p.tw && p.twi; })) add('แฝดเหมือน', mini([mp('a', 'M', 60, 20), mp('x', 'F', 36, 104, { from: 'u', tw: 'y', twi: 1 }), mp('y', 'F', 84, 104, { from: 'u', tw: 'x', twi: 1 })], [{ id: 'u', a: 'a', b: null, t: 'married' }], 0, 0, '0 0 120 136', mo));
  if (has(function (p) { return p.tw && !p.twi; })) add('แฝดต่าง', mini([mp('a', 'M', 60, 20), mp('x', 'F', 36, 104, { from: 'u', tw: 'y' }), mp('y', 'M', 84, 104, { from: 'u', tw: 'x' })], [{ id: 'u', a: 'a', b: null, t: 'married' }], 0, 0, '0 0 120 136', mo));
  if (has(function (p) { return p.adopted; })) add('ลูกบุญธรรม', mini([mp('a', 'F', 62, 40, { adopted: 1 })], 0, 0, 0, '0 0 110 76', mo));
  function un(t, lab) {
    if (std || st.unions.some(function (u) { return u.b && u.t === t; })) add(lab, mini([mp('a', 'M', 28, 22), mp('b', 'F', 112, 22)], [{ id: 'u', a: 'a', b: 'b', t: t }], 0, 0, '0 0 140 70', mo));
  }
  un('married', 'แต่งงาน'); un('cohab', 'อยู่ด้วยกัน'); un('divorced', 'หย่าร้างหรือแยกกันอยู่');
  if (std || st.homes.length) add('สมาชิกที่อยู่ด้วยกัน', mini([mp('a', 'M', 40, 40), mp('b', 'F', 100, 40)], [{ id: 'u', a: 'a', b: 'b', t: 'married' }], 0, [{ id: 'h', ids: ['a', 'b'] }], '0 0 140 84', mo));
  Object.keys(RELS).forEach(function (k) {
    if (std || st.rels.some(function (r) { return r.t === k; })) add(RELS[k].replace(/ \(.*\)/, ''), mini([mp('a', 'M', 26, 30), mp('b', 'F', 114, 30)], 0, [{ id: 'r', a: 'a', b: 'b', t: k }], 0, '0 0 140 60', mo));
  });
  /* extras that past reports added */
  if (hasX(function (p) { return p.inf; })) add('ผู้ให้ข้อมูล / ผู้ให้สัมภาษณ์', mini([mp('a', 'M', 40, 40, { inf: 1 }), mp('b', 'F', 92, 40, { inf: 1 })], 0, 0, 0, '0 0 120 76', mo));
  if (hasX(function (p) { return p.key; })) add('ผู้ให้ข้อมูลหลัก', mini([mp('a', 'M', 30, 36, { key: 1 }), mp('b', 'F', 82, 36, { key: 1 })], 0, 0, 0, '0 0 110 72', mo));
  if (o.typed) {
    var used = {
      edu: function (p) { return p.edu; }, occ: function (p) { return p.occ; }, role: function (p) { return p.role; }, mig: function (p) { return p.mig; },
      cond: function (p) { return (p.cond || []).some(function (k) { return cm[k] && !cm[k].risk; }); },
      risk: function (p) { return p.risk || (p.cond || []).some(function (k) { return cm[k] && cm[k].risk; }); },
      cod: function (p) { return p.dead && p.cod; }
    };
    TEXT_KINDS.forEach(function (t) { if (used[t.k] && (every || st.persons.some(used[t.k]))) add(t.n, aaSvg(textColor(t.k, o, null))); });
  }
  var usedC = {}; st.persons.forEach(function (p) { (p.cond || []).forEach(function (k) { usedC[k] = 1; }); });
  Object.keys(cm).forEach(function (k) {
    if (!every && !usedC[k]) return;
    var c = cm[k], id = 'lc' + (++legCtr) + '_';
    add(c.t + ' = ' + c.n, '<svg viewBox="0 0 60 44" width="66" height="44"><defs>' + patDef(id + 'p', c) + '</defs><rect x="18" y="8" width="26" height="26" fill="url(#' + id + 'p)" stroke="' + INK + '" stroke-width="1.8"/></svg>');
  });
  return items;
}
function legendHTML(st, o) {
  return '<div class="lg">' + legendItems(st, o, 'panel').map(function (it) { return '<div class="li">' + it.svg + '<span>' + $esc(it.label) + '</span></div>'; }).join('') + '</div>';
}

G.GE = {
  H: H, INK: INK, ACC: ACC, FONT: FONT, FILLS: FILLS, FILL_NAMES: FILL_NAMES, RELS: RELS, UT: UT, STS: STS, SEX: SEX, ROMAN: ROMAN,
  COND_PRESETS: COND_PRESETS, condMapFor: condMapFor, ixOf: ixOf, isSmall: isSmall, half: half, top: top, bot: bot,
  inner: inner, ugeo: ugeo, bounds: bounds, relGeom: relGeom, autoBend: autoBend, gens: gens, genLabels: genLabels, kidsOf: kidsOf,
  autoAlias: autoAlias, TEXT_KINDS: TEXT_KINDS, textColor: textColor, KEYFILL: KEYFILL, LEGEND_TITLE: LEGEND_TITLE, dispName: dispName, ageText: ageText, legendItems: legendItems, legendHTML: legendHTML, esc: $esc
};
})(window);

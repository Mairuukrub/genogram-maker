/* Genogram Maker - drawing engine (pure functions, no DOM). */
(function (G) {
'use strict';
var H = 18, INK = '#234e8c', REL = '#8e3a8a', ACC = '#ff7a00', MONO = false;
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
var UNK = /^\s*(ไม่ทราบ|ไม่ระบุ|ไม่รู้|unknown|\?+\s*$)/i;
function isUnk(s) { return UNK.test(String(s == null ? '' : s)); }
function autoAlias(name) {
  if (isUnk(name)) return 'ไม่ทราบ';
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
  var unkOn = !o || o.unk !== false;
  if (unkOn && isUnk(p.name)) return 'ไม่ทราบ';
  if (o && o.alias) { var a = String(p.alias || '').trim(); if (unkOn && isUnk(a)) return 'ไม่ทราบ'; return a || (p.name ? autoAlias(p.name) : (o.unkBlank ? 'ไม่ทราบ' : '')); }
  return p.name || (o && o.unkBlank ? 'ไม่ทราบ' : '');
}
function ageText(p, o) {
  var a = String(p.age == null ? '' : p.age).trim(), n = null;
  if (a && /^\d+$/.test(a)) n = +a;
  else if (a) return a;
  else if (p.byr && !p.dead && o && o.refYear) n = o.refYear - (+p.byr);
  if (n == null || isNaN(n) || n < 0 || n > 130) return (o && o.unkBlank) ? 'ไม่ทราบอายุ' : '';
  return p.dead ? 'ตายอายุ ' + n + ' ปี' : n + ' ปี';
}
function condsOf(p, o) { return (p.cond || []).filter(function (k) { return o && o.cm && o.cm[k]; }); }
/* patterns are drawn inside the symbol only when the family turns it on, and not for people marked "no fill" */
function fillConds(p, o) { return (o && o.condFill && !p.nofill) ? condsOf(p, o) : []; }
function dzList(p) { return String(p.dz || '').split(/[\n,，;]+/).map(function (t) { return t.trim(); }).filter(Boolean); }
function textLines(p, o) {
  var out = [], nm = dispName(p, o), cs = condsOf(p, o), cm = (o && o.cm) || {};
  String(nm).split(/\s+/).filter(Boolean).forEach(function (t) { out.push([t, 'name']); });
  var ag = ageText(p, o);
  if (ag && nm === 'ไม่ทราบ' && /^ไม่ทราบ(อายุ)?$/.test(ag)) ag = ''; /* name and age both unknown: say it once */
  if (ag) out.push([ag, 'age']);
  if (p.edu) out.push([p.edu, 'edu']);
  if (p.occ) out.push([p.occ, 'occ']);
  if (p.role) out.push([p.role, 'role']);
  if (p.mig) out.push([p.mig, 'mig']);
  if (dzList(p).length && (!o || o.condText !== false)) dzList(p).forEach(function (t) { out.push([t, 'cond']); });
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
  var x = p.x, y = p.y, f = MONO ? (p.key ? '#e6e6e6' : '#fff') : (p.key ? KEYFILL : FILLS[p.c || 0]), s = '', st = p.st || '', pre = (o && o.pre) || '';
  if (st === 'sa') return L(x, y - 26, x, y - 10, INK, 3.4) + '<circle cx="' + x + '" cy="' + y + '" r="11" fill="' + INK + '" stroke="' + INK + '" stroke-width="1.8"/>';
  if (st === 'ab') return L(x, y - 26, x, y - 11, INK, 3.4) + '<circle cx="' + x + '" cy="' + y + '" r="11" fill="#fff" stroke="' + INK + '" stroke-width="1.8"/>' + L(x - 11, y, x + 11, y, INK, 1.8) + L(x, y - 11, x, y + 11, INK, 1.8);
  var h = half(p), stroke = 'stroke="' + INK + '" stroke-width="1.8" stroke-linejoin="round"';
  s = geomEl(p, 'fill="' + f + '" ' + stroke);
  var cs = fillConds(p, o);
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
    var ps = (o && o.pstyle) || 'both'; if (MONO && ps === 'both') ps = 'double';
    if (ps === 'arrow') { /* plain symbol + arrow only */ }
    else if (p.sex === 'M') s += '<rect x="' + (x - h + 5) + '" y="' + (y - h + 5) + '" width="' + (2 * h - 10) + '" height="' + (2 * h - 10) + '" fill="none" stroke="' + INK + '" stroke-width="1.4"/>';
    else if (p.sex === 'F') s += '<circle cx="' + x + '" cy="' + y + '" r="' + (h - 5) + '" fill="none" stroke="' + INK + '" stroke-width="1.4"/>';
    else s += '<polygon points="' + x + ',' + (y - h + 6) + ' ' + (x + h - 6) + ',' + y + ' ' + x + ',' + (y + h - 6) + ' ' + (x - h + 6) + ',' + y + '" fill="none" stroke="' + INK + '" stroke-width="1.4"/>';
    if (ps !== 'double') s += arrow();
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
  function wave(amp, wl) {
    var n = Math.max(2, Math.round(g.len / wl)), N = n * 10, s = '';
    for (var i = 0; i <= N; i++) { var q = P(i / N, amp * Math.sin(2 * Math.PI * n * i / N)); s += (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }
    return s;
  }
  var pth = '', arrow = '', dash = '', t = r.t, W = 2;
  if (t === 'close') { pth = pl(-3.4) + pl(0) + pl(3.4); W = 1.5; }
  else if (t === 'vclose') { pth = pl(-5.1) + pl(-1.7) + pl(1.7) + pl(5.1); W = 1.5; }
  else if (t === 'conflict') { pth = wave(4, 9); W = 1.7; }
  else if (t === 'distant') { pth = pl(0); dash = ' stroke-dasharray="1 6"'; W = 2.4; }
  else if (t === 'control') pth = pl(0);
  else if (t === 'violence') { pth = wave(6, 13); W = 1.8; }
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


/* ---------- automatic label placement: pick below/above/left/right per person so text avoids symbols, lines and other text ---------- */
function strW(t, fs) { var n = 0; Array.from(String(t)).forEach(function (c) { if (!/[ัิ-ฺ็-๎]/.test(c)) n++; }); return n * fs * 0.56; }
function labelRect(p, ls, pos, sc) {
  var n = ls.length, LH = 15 * sc, w = 0, lo = p.lo || [0, 0];
  ls.forEach(function (t) { w = Math.max(w, strW(t[0], (t[1] === 'name' ? 15 : 12.5) * sc)); });
  var x0, y0, hgt = (n - 1) * LH + 18 * sc;
  if (pos === 'b') { x0 = p.x - w / 2; y0 = bot(p) + 16 * sc - 14 * sc; }
  else if (pos === 't') { x0 = p.x - w / 2; y0 = top(p) - 7 - (n - 1) * LH - 14 * sc; }
  else if (pos === 'l') { x0 = p.x - half(p) - 7 - w; y0 = p.y + 5 - (n - 1) * LH / 2 - 14 * sc; }
  else { x0 = p.x + half(p) + 7; y0 = p.y + 5 - (n - 1) * LH / 2 - 14 * sc; }
  return { x0: x0 + lo[0], y0: y0 + lo[1], x1: x0 + w + lo[0], y1: y0 + hgt + lo[1] };
}
function lineSamples(st, m) {
  var pts = [];
  function seg(x1, y1, x2, y2) { var d = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)), n = Math.max(1, Math.ceil(d / 6)); for (var i = 0; i <= n; i++) pts.push([x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]); }
  st.unions.forEach(function (u) {
    var g = ugeo(u, m); if (!g) return;
    if (g.b) { seg(g.a.x, bot(g.a), g.a.x, g.ey); seg(g.b.x, bot(g.b), g.b.x, g.ey); seg(g.a.x, g.ey, g.b.x, g.ey); }
    var ks = kidsOf(st, u); if (!ks.length) return;
    var mintop = Math.min.apply(null, ks.map(top)), by = u.by != null ? u.by : mintop - 30;
    if (u.by == null && by < g.ly + 14) by = g.ly + (mintop - g.ly) / 2;
    var xs = [g.mx]; ks.forEach(function (k) { xs.push(k.x); seg(k.x, by, k.x, top(k)); });
    seg(g.mx, g.ly, g.mx, by); seg(Math.min.apply(null, xs), by, Math.max.apply(null, xs), by);
  });
  st.rels.forEach(function (r) { var g = relGeom(r, m); if (!g) return; for (var i = 0; i <= 14; i++) pts.push(g.B(i / 14)); });
  return pts;
}
function overlapArea(a, b) { var w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0); return w > 0 && h > 0 ? w * h : 0; }
/* axis-aligned family-line segments [x1,y1,x2,y2] (couple lines, child bars, drops) — used to mark lines that continue on another page */
function lineSegs(st) {
  var m = ixOf(st), out = [];
  st.unions.forEach(function (u) {
    var g = ugeo(u, m); if (!g) return;
    if (g.b) { out.push([g.a.x, bot(g.a), g.a.x, g.ey], [g.b.x, bot(g.b), g.b.x, g.ey], [g.a.x, g.ey, g.b.x, g.ey]); }
    var ks = kidsOf(st, u); if (!ks.length) return;
    var mintop = Math.min.apply(null, ks.map(top)), by = u.by != null ? u.by : mintop - 30;
    if (u.by == null && by < g.ly + 14) by = g.ly + (mintop - g.ly) / 2;
    var xs = [g.mx]; ks.forEach(function (k) { xs.push(k.x); out.push([k.x, by, k.x, top(k)]); });
    out.push([g.mx, g.ly, g.mx, by], [Math.min.apply(null, xs), by, Math.max.apply(null, xs), by]);
  });
  return out;
}
/* horizontal extent of every person incl. text: [{id,x0,x1,y0,y1}] — page cuts are placed where nothing straddles */
function personBoxes(st, o) {
  var m = ixOf(st), out = [];
  st.persons.forEach(function (p) {
    var h = half(p) + 3; out.push({ id: p.id, x0: p.x - h, x1: p.x + h, y0: top(p), y1: bot(p) });
    var ls = p.lh ? [] : textLines(p, o);
    if (ls.length) {
      var q0 = {}; for (var k in p) q0[k] = p[k]; delete q0.lp; var pos = p.lo ? autoLp(q0, st, m) : (p.lp || autoLp(q0, st, m));
      var r = labelRect(p, ls, pos, p.ls || 1); if (p.lo) out.push({ id: p.id, x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 }); /* dragged-away label: its own box, so it does not widen the symbol */
      else { var b0 = out[out.length - 1]; b0.x0 = Math.min(b0.x0, r.x0); b0.x1 = Math.max(b0.x1, r.x1); b0.y0 = Math.min(b0.y0, r.y0); b0.y1 = Math.max(b0.y1, r.y1); } /* label sits next to its symbol: keep them on the same page */
    }
  });
  return out;
}
/* returns { personId: 'b'|'t'|'l'|'r'|'' } ('' = automatic default). Labels the user dragged (lo) or hid (lh) are left alone and treated as obstacles. */
function autoLabels(st, o) {
  var m = ixOf(st), pts = lineSamples(st, m), cur = {}, info = {}, order = ['b', 't', 'l', 'r'];
  st.persons.forEach(function (p) {
    var ls = p.lh ? [] : textLines(p, o); if (!ls.length) return;
    var fixed = !!p.lo, sc = p.ls || 1, q0 = {}, def; for (var qk in p) q0[qk] = p[qk]; delete q0.lp; def = autoLp(q0, st, m);
    info[p.id] = { p: p, ls: ls, sc: sc, fixed: fixed, def: def };
    cur[p.id] = labelRect(p, ls, fixed ? def : (p.lp || def), sc);
    if (p.lp && !fixed) info[p.id].pos = p.lp; else info[p.id].pos = def;
  });
  var pb = st.persons.map(function (p) { var h = half(p) + 3; return { id: p.id, x0: p.x - h, x1: p.x + h, y0: top(p) - 3, y1: bot(p) + 3 }; });
  var res = {};
  for (var pass = 0; pass < 3; pass++) {
    Object.keys(info).forEach(function (id) {
      var I = info[id]; if (I.fixed) return;
      var best = null, bs = 1e18;
      order.forEach(function (pos, oi) {
        var r = labelRect(I.p, I.ls, pos, I.sc), sc = 0;
        pb.forEach(function (q) { if (q.id !== id) sc += overlapArea(r, q) * 10; });
        Object.keys(cur).forEach(function (k) { if (k !== id) sc += overlapArea(r, cur[k]) * 4; });
        for (var i = 0; i < pts.length; i++) { var q = pts[i]; if (q[0] >= r.x0 - 1 && q[0] <= r.x1 + 1 && q[1] >= r.y0 - 1 && q[1] <= r.y1 + 1) sc += 60; }
        sc += (pos === I.def ? 0 : 400) + oi;
        if (sc < bs) { bs = sc; best = pos; }
      });
      I.pos = best; cur[id] = labelRect(I.p, I.ls, best, I.sc);
    });
  }
  Object.keys(info).forEach(function (id) { var I = info[id]; if (!I.fixed) res[id] = I.pos === I.def ? '' : I.pos; });
  return res;
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
function genLabels(st, o, xAt) {
  var g = gens(st), rows = {}, minX = 1e9, out = '';
  st.persons.forEach(function (p) { minX = Math.min(minX, p.x); var v = g[p.id]; if (v == null) return; (rows[v] = rows[v] || []).push(p.y); });
  Object.keys(rows).forEach(function (k) {
    var ys = rows[k], y = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;
    out += '<text x="' + (xAt != null ? xAt : minX - 100) + '" y="' + (y + 6) + '" text-anchor="middle" font-size="19" font-weight="600" fill="#7a8bab" pointer-events="none">' + (ROMAN[+k] || (+k + 1)) + '</text>';
  });
  return out;
}

/* ---------- main render ---------- */
/* household loop that follows its members (not a box): contour of "distance to the members' skeleton < R" */
function homeSkel(st, ids, m) {
  var pts = ids.map(function (i) { return m[i]; }).filter(Boolean), segs = [], n = pts.length;
  if (n < 2) return { pts: pts, segs: segs };
  var rel = {};
  st.unions.forEach(function (u) { if (u.a && u.b && m[u.a] && m[u.b]) { rel[u.a + '|' + u.b] = rel[u.b + '|' + u.a] = 1; } });
  pts.forEach(function (p) { var u = p.from && st.unions.filter(function (z) { return z.id === p.from; })[0]; if (u) [u.a, u.b].forEach(function (a) { if (a) { rel[a + '|' + p.id] = rel[p.id + '|' + a] = 1; } }); });
  var E = []; for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) { var d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y); E.push([i, j, d * (rel[pts[i].id + '|' + pts[j].id] ? 0.5 : 1)]); }
  E.sort(function (a, b) { return a[2] - b[2]; });
  var par = pts.map(function (_, k) { return k; }); function f(k) { while (par[k] !== k) k = par[k] = par[par[k]]; return k; }
  E.forEach(function (e) { var a = f(e[0]), b = f(e[1]); if (a !== b) { par[a] = b; segs.push([pts[e[0]].x, pts[e[0]].y, pts[e[1]].x, pts[e[1]].y]); } });
  return { pts: pts, segs: segs };
}
function skelDist(sk, x, y) {
  var best = 1e9; sk.pts.forEach(function (p) { var d = Math.hypot(p.x - x, p.y - y); if (d < best) best = d; });
  sk.segs.forEach(function (s) { var dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / l2)), d = Math.hypot(x - s[0] - t * dx, y - s[1] - t * dy); if (d < best) best = d; });
  return best;
}
function hugPath(sk, R) {
  var xs = sk.pts.map(function (p) { return p.x; }), ys = sk.pts.map(function (p) { return p.y; });
  var x0 = Math.min.apply(null, xs) - R - 8, x1 = Math.max.apply(null, xs) + R + 8, y0 = Math.min.apply(null, ys) - R - 8, y1 = Math.max.apply(null, ys) + R + 8;
  var cs = Math.max(3, Math.sqrt((x1 - x0) * (y1 - y0) / 60000)), nx = Math.ceil((x1 - x0) / cs), ny = Math.ceil((y1 - y0) / cs), v = [];
  for (var j = 0; j <= ny; j++) for (var i = 0; i <= nx; i++) v.push(R - skelDist(sk, x0 + i * cs, y0 + j * cs));
  function V(i, j) { return v[j * (nx + 1) + i]; }
  var d = '';
  for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
    var a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), e = V(i, j + 1), X = x0 + i * cs, Y = y0 + j * cs, T = null, Rt = null, B = null, Lf = null;
    if ((a > 0) !== (b > 0)) T = [X + cs * a / (a - b), Y];
    if ((b > 0) !== (c > 0)) Rt = [X + cs, Y + cs * b / (b - c)];
    if ((e > 0) !== (c > 0)) B = [X + cs * e / (e - c), Y + cs];
    if ((a > 0) !== (e > 0)) Lf = [X, Y + cs * a / (a - e)];
    var q = [T, Rt, B, Lf].filter(Boolean);
    function seg(p1, p2) { d += 'M' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) + 'L' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1); }
    if (q.length === 2) seg(q[0], q[1]);
    else if (q.length === 4) { if ((a + b + c + e) / 4 > 0) { seg(T, Rt); seg(B, Lf); } else { seg(T, Lf); seg(Rt, B); } }
  }
  return d;
}
/* people NOT in the household whose symbol the loop would touch */
function homeOutsiders(st, h) {
  var m = ixOf(st), sk = homeSkel(st, h.ids, m), R = H * 1.55, n = 0;
  if (!sk.pts.length) return 0;
  st.persons.forEach(function (p) { if (h.ids.indexOf(p.id) < 0 && skelDist(sk, p.x, p.y) < R + H * 0.4) n++; });
  return n;
}
function inner(st, o) {
  o = o || {};
  MONO = !!o.mono; INK = MONO ? '#000' : '#234e8c'; REL = MONO ? '#000' : '#8e3a8a';
  var pre = o.pre || '', m = ixOf(st), back = [], lines = [], rels = [], pers = [], labs = [], hit = [], homeHit = [], defs = '';
  var sel_ = o.sel || null, md = o.mode || null, ms = o.msel || {};
  var usedC = {};
  st.persons.forEach(function (p) { if (isSmall(p)) return; var cs = fillConds(p, o).slice(0, 3); if (!cs.length) return; cs.forEach(function (k) { usedC[k] = 1; }); defs += '<clipPath id="' + pre + 'cl_' + sid(p.id) + '">' + geomEl(p, '') + '</clipPath>'; });
  Object.keys(usedC).forEach(function (k) { defs += patDef(pre + 'pt_' + k, MONO ? Object.assign({}, o.cm[k], { col: '#000' }) : o.cm[k]); });

  st.homes.forEach(function (h) {
    var ps = h.ids.map(function (i) { return m[i]; }).filter(Boolean); if (!ps.length) return;
    var x0 = Math.min.apply(null, ps.map(function (p) { return p.x; })), x1 = Math.max.apply(null, ps.map(function (p) { return p.x; }));
    var y0 = Math.min.apply(null, ps.map(function (p) { return p.y; })), y1 = Math.max.apply(null, ps.map(function (p) { return p.y; }));
    var rx = ((x1 - x0) / 2 + H) * 1.42 + 12, ry = ((y1 - y0) / 2 + H) * 1.42 + 12, hc = MONO ? INK : (o.hhc || INK);
    var on = sel_ && sel_.k === 'h' && sel_.id === h.id, hp = ' data-hid="' + h.id + '" pointer-events="stroke" style="cursor:pointer"';
    var stk = ' fill="none" stroke="' + (on ? ACC : hc) + '" stroke-width="' + (on ? 3 : (MONO ? 1.1 : 1.6)) + '"';
    var hs = ' fill="none" stroke="#000" stroke-opacity="0" stroke-width="16"' + hp;
    var lx = (x0 + x1) / 2, ly = y0 - H * 2.2;
    if (o.hhs === 'hug') {
      var hk = homeSkel(st, h.ids, m), hd = hugPath(hk, H * 1.55), top = hk.pts.reduce(function (a, p) { return p.y < a.y ? p : a; }, hk.pts[0]); lx = top.x; ly = top.y - H * 2.3;
      back.push('<path d="' + hd + '"' + stk + ' stroke-linecap="round"/>'); if (!o.nosel) homeHit.push('<path d="' + hd + '"' + hs + ' stroke-linecap="round"/>');
    } else if (o.hhs === 'round') {
      var pd = H * 1.9, g = ' x="' + (x0 - pd) + '" y="' + (y0 - pd) + '" width="' + (x1 - x0 + 2 * pd) + '" height="' + (y1 - y0 + 2 * pd) + '" rx="24"';
      back.push('<rect' + g + stk + '/>'); if (!o.nosel) homeHit.push('<rect' + g + hs + '/>');
    } else {
      var g2 = ' cx="' + (x0 + x1) / 2 + '" cy="' + (y0 + y1) / 2 + '" rx="' + rx + '" ry="' + ry + '"';
      back.push('<ellipse' + g2 + stk + '/>'); if (!o.nosel) homeHit.push('<ellipse' + g2 + hs + '/>');
    }
    if (h.label) labs.push('<text x="' + lx + '" y="' + ly + '" text-anchor="middle" font-size="12" font-weight="600" fill="' + hc + '" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">' + $esc(h.label) + '</text>');
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
  return (defs ? '<defs>' + defs + '</defs>' : '') + back.join('') + lines.join('') + homeHit.join('') + hit.join('') + rels.join('') + pers.join('') + (o.gen && !o.nolabels ? genLabels(st, o) : '') + labs.join('') + txs.join('');
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
function twinSvg(identical, mono) {
  var c = mono ? '#000' : '#234e8c';
  return '<svg viewBox="0 0 120 70" preserveAspectRatio="xMidYMid meet" width="66" height="44"><g fill="#fff" stroke="' + c + '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><circle cx="30" cy="48" r="16"/><circle cx="90" cy="48" r="16"/><path d="M40.3 35.7L60 20L79.7 35.7" fill="none"/>' + (identical ? '<path d="M46 48H74" fill="none"/>' : '') + '</g></svg>';
}
function legendItems(st, o, mode) {
  mode = mode === true ? 'panel' : (mode || 'used');
  var cm = o.cm || {}, items = [], std = mode !== 'used', every = mode === 'panel';
  var mo = { cm: cm, adopt: o.adopt, pstyle: o.pstyle, hhs: o.hhs, hhc: o.hhc, mono: !!o.mono };
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
  if (has(function (p) { return p.tw && p.twi; })) add('แฝดเหมือน', twinSvg(true, o.mono));
  if (has(function (p) { return p.tw && !p.twi; })) add('แฝดต่าง', twinSvg(false, o.mono));
  if (has(function (p) { return p.adopted; })) add('ลูกบุญธรรม', mini([mp('a', 'F', 62, 40, { adopted: 1 }), mp('b', 'M', 112, 40)], 0, 0, 0, '-36 0 190 76', mo));
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
    if (!o.condFill) { add(c.t + ' = ' + c.n, aaSvg(textColor(c.risk ? 'risk' : 'cond', o, null))); return; }
    add(c.t + ' = ' + c.n, '<svg viewBox="0 0 60 44" width="66" height="44"><defs>' + patDef(id + 'p', o.mono ? Object.assign({}, c, { col: '#000' }) : c) + '</defs><rect x="18" y="8" width="26" height="26" fill="url(#' + id + 'p)" stroke="' + INK + '" stroke-width="1.8"/></svg>');
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
  autoAlias: autoAlias, TEXT_KINDS: TEXT_KINDS, textColor: textColor, KEYFILL: KEYFILL, LEGEND_TITLE: LEGEND_TITLE, dispName: dispName, ageText: ageText, legendItems: legendItems, legendHTML: legendHTML, autoLabels: autoLabels, lineSegs: lineSegs, personBoxes: personBoxes, partnersOf: function (st) { return st.unions.filter(function (u) { return u.a && u.b; }).map(function (u) { return [u.a, u.b]; }); }, isUnk: isUnk, dzList: dzList, homeOutsiders: homeOutsiders, esc: $esc
};
})(window);

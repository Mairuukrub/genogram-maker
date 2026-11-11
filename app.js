/* Genogram Maker - application (UI, editing, backup, export). */
(function () {
'use strict';
var GE = window.GE, Store = window.Store, H = GE.H;
function $(s, r) { return (r || document).querySelector(s); }
function esc(s) { return GE.esc(s); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function hhmm(t) { var d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function stamp() { var d = new Date(); return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()); }
var TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thaiDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? (+m[3]) + ' ' + TH_M[+m[2] - 1] + ' ' + (+m[1] + 543) : ''; }
function ago(t) { var s = (Date.now() - t) / 1000; if (s < 90) return 'เมื่อสักครู่'; if (s < 3600) return Math.round(s / 60) + ' นาทีที่แล้ว'; if (s < 86400) return Math.round(s / 3600) + ' ชม.ที่แล้ว'; return Math.round(s / 86400) + ' วันที่แล้ว'; }

/* embed fonts into the page (same data is embedded into exports) */
(function () {
  var css = (window.GM_FONTS || []).map(function (f) { return "@font-face{font-family:'Sarabun';font-weight:" + f.w + ";font-style:normal;src:url(" + f.d + ") format('woff2');unicode-range:" + f.r + "}"; }).join('');
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
})();
function fontCss() { return (window.GM_FONTS || []).map(function (f) { return "@font-face{font-family:'Sarabun';font-weight:" + f.w + ";font-style:normal;src:url(" + f.d + ") format('woff2');unicode-range:" + f.r + "}"; }).join(''); }

/* ================= state ================= */
var project = { families: [] }, fam = null, state = null;
var undoMap = {}, redoMap = {}, undoS = [], redoS = [];
var sel = null, msel = {}, mode = null, selMode = false, view = { x: 0, y: 0, w: 1200, h: 700 };
var svg, panel, ctr = 0;

function newState() { return { v: 2, persons: [], unions: [], rels: [], homes: [] }; }
function newFam(title) {
  return { id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: title || '', house: '', place: '', interviewer: '', date: '', alias: false, showNote: true, condText: true, gen: true, cx: {}, exp: {}, state: newState(), created: Date.now(), updated: Date.now() };
}
function normalize(s) {
  s = s || {}; s.persons = s.persons || []; s.unions = s.unions || []; s.rels = s.rels || []; s.homes = s.homes || []; s.v = 2;
  s.persons.forEach(function (p) {
    p.x = +p.x || 0; p.y = +p.y || 0; p.sex = p.sex || 'U';
    var a = String(p.age == null ? '' : p.age).trim();
    if (/^\d{4}$/.test(a) && +a >= 1800) { p.byr = +a > 2300 ? +a : +a + 543; delete p.age; } /* old versions mixed age / birth year */
    if (p.cond && !Array.isArray(p.cond)) delete p.cond;
  });
  return s;
}
function normFam(f) {
  var d = newFam(); for (var k in d) if (f[k] === undefined) f[k] = d[k];
  f.state = normalize(f.state); return f;
}
function liveFams() { return project.families.filter(function (f) { return !f.deleted; }); }
function ctxFor(f, over) {
  var y = f.date ? parseInt(f.date.slice(0, 4), 10) : NaN; if (isNaN(y)) y = new Date().getFullYear();
  var o = { alias: !!f.alias, showNote: f.showNote !== false, condText: f.condText !== false, gen: f.gen !== false, refYear: y + 543, cm: GE.condMapFor(f) };
  for (var k in over || {}) o[k] = over[k];
  return o;
}
function ixOf(st) { return GE.ixOf(st || state); }
function exists(id) { return state.persons.some(function (p) { return p.id === id; }) || state.unions.some(function (p) { return p.id === id; }) || state.rels.some(function (p) { return p.id === id; }) || state.homes.some(function (p) { return p.id === id; }); }
function newId(pre) { var id; do { id = pre + (++ctr); } while (exists(id)); return id; }
function famLabel(f) { return (f.title || 'ครอบครัว (ยังไม่ตั้งชื่อ)') + (f.house ? ' · บ้าน ' + f.house : ''); }

/* ================= persistence ================= */
var dirty = false, saveTimer = null, mirrorTimer = null, fsTimer = null, saveState = 'idle', lastSaved = 0;
var backupAt = 0, editsSinceBackup = 0, firstEditAt = 0, fsh = null, fsState = 'none', lastSnapAt = 0, persisted = null;
function snapStr() { return JSON.stringify(state); }
function save() {
  dirty = true; fam.updated = Date.now(); editsSinceBackup++; if (!firstEditAt) firstEditAt = Date.now();
  saveState = 'pending'; setStat();
  clearTimeout(saveTimer); saveTimer = setTimeout(persistNow, 400);
  clearTimeout(mirrorTimer); mirrorTimer = setTimeout(mirrorNow, 1200);
  scheduleFs(); maybeSnap();
}
function touch() { dirty = true; fam.updated = Date.now(); clearTimeout(saveTimer); saveTimer = setTimeout(persistNow, 400); clearTimeout(mirrorTimer); mirrorTimer = setTimeout(mirrorNow, 1200); }
function persistNow() {
  clearTimeout(saveTimer); if (!dirty) return Promise.resolve();
  dirty = false;
  return Store.putFamily(fam).then(function () { lastSaved = Date.now(); saveState = 'ok'; setStat(); }).catch(function () {
    mirrorNow(); saveState = Store.mirrorOK ? 'mirror' : 'fail'; if (saveState === 'mirror') lastSaved = Date.now(); dirty = saveState === 'fail'; setStat();
  });
}
function mirrorNow() { clearTimeout(mirrorTimer); Store.mirrorWrite(project.families); }
function maybeSnap(force, reason) {
  if (!force && Date.now() - lastSnapAt < 180000) return;
  if (!state.persons.length && !force) return;
  lastSnapAt = Date.now();
  Store.addSnap(fam.id, snapStr(), reason || 'อัตโนมัติ', state.persons.length).catch(function () { });
}
function markBackup() {
  backupAt = Date.now(); editsSinceBackup = 0; firstEditAt = 0;
  Store.putMeta('backupAt', backupAt).catch(function () { }); try { localStorage.setItem('gm2_backupAt', String(backupAt)); } catch (e) { }
  setStat(); updNag();
}
function bundle() { return { app: 'genogram-maker', v: 2, saved: new Date().toISOString(), families: liveFams().map(clone) }; }
function totalPersons() { return liveFams().reduce(function (a, f) { return a + f.state.persons.length; }, 0); }
function setStat() {
  var b = $('#stat'); if (!b) return; var t, cls = 'stat';
  var bk = fsState === 'ok' ? 'สำรองไฟล์อัตโนมัติ ✓' : (backupAt ? 'สำรองไฟล์ ' + ago(backupAt) : 'ยังไม่เคยสำรองไฟล์');
  if (saveState === 'fail') { cls += ' bad'; t = '⚠ บันทึกไม่สำเร็จ — กดเพื่อสำรองไฟล์ทันที'; }
  else if (saveState === 'mirror') { cls += ' warn'; t = '⚠ บันทึกแบบสำรองชั่วคราวเท่านั้น · ' + bk; }
  else if (saveState === 'pending') { cls += ' warn'; t = 'กำลังบันทึก…'; }
  else {
    t = (lastSaved ? '✓ บันทึกในเครื่องแล้ว ' + hhmm(lastSaved) : '✓ พร้อมใช้งาน') + ' · ' + bk;
    if (fsState !== 'ok' && totalPersons() && (!backupAt || (editsSinceBackup && Date.now() - backupAt > 86400000))) cls += ' warn';
    if (fsState === 'need') { cls += ' warn'; t += ' (ต่อไฟล์อีกครั้ง)'; }
  }
  b.className = cls; b.textContent = t;
}
function updNag() {
  var n = $('#nag'); if (!n) return;
  var show = fsState !== 'ok' && editsSinceBackup > 0 && firstEditAt && Date.now() - firstEditAt > 15 * 60000 && totalPersons() > 0;
  if (!show) { n.style.display = 'none'; return; }
  n.style.display = 'flex';
  n.innerHTML = '⚠ งานยังไม่ได้สำรองเป็นไฟล์ (' + (backupAt ? 'สำรองล่าสุด ' + ago(backupAt) : 'ยังไม่เคยสำรอง') + ') ข้อมูลเก็บอยู่ในเบราว์เซอร์นี้เท่านั้น <button class="pri" data-act="bkdl">สำรองเดี๋ยวนี้ (ดาวน์โหลดไฟล์)</button><button data-act="bkopen">ตั้งสำรองอัตโนมัติ…</button>';
}
/* linked backup file (File System Access API: Chrome / Edge on desktop) */
function scheduleFs() { if (!fsh) return; clearTimeout(fsTimer); fsTimer = setTimeout(writeFs, 3000); }
function writeFs(askPerm) {
  if (!fsh) return Promise.resolve();
  return Promise.resolve().then(function () { return fsh.queryPermission({ mode: 'readwrite' }); }).then(function (p) {
    if (p !== 'granted') { if (askPerm) return fsh.requestPermission({ mode: 'readwrite' }); return p; } return p;
  }).then(function (p) {
    if (p !== 'granted') { fsState = 'need'; setStat(); return; }
    return fsh.createWritable().then(function (w) { return w.write(JSON.stringify(bundle())).then(function () { return w.close(); }); }).then(function () { fsState = 'ok'; markBackup(); });
  }).catch(function () { fsState = 'err'; setStat(); });
}
function linkFile() {
  if (!window.showSaveFilePicker) { toast('เบราว์เซอร์นี้ไม่รองรับการเชื่อมไฟล์อัตโนมัติ (ใช้ Chrome/Edge บนคอมพิวเตอร์) — ใช้ปุ่มดาวน์โหลดแทน'); return; }
  window.showSaveFilePicker({ suggestedName: 'genogram-สำรอง.json', types: [{ description: 'Genogram backup', accept: { 'application/json': ['.json'] } }] }).then(function (h) {
    fsh = h; Store.putMeta('fsHandle', h).catch(function () { });
    return writeFs(true);
  }).then(function () { toast('เชื่อมไฟล์สำรองแล้ว — ทุกครั้งที่แก้ จะบันทึกลงไฟล์นี้อัตโนมัติ'); renderBackup(); }).catch(function () { });
}
function unlinkFile() { fsh = null; fsState = 'none'; Store.putMeta('fsHandle', null).catch(function () { }); setStat(); renderBackup(); }

/* ================= toast ================= */
var toastT = null;
function toast(t, label, fn) {
  var el = $('#toast'); el.innerHTML = ''; var s = document.createElement('span'); s.textContent = t; el.appendChild(s);
  if (label) { var b = document.createElement('button'); b.textContent = label; b.onclick = function () { el.style.opacity = 0; el.classList.remove('act'); fn(); }; el.appendChild(b); el.classList.add('act'); } else el.classList.remove('act');
  el.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(function () { el.style.opacity = 0; el.classList.remove('act'); }, label ? 7000 : 2800);
}

/* ================= undo ================= */
function pushSnap(str) { undoS.push(str || snapStr()); if (undoS.length > 150) undoS.shift(); redoS.length = 0; updUR(); }
function undo() { if (!undoS.length) return; redoS.push(snapStr()); state = fam.state = normalize(JSON.parse(undoS.pop())); afterLoad(); }
function redo() { if (!redoS.length) return; undoS.push(snapStr()); state = fam.state = normalize(JSON.parse(redoS.pop())); afterLoad(); }
function updUR() { var u = $('#undo'), r = $('#redo'); if (u) u.disabled = !undoS.length; if (r) r.disabled = !redoS.length; }
function findSel() {
  if (!sel) return null;
  var list = sel.k === 'p' ? state.persons : sel.k === 'u' ? state.unions : sel.k === 'r' ? state.rels : state.homes;
  return list.filter(function (o) { return o.id === sel.id; })[0] || null;
}
function afterLoad() { if (sel && !findSel()) sel = null; var ids = ixOf(); for (var k in msel) if (!ids[k]) delete msel[k]; mode = null; draw(); renderPanel(); save(); updUR(); }

/* ================= view ================= */
function bounds() { return GE.bounds(state, { gen: fam.gen !== false }); }
function setVB() { var cw = svg.clientWidth || 1000, ch = svg.clientHeight || 600; view.h = view.w * ch / cw; svg.setAttribute('viewBox', view.x + ' ' + view.y + ' ' + view.w + ' ' + view.h); }
function fit() {
  var b = bounds(), cw = svg.clientWidth || 1000, ch = svg.clientHeight || 600, s = Math.max(b.w / cw, b.h / ch);
  view.w = cw * s; view.h = ch * s; view.x = b.x + b.w / 2 - view.w / 2; view.y = b.y + b.h / 2 - view.h / 2; setVB(); showZoom();
}
function zoomAt(f, cx, cy) {
  if (cx == null) { cx = view.x + view.w / 2; cy = view.y + view.h / 2; }
  var nw = Math.max(200, Math.min(12000, view.w * f)), k = nw / view.w;
  view.x = cx - (cx - view.x) * k; view.y = cy - (cy - view.y) * k; view.w = nw; setVB(); showZoom();
}
function showZoom() { var z = $('#zl'); if (z) z.textContent = Math.round((svg.clientWidth || 1000) / view.w * 100) + '%'; }
function pt(e) { var p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; var q = p.matrixTransform(svg.getScreenCTM().inverse()); return { x: q.x, y: q.y }; }
function draw() {
  svg.innerHTML = GE.inner(state, ctxFor(fam, { sel: sel, msel: msel, mode: mode }));
  var e = $('#empty'); if (e) e.style.display = state.persons.length ? 'none' : 'flex';
}
function select(s) { sel = s; if (s) msel = {}; renderPanel(); draw(); }

/* ================= editing ================= */
function svgCenter() { return { x: Math.round((view.x + view.w / 2) / 10) * 10, y: Math.round((view.y + view.h / 2) / 10) * 10 }; }
function overlap(x, y) { return state.persons.some(function (p) { return Math.abs(p.x - x) < 78 && Math.abs(p.y - y) < 70; }); }
function freeSpot(x, y) { var n = 0; while (overlap(x, y) && n < 40) { x += 100; n++; } return x; }
function addPerson(sex, x, y, extra) { var p = { id: newId('p'), name: '', sex: sex, x: x, y: y, c: 0 }; for (var k in extra || {}) p[k] = extra[k]; state.persons.push(p); return p; }
function unionsOf(p) { return state.unions.filter(function (u) { return u.a === p.id || u.b === p.id; }); }
function addSpouse(p) {
  var o = p.sex === 'M' ? 'F' : p.sex === 'F' ? 'M' : 'U';
  var q = addPerson(o, freeSpot(p.x + 130, p.y), p.y, { c: p.c });
  state.unions.push({ id: newId('u'), a: p.id, b: q.id, t: 'married' }); return q;
}
function addChildTo(u, sex) {
  var m = ixOf(), g = GE.ugeo(u, m), ks = GE.kidsOf(state, u), x, y;
  if (ks.length) { x = Math.max.apply(null, ks.map(function (k) { return k.x; })) + 100; y = ks[0].y; }
  else { x = g.mx; y = (g.b ? Math.max(g.a.y, g.b.y) : g.a.y) + 150; }
  return addPerson(sex, freeSpot(x, y), y, { from: u.id, c: Math.min(5, (g.a.c || 0) + 1) });
}
function addChildOf(p, sex) {
  var us = unionsOf(p), u;
  if (!us.length) { u = { id: newId('u'), a: p.id, b: null, t: 'married' }; state.unions.push(u); } else u = us[us.length - 1];
  return addChildTo(u, sex);
}
function addParents(p) {
  if (p.from) return;
  var y = p.y - 150, lx = freeSpot(p.x - 65, y);
  var f = addPerson('M', lx, y, { c: Math.max(0, (p.c || 1) - 1) }), mo = addPerson('F', lx + 130, y, { c: f.c });
  var u = { id: newId('u'), a: f.id, b: mo.id, t: 'married' }; state.unions.push(u); p.from = u.id;
}
function addSibling(p, sex) {
  if (!p.from) addParents(p);
  var u = state.unions.filter(function (z) { return z.id === p.from; })[0], ks = GE.kidsOf(state, u);
  var x = Math.max.apply(null, ks.map(function (k) { return k.x; })) + 100;
  return addPerson(sex, freeSpot(x, p.y), p.y, { from: p.from, c: p.c });
}
function orphansOf(id) { var n = 0; unionsOf({ id: id }).forEach(function (u) { n += GE.kidsOf(state, u).length; }); return n; }
function delPerson(id) {
  state.unions.filter(function (u) { return u.a === id || u.b === id; }).forEach(function (u) { state.persons.forEach(function (k) { if (k.from === u.id) { delete k.from; delete k.tw; delete k.twi; } }); });
  state.unions = state.unions.filter(function (u) { return u.a !== id && u.b !== id; });
  state.rels = state.rels.filter(function (r) { return r.a !== id && r.b !== id; });
  state.homes.forEach(function (h) { h.ids = h.ids.filter(function (i) { return i !== id; }); });
  state.homes = state.homes.filter(function (h) { return h.ids.length; });
  state.persons.forEach(function (k) { if (k.tw === id) { delete k.tw; delete k.twi; } });
  state.persons = state.persons.filter(function (z) { return z.id !== id; });
}
function delUnion(id) { state.persons.forEach(function (k) { if (k.from === id) { delete k.from; delete k.tw; delete k.twi; } }); state.unions = state.unions.filter(function (u) { return u.id !== id; }); }
function branchSet(id) {
  var set = {}, q = [id]; set[id] = 1;
  while (q.length) {
    var c = q.pop();
    state.unions.forEach(function (u) {
      if (u.a === c || u.b === c) {
        [u.a, u.b].forEach(function (z) { if (z && !set[z]) set[z] = 1; });
        state.persons.forEach(function (k) { if (k.from === u.id && !set[k.id]) { set[k.id] = 1; q.push(k.id); } });
      }
    });
  }
  return set;
}
function doDelete() {
  var s = sel; if (!s) return; var snap = snapStr(), orph = 0, label = '';
  pushSnap();
  if (s.k === 'p') { orph = orphansOf(s.id); label = 'ลบแล้ว'; delPerson(s.id); }
  else if (s.k === 'u') { delUnion(s.id); label = 'ลบเส้นคู่ชีวิตแล้ว'; }
  else if (s.k === 'r') { state.rels = state.rels.filter(function (r) { return r.id !== s.id; }); label = 'ลบเส้นแล้ว'; }
  else { state.homes = state.homes.filter(function (h) { return h.id !== s.id; }); label = 'ลบวงบ้านแล้ว'; }
  sel = null; renderPanel(); draw(); save();
  toast(label + (orph ? ' — ลูก ' + orph + ' คนหลุดจากพ่อแม่ (เส้นถูกตัด)' : ''), 'ย้อนกลับ', undo);
}
function doDeleteMulti() {
  var ids = Object.keys(msel); if (!ids.length) return; pushSnap();
  var orph = 0; ids.forEach(function (i) { orph += orphansOf(i); delPerson(i); }); msel = {};
  renderPanel(); draw(); save(); toast('ลบ ' + ids.length + ' คนแล้ว' + (orph ? ' — ลูกที่ไม่ได้ถูกลบอีก ' + orph + ' คนหลุดจากพ่อแม่' : ''), 'ย้อนกลับ', undo);
}
function tidy(kind) {
  if (!state.persons.length) return; pushSnap(); var g = GE.gens(state), moved = 0;
  if (kind === 'rows' || kind === 'both') {
    var y0 = Math.min.apply(null, state.persons.map(function (p) { return p.y; }));
    state.persons.forEach(function (p) { if (g[p.id] == null) return; var ny = y0 + g[p.id] * 160; if (ny !== p.y) { p.y = ny; moved++; } });
  }
  if (kind === 'overlap' || kind === 'both') {
    var rows = {}; state.persons.forEach(function (p) { (rows[p.y] = rows[p.y] || []).push(p); });
    Object.keys(rows).forEach(function (y) {
      var r = rows[y].sort(function (a, b) { return a.x - b.x; }), shift = 0, prev = null;
      r.forEach(function (p) { p.x += shift; if (prev && p.x - prev.x < 100) { var d = 100 - (p.x - prev.x); p.x += d; shift += d; moved++; } prev = p; });
    });
  }
  draw(); save(); toast(moved ? 'จัดวางแล้ว (ย้าย ' + moved + ' จุด) — ไม่พอใจกดย้อนกลับได้' : 'ไม่มีอะไรต้องจัด', moved ? 'ย้อนกลับ' : null, undo);
}

/* ---------- link mode ---------- */
function typeName(t) { var k = t.split(':')[0], v = t.split(':')[1]; return k === 'u' ? GE.UT[v] : k === 't' ? (v === 'i' ? 'แฝดเหมือน' : 'แฝดต่าง') : GE.RELS[v].replace(/ \(.*\)/, ''); }
function startLink(from, val) { mode = { kind: 'link', from: from, type: val }; renderPanel(); draw(); }
function finishLink(toId) {
  var a = mode.from, b = toId, t = mode.type, kind = t.split(':')[0], v = t.split(':')[1], m = ixOf(), keep = mode.keep;
  function fail(msg) { toast(msg); if (keep) mode.from = null; renderPanel(); draw(); }
  if (a === b) return;
  if (kind === 'u') {
    if (state.unions.some(function (u) { return (u.a === a && u.b === b) || (u.a === b && u.b === a); })) { fail('สองคนนี้มีเส้นคู่สมรสอยู่แล้ว'); return; }
    pushSnap(); var u = { id: newId('u'), a: a, b: b, t: v }; state.unions.push(u); sel = { k: 'u', id: u.id };
  } else if (kind === 't') {
    var A = m[a], B = m[b];
    if (!A.from || A.from !== B.from) { fail('แฝดต้องเป็นลูกของคู่พ่อแม่เดียวกัน'); return; }
    pushSnap(); A.tw = b; B.tw = a; A.twi = B.twi = (v === 'i'); sel = { k: 'p', id: a };
  } else {
    pushSnap(); var r = { id: newId('r'), a: a, b: b, t: v, bend: GE.autoBend(m[a], m[b], state) }; state.rels.push(r); sel = { k: 'r', id: r.id };
  }
  if (keep) { mode = { kind: 'link', type: t, from: null, keep: true }; sel = null; toast('สร้างเส้นแล้ว — คลิกคนแรกของเส้นถัดไป หรือกด “เสร็จ”'); } else mode = null;
  renderPanel(); draw(); save();
}
function renderMode() {
  var el = $('#modebar'); if (!el) return;
  if (!mode) { el.style.display = 'none'; return; }
  var m = ixOf(), h = '';
  if (mode.kind === 'home') h = 'วงบ้านเดียวกัน — คลิกคนที่อยู่ด้วยกัน (เลือกแล้ว ' + mode.ids.length + ' คน) <button class="pri" data-act="homedone">เสร็จ</button><button data-act="cancel">ยกเลิก</button>';
  else {
    var f = mode.from && m[mode.from], nm = f ? (GE.dispName(f, ctxFor(fam)) || 'คนที่เลือก') : '';
    h = '<b>' + esc(typeName(mode.type)) + '</b> — ' + (mode.from ? 'คลิก <u>คนที่สอง</u> (ต่อจาก ' + esc(nm) + ')' : 'คลิก <u>คนแรก</u>') + ' <button data-act="cancel">' + (mode.keep ? 'เสร็จ' : 'ยกเลิก') + '</button>';
  }
  el.innerHTML = h; el.style.display = 'flex';
}

/* ================= side panel ================= */
function opt(v, t, cur) { return '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + t + '</option>'; }
function linkOptions() {
  var h = '<optgroup label="คู่ชีวิต">';
  for (var k in GE.UT) h += opt('u:' + k, GE.UT[k]);
  h += '</optgroup><optgroup label="แฝด">' + opt('t:i', 'แฝดเหมือน') + opt('t:f', 'แฝดต่าง') + '</optgroup><optgroup label="ความสัมพันธ์">';
  for (var r in GE.RELS) h += opt('r:' + r, GE.RELS[r]);
  return h + '</optgroup>';
}
function addBtns() {
  return '<div class="sec"><div class="st">เพิ่มคนใหม่</div><div class="btns"><button data-act="new" data-v="M">+ ชาย</button><button data-act="new" data-v="F">+ หญิง</button><button data-act="new" data-v="U">+ ไม่ทราบเพศ</button><button data-act="homemode">วงบ้านเดียวกัน</button></div></div>';
}
function famPanel() {
  var cm = GE.condMapFor(fam), h = '<div class="sec"><div class="st">ข้อมูลผังนี้</div>' +
    '<label>หัวเรื่อง (ขึ้นบนรูปที่ส่งออก)<input data-fm="title" value="' + esc(fam.title) + '" placeholder="เช่น ผังเครือญาติครอบครัว นาย ก."></label>' +
    '<div class="two"><label>บ้านเลขที่<input data-fm="house" value="' + esc(fam.house) + '"></label><label>วันที่เก็บข้อมูล<input type="date" data-fm="date" value="' + esc(fam.date) + '"></label></div>' +
    '<label>ที่ตั้ง (ขึ้นบนรูป)<input data-fm="place" value="' + esc(fam.place) + '" placeholder="เช่น หมู่ 11 ต.บ้านเหล่า อ.บ้านฝาง"></label>' +
    '<label>ผู้สัมภาษณ์ (ไม่ขึ้นบนรูป)<input data-fm="interviewer" value="' + esc(fam.interviewer) + '"></label></div>' +
    '<div class="sec"><div class="st">การแสดงผลบนผัง</div>' +
    '<label class="ck"><input type="checkbox" data-fm="alias"' + (fam.alias ? ' checked' : '') + '> แสดง “ตัวย่อ” แทนชื่อจริง</label>' +
    '<label class="ck"><input type="checkbox" data-fm="gen"' + (fam.gen !== false ? ' checked' : '') + '> ป้ายรุ่น I, II, III</label>' +
    '<label class="ck"><input type="checkbox" data-fm="condText"' + (fam.condText !== false ? ' checked' : '') + '> ตัวย่อโรคใต้ชื่อ</label>' +
    '<label class="ck"><input type="checkbox" data-fm="showNote"' + (fam.showNote !== false ? ' checked' : '') + '> หมายเหตุใต้ชื่อ</label></div>' +
    addBtns() +
    '<div class="sec"><div class="st">โรค/ภาวะที่ตั้งชื่อเองได้</div><p class="mut" style="margin-bottom:6px">ใช้ติดป้ายให้คนในผัง (เช่น โรคที่ไม่มีในรายการ)</p>' +
    ['x1', 'x2'].map(function (k) { return '<div class="two"><label>ตัวย่อ<input data-cx="' + k + '.t" value="' + esc((fam.cx[k] || {}).t || '') + '" placeholder="' + esc(cm[k].t) + '"></label><label>ชื่อเต็ม<input data-cx="' + k + '.n" value="' + esc((fam.cx[k] || {}).n || '') + '" placeholder="' + esc(cm[k].n) + '"></label></div>'; }).join('') + '</div>' +
    '<div class="sec"><p class="mut">คลิกสัญลักษณ์เพื่อแก้ไข · ลากเพื่อย้าย · ลากพื้นที่ว่างเพื่อเลื่อนผัง · ล้อเมาส์หรือถ่างนิ้วเพื่อซูม · ดับเบิลคลิกคนเพื่อพิมพ์ชื่อ · ลูกศรบนคีย์บอร์ดขยับทีละนิด</p></div>';
  return h;
}
function renderPanel() {
  var h = '', s = findSel(), cm = GE.condMapFor(fam), nm = Object.keys(msel).length;
  if (mode && mode.kind === 'home') {
    h += '<div class="sec"><div class="st">วงสมาชิกที่อยู่ด้วยกัน</div><p class="mut">คลิกคนที่อยู่บ้านเดียวกันบนผัง (เลือกแล้ว ' + mode.ids.length + ' คน)</p><div class="btns"><button class="pri" data-act="homedone">เสร็จ</button><button data-act="cancel">ยกเลิก</button></div></div>';
  } else if (mode && mode.kind === 'link') {
    h += '<div class="sec"><div class="st">กำลังเชื่อม</div><p class="mut">คลิกคนที่ต้องการเชื่อมบนผัง</p><div class="btns"><button data-act="cancel">ยกเลิก</button></div></div>';
  } else if (nm > 1 || (nm === 1 && !s)) {
    h += '<div class="sec"><div class="st">เลือกไว้ ' + nm + ' คน</div><p class="mut">ลากคนใดคนหนึ่งเพื่อย้ายทั้งกลุ่ม</p><div class="btns"><button data-act="malign">จัดให้อยู่แนวเดียวกัน</button><button data-act="mdist">เว้นระยะเท่ากัน</button></div>' +
      '<div class="sw">' + GE.FILLS.map(function (c, i) { return '<button class="swb" data-act="mcolor" data-v="' + i + '" title="' + GE.FILL_NAMES[i] + '" style="background:' + c + '"></button>'; }).join('') + '</div>' +
      '<div class="btns"><button data-act="mclear">ยกเลิกการเลือก</button><button class="dng" data-act="mdel">ลบ ' + nm + ' คน</button></div></div>';
  } else if (!s) {
    h += famPanel();
  } else if (sel.k === 'p') {
    var p = s, dead = !!p.dead;
    h += '<div class="sec"><div class="st">ข้อมูลบุคคล</div>' +
      '<label>ชื่อ<input data-f="name" value="' + esc(p.name) + '" placeholder="ชื่อ"></label>' +
      '<label>ตัวย่อ (ใช้ในรายงาน)<span style="display:flex;gap:6px"><input data-f="alias" value="' + esc(p.alias || '') + '" placeholder="' + esc(p.name ? GE.autoAlias(p.name) : 'เช่น ส.ด.') + '" style="margin-top:2px"><button type="button" data-act="autoalias" style="margin-top:2px;white-space:nowrap">ตั้งอัตโนมัติ</button></span></label>' +
      '<div class="two"><label>' + (dead ? 'อายุเมื่อเสียชีวิต (ปี)' : 'อายุ (ปี)') + '<input data-f="age" value="' + esc(p.age || '') + '" placeholder="เช่น 45" inputmode="numeric"></label>' +
      '<label>ปีเกิด (พ.ศ.)<input data-f="byr" value="' + esc(p.byr || '') + '" placeholder="เช่น 2512" inputmode="numeric"></label></div>' +
      '<p class="mut" style="margin:-2px 0 6px;font-size:12px">ใส่ปีเกิดอย่างเดียวก็ได้ — ระบบคำนวณอายุจากวันที่เก็บข้อมูลให้</p>' +
      '<div class="two"><label>เพศ<select data-f="sex">' + opt('M', 'ชาย', p.sex) + opt('F', 'หญิง', p.sex) + opt('U', 'ไม่ทราบเพศ', p.sex) + '</select></label>' +
      '<label>สถานะ<select data-f="st">' + Object.keys(GE.STS).map(function (k) { return opt(k, GE.STS[k], p.st || ''); }).join('') + '</select></label></div>' +
      '<div class="chk"><label><input type="checkbox" data-f="dead"' + (dead ? ' checked' : '') + '> เสียชีวิต</label><label><input type="checkbox" data-f="adopted"' + (p.adopted ? ' checked' : '') + '> ลูกบุญธรรม</label></div>' +
      (dead ? '<label>สาเหตุการเสียชีวิต<input data-f="cod" value="' + esc(p.cod || '') + '" placeholder="เช่น โรคหัวใจ อุบัติเหตุ ชราภาพ"></label>' : '') + '</div>' +
      '<div class="sec"><div class="st">โรค / ภาวะสุขภาพ</div><div class="chips">' + Object.keys(cm).map(function (k) { var on = (p.cond || []).indexOf(k) >= 0; return '<button class="chip' + (on ? ' on' : '') + '" data-act="cond" data-v="' + k + '" title="' + esc(cm[k].n) + '">' + esc(cm[k].t) + '</button>'; }).join('') + '</div>' +
      ((p.cond || []).length > 3 ? '<p class="mut" style="color:#b26a00">แสดงบนสัญลักษณ์ได้ 3 อย่างแรก (ที่เหลือยังขึ้นเป็นตัวหนังสือ)</p>' : '<p class="mut" style="font-size:12px">แต่ละโรคจะเป็นลายระบายในสัญลักษณ์ (พิมพ์ขาวดำก็แยกได้)</p>') + '</div>' +
      '<div class="sec"><label>หมายเหตุ<textarea data-f="note" rows="2" placeholder="อาชีพ ฯลฯ">' + esc(p.note || '') + '</textarea></label>' +
      '<div class="sw">' + GE.FILLS.map(function (c, i) { return '<button class="swb' + ((p.c || 0) === i ? ' on' : '') + '" data-act="color" data-v="' + i + '" title="' + GE.FILL_NAMES[i] + '" style="background:' + c + '"></button>'; }).join('') + '</div>' +
      '<label>ตำแหน่งชื่อ<select data-f="lp">' + opt('', 'อัตโนมัติ', p.lp || '') + opt('b', 'ใต้สัญลักษณ์', p.lp) + opt('t', 'เหนือสัญลักษณ์', p.lp) + opt('l', 'ซ้าย', p.lp) + opt('r', 'ขวา', p.lp) + '</select></label></div>' +
      '<div class="sec"><div class="st">เพิ่มญาติ</div><div class="btns">' +
      '<button data-act="spouse">+ คู่สมรส</button><button data-act="child" data-v="M">+ ลูกชาย</button><button data-act="child" data-v="F">+ ลูกหญิง</button>' +
      '<button data-act="parents"' + (p.from ? ' disabled' : '') + '>+ พ่อแม่</button><button data-act="sib" data-v="M">+ พี่น้องชาย</button><button data-act="sib" data-v="F">+ พี่น้องหญิง</button></div></div>' +
      '<div class="sec"><div class="st">เชื่อมกับคนอื่น</div><select id="linktype" style="width:100%;max-width:none">' + linkOptions() + '</select><div class="btns"><button class="pri" data-act="link">เลือกคนที่จะเชื่อม</button>' + (p.tw ? '<button data-act="untwin">ยกเลิกแฝด</button>' : '') + '</div></div>' +
      '<div class="sec"><button class="dng" data-act="del">ลบคนนี้</button></div>';
  } else if (sel.k === 'u') {
    var u = s;
    h += '<div class="sec"><div class="st">เส้นคู่ชีวิต</div><label>ประเภท<select data-f="t">' + Object.keys(GE.UT).map(function (k) { return opt(k, GE.UT[k], u.t); }).join('') + '</select></label>' +
      '<label>ความลึกของเส้น<input type="range" data-f="dp" min="0" max="70" value="' + (u.dp || 0) + '"></label>' +
      '<div class="btns"><button data-act="uchild" data-v="M">+ ลูกชาย</button><button data-act="uchild" data-v="F">+ ลูกหญิง</button></div></div>' +
      '<div class="sec"><button class="dng" data-act="del">ลบเส้นคู่ชีวิตนี้</button></div>';
  } else if (sel.k === 'r') {
    var r = s;
    h += '<div class="sec"><div class="st">ความสัมพันธ์</div><label>ประเภท<select data-f="t">' + Object.keys(GE.RELS).map(function (k) { return opt(k, GE.RELS[k], r.t); }).join('') + '</select></label>' +
      '<p class="mut">ลากจุดวงกลมสีส้มกลางเส้นเพื่อปรับความโค้ง</p>' +
      '<div class="btns" style="margin-top:8px"><button data-act="swap">สลับทิศลูกศร</button><button data-act="straight">ทำให้ตรง</button></div></div><div class="sec"><button class="dng" data-act="del">ลบเส้นนี้</button></div>';
  } else {
    h += '<div class="sec"><div class="st">วงสมาชิกที่อยู่ด้วยกัน</div><button class="dng" data-act="del">ลบวงนี้</button></div>';
  }
  panel.querySelector('#dyn').innerHTML = h; renderMode();
  var lg = $('#legend'); if (lg && !lg.dataset.k) { lg.innerHTML = GE.legendHTML({ persons: [], unions: [], rels: [], homes: [] }, { cm: cm }); lg.dataset.k = 1; }
}

var fieldSnap = null, fieldPushed = false;
function bindPanel() {
  panel.addEventListener('focusin', function (e) { if (e.target.matches('[data-f]')) { fieldSnap = snapStr(); fieldPushed = false; } });
  panel.addEventListener('focusout', function () { fieldSnap = null; });
  function onField(e) {
    var t = e.target; if (!t.matches) return;
    if (t.matches('[data-fm]')) {
      var k = t.getAttribute('data-fm'); fam[k] = t.type === 'checkbox' ? t.checked : t.value;
      if (k === 'title' || k === 'house') fillFamSel();
      draw(); save(); return;
    }
    if (t.matches('[data-cx]')) {
      var pr = t.getAttribute('data-cx').split('.'); fam.cx = fam.cx || {}; fam.cx[pr[0]] = fam.cx[pr[0]] || {}; fam.cx[pr[0]][pr[1]] = t.value;
      $('#legend').dataset.k = ''; draw(); save(); return;
    }
    if (!t.matches('[data-f]')) return;
    var s = findSel(); if (!s) return;
    if (!fieldPushed) { pushSnap(fieldSnap || snapStr()); fieldPushed = true; }
    var f = t.getAttribute('data-f'), v = t.type === 'checkbox' ? t.checked : t.value;
    if (f === 'dp') v = +v;
    if (f === 'byr') { v = String(v).replace(/\D/g, '').slice(0, 4); if (v !== t.value) t.value = v; if (v !== '') v = +v; }
    if (f === 'age' && /^\d{4}$/.test(String(v)) && +v >= 1800) { /* typed a birth year in the age box: move it */
      s.byr = +v > 2300 ? +v : +v + 543; delete s.age; draw(); save(); renderPanel(); toast('เป็นปีเกิด ย้ายไปช่อง “ปีเกิด” ให้แล้ว (อายุจะคำนวณเอง)');
      var bi = $('[data-f="byr"]', panel); if (bi) bi.focus(); return;
    }
    if (v === '' || v === false) { if (f !== 'name' && f !== 'note') { delete s[f]; v = undefined; } }
    if (v !== undefined) s[f] = v;
    draw(); save();
    if (e.type === 'change' && (f === 't' || f === 'sex' || f === 'st' || f === 'dead')) renderPanel();
  }
  panel.addEventListener('input', onField); panel.addEventListener('change', onField);
  panel.addEventListener('click', onAct); $('#modebar').addEventListener('click', onAct); $('#nag').addEventListener('click', onAct);
}
function onAct(e) {
  var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  var act = b.getAttribute('data-act'), v = b.getAttribute('data-v'), s = findSel(), c, ctr_ = svgCenter();
  if (act === 'bkdl') { downloadBackup(); return; }
  if (act === 'bkopen') { openBackup(); return; }
  if (act === 'new') { pushSnap(); var p = addPerson(v, freeSpot(ctr_.x, ctr_.y), ctr_.y); sel = { k: 'p', id: p.id }; }
  else if (act === 'homemode') { mode = { kind: 'home', ids: [] }; }
  else if (act === 'homedone') { if (mode.ids.length) { pushSnap(); var h = { id: newId('h'), ids: mode.ids.slice() }; state.homes.push(h); sel = { k: 'h', id: h.id }; } mode = null; }
  else if (act === 'cancel') { mode = null; }
  else if (act === 'color' && s) { pushSnap(); s.c = +v; }
  else if (act === 'cond' && s) { pushSnap(); var a = s.cond || []; var i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); if (a.length) s.cond = a; else delete s.cond; }
  else if (act === 'autoalias' && s) { pushSnap(); s.alias = GE.autoAlias(s.name); }
  else if (act === 'spouse' && s) { pushSnap(); addSpouse(s); }
  else if (act === 'child' && s) { pushSnap(); c = addChildOf(s, v); sel = { k: 'p', id: c.id }; }
  else if (act === 'uchild' && s) { pushSnap(); c = addChildTo(s, v); sel = { k: 'p', id: c.id }; }
  else if (act === 'parents' && s) { pushSnap(); addParents(s); }
  else if (act === 'sib' && s) { pushSnap(); c = addSibling(s, v); sel = { k: 'p', id: c.id }; }
  else if (act === 'link' && s) { startLink(s.id, $('#linktype').value); return; }
  else if (act === 'untwin' && s) { pushSnap(); var o = state.persons.filter(function (z) { return z.id === s.tw; })[0]; if (o) { delete o.tw; delete o.twi; } delete s.tw; delete s.twi; }
  else if (act === 'straight' && s) { pushSnap(); s.bend = 0; }
  else if (act === 'swap' && s) { pushSnap(); var tmp = s.a; s.a = s.b; s.b = tmp; }
  else if (act === 'del') { doDelete(); return; }
  else if (act === 'mdel') { doDeleteMulti(); return; }
  else if (act === 'mclear') { msel = {}; }
  else if (act === 'mcolor') { pushSnap(); Object.keys(msel).forEach(function (id) { var q = ixOf()[id]; if (q) q.c = +v; }); }
  else if (act === 'malign') {
    pushSnap(); var ps = Object.keys(msel).map(function (id) { return ixOf()[id]; }).filter(Boolean), ay = Math.round(ps.reduce(function (a, q) { return a + q.y; }, 0) / ps.length / 10) * 10; ps.forEach(function (q) { q.y = ay; });
  }
  else if (act === 'mdist') {
    var qs = Object.keys(msel).map(function (id) { return ixOf()[id]; }).filter(Boolean).sort(function (a, b) { return a.x - b.x; });
    if (qs.length > 2) { pushSnap(); var x0 = qs[0].x, x1 = qs[qs.length - 1].x; qs.forEach(function (q, i) { q.x = Math.round((x0 + (x1 - x0) * i / (qs.length - 1)) / 10) * 10; }); }
  }
  renderPanel(); draw(); save();
}

/* ================= pointer ================= */
var drag = null, ptrs = {}, pinch = null, nudgeT = 0;
function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
function bindCanvas() {
  svg.addEventListener('pointerdown', function (e) {
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (Object.keys(ptrs).length === 2) {
      var k = Object.keys(ptrs), a = ptrs[k[0]], b = ptrs[k[1]];
      pinch = { d0: dist(a, b) || 1, w0: view.w, v0: { x: view.x, y: view.y }, c: pt({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }) }; drag = null; hideMq(); return;
    }
    if (e.button > 0) return;
    var tg = e.target.closest && e.target.closest('[data-pid],[data-uid],[data-rid],[data-hid],[data-bh]'), q = pt(e);
    if (mode) {
      if (tg && tg.getAttribute('data-pid')) {
        var id = tg.getAttribute('data-pid');
        if (mode.kind === 'home') { var i = mode.ids.indexOf(id); if (i >= 0) mode.ids.splice(i, 1); else mode.ids.push(id); renderPanel(); draw(); }
        else if (mode.kind === 'link') { if (!mode.from) { mode.from = id; renderPanel(); draw(); } else finishLink(id); }
      }
      return;
    }
    if (tg && tg.getAttribute('data-bh')) { drag = { k: 'bend', id: tg.getAttribute('data-bh'), snap: snapStr(), moved: false }; }
    else if (tg && tg.getAttribute('data-pid')) {
      var pid = tg.getAttribute('data-pid');
      if (e.shiftKey || selMode) {
        if (sel && sel.k === 'p' && sel.id !== pid) { msel[sel.id] = 1; } sel = null;
        if (msel[pid]) delete msel[pid]; else msel[pid] = 1; renderPanel(); draw(); return;
      }
      var set;
      if (msel[pid] && Object.keys(msel).length > 1) set = msel;
      else { if (!msel[pid]) { msel = {}; select({ k: 'p', id: pid }); } set = $('#branch').checked ? branchSet(pid) : (function () { var o = {}; o[pid] = 1; return o; })(); }
      var orig = {}; state.persons.forEach(function (p) { if (set[p.id]) orig[p.id] = { x: p.x, y: p.y }; });
      drag = { k: 'p', id: pid, q0: q, orig: orig, moved: false, snap: snapStr() };
    } else if (tg && tg.getAttribute('data-uid')) select({ k: 'u', id: tg.getAttribute('data-uid') });
    else if (tg && tg.getAttribute('data-rid')) select({ k: 'r', id: tg.getAttribute('data-rid') });
    else if (tg && tg.getAttribute('data-hid')) select({ k: 'h', id: tg.getAttribute('data-hid') });
    else {
      if (e.shiftKey || selMode) { drag = { k: 'mq', c0: { x: e.clientX, y: e.clientY } }; }
      else { var had = sel || Object.keys(msel).length; sel = null; msel = {}; if (had) { renderPanel(); draw(); } drag = { k: 'pan', c0: { x: e.clientX, y: e.clientY }, v0: { x: view.x, y: view.y } }; }
    }
    if (drag) { try { svg.setPointerCapture(e.pointerId); } catch (_) { } }
  });
  svg.addEventListener('pointermove', function (e) {
    if (ptrs[e.pointerId]) { ptrs[e.pointerId].x = e.clientX; ptrs[e.pointerId].y = e.clientY; }
    if (pinch) {
      var k = Object.keys(ptrs); if (k.length < 2) return;
      var d = dist(ptrs[k[0]], ptrs[k[1]]) || 1, nw = Math.max(200, Math.min(12000, pinch.w0 * pinch.d0 / d)), r = nw / pinch.w0;
      view.w = nw; view.x = pinch.c.x - (pinch.c.x - pinch.v0.x) * r; view.y = pinch.c.y - (pinch.c.y - pinch.v0.y) * r; setVB(); showZoom(); return;
    }
    if (!drag) return;
    if (drag.k === 'pan') { var kk = view.w / svg.clientWidth; view.x = drag.v0.x - (e.clientX - drag.c0.x) * kk; view.y = drag.v0.y - (e.clientY - drag.c0.y) * kk; setVB(); return; }
    if (drag.k === 'mq') {
      var w = $('.cvwrap').getBoundingClientRect(), mq = $('#mq');
      mq.style.display = 'block'; mq.style.left = Math.min(drag.c0.x, e.clientX) - w.left + 'px'; mq.style.top = Math.min(drag.c0.y, e.clientY) - w.top + 'px';
      mq.style.width = Math.abs(e.clientX - drag.c0.x) + 'px'; mq.style.height = Math.abs(e.clientY - drag.c0.y) + 'px'; drag.c1 = { x: e.clientX, y: e.clientY }; return;
    }
    if (drag.k === 'bend') {
      var rr = state.rels.filter(function (z) { return z.id === drag.id; })[0]; if (!rr) return;
      var g = GE.relGeom(rr, ixOf()); if (!g) return; var q = pt(e);
      if (!drag.moved) { drag.moved = true; pushSnap(drag.snap); }
      var bnd = 2 * ((q.x - g.mid[0]) * g.nrm[0] + (q.y - g.mid[1]) * g.nrm[1]); if (Math.abs(bnd) < 14) bnd = 0; rr.bend = Math.round(bnd); draw(); return;
    }
    var q2 = pt(e), dx = q2.x - drag.q0.x, dy = q2.y - drag.q0.y;
    if (!drag.moved) { if (Math.abs(dx) + Math.abs(dy) < 4) return; drag.moved = true; pushSnap(drag.snap); }
    var o = drag.orig[drag.id], nx = Math.round((o.x + dx) / 10) * 10, ny = Math.round((o.y + dy) / 10) * 10, ddx = nx - o.x, ddy = ny - o.y;
    state.persons.forEach(function (p) { var s0 = drag.orig[p.id]; if (s0) { p.x = s0.x + ddx; p.y = s0.y + ddy; } });
    draw();
  });
  function hideMq() { var mq = $('#mq'); if (mq) mq.style.display = 'none'; }
  function end(e) {
    delete ptrs[e.pointerId]; if (Object.keys(ptrs).length < 2) pinch = null;
    if (drag && drag.k === 'mq') {
      hideMq();
      if (drag.c1) {
        var a = pt({ clientX: drag.c0.x, clientY: drag.c0.y }), b = pt({ clientX: drag.c1.x, clientY: drag.c1.y }), x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
        if (!e.shiftKey && !selMode) msel = {}; sel = null;
        state.persons.forEach(function (p) { if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) msel[p.id] = 1; });
      } else { msel = {}; }
      renderPanel(); draw();
    } else if (drag && (drag.k === 'p' || drag.k === 'bend') && drag.moved) save();
    drag = null;
  }
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', function (e) { e.preventDefault(); var q = pt(e); zoomAt(e.deltaY < 0 ? 0.87 : 1.15, q.x, q.y); }, { passive: false });
  svg.addEventListener('dblclick', function (e) {
    var tg = e.target.closest && e.target.closest('[data-pid]'); if (!tg || mode) return;
    select({ k: 'p', id: tg.getAttribute('data-pid') });
    setTimeout(function () { var i = $('[data-f="name"]', panel); if (i) { i.focus(); i.select(); } }, 30);
  });
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { if (mode) { mode = null; renderPanel(); draw(); } else if (sel || Object.keys(msel).length) { sel = null; msel = {}; renderPanel(); draw(); } }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); persistNow(); toast('บันทึกในเครื่องแล้ว'); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) { if (Object.keys(msel).length) { e.preventDefault(); doDeleteMulti(); } else if (sel) { e.preventDefault(); doDelete(); } }
    if (!typing && !mode && /^Arrow/.test(e.key) && (sel && sel.k === 'p' || Object.keys(msel).length)) {
      e.preventDefault(); var st = e.shiftKey ? 50 : 10, dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
      if (Date.now() - nudgeT > 900) pushSnap(); nudgeT = Date.now();
      var ids = Object.keys(msel).length ? msel : (function () { var o = {}; o[sel.id] = 1; return o; })();
      state.persons.forEach(function (p) { if (ids[p.id]) { p.x += dx; p.y += dy; } }); draw(); save();
    }
  });
}

/* ================= families ================= */
function fillFamSel() {
  var s = $('#famSel'); s.innerHTML = liveFams().map(function (f) { return '<option value="' + f.id + '"' + (fam && f.id === fam.id ? ' selected' : '') + '>' + esc(famLabel(f)) + '</option>'; }).join('');
}
function setActive(id, noFit) {
  var f = project.families.filter(function (x) { return x.id === id && !x.deleted; })[0] || liveFams()[0];
  if (!f) { f = newFam('ครอบครัวที่ 1'); project.families.push(f); }
  if (fam && dirty) persistNow();
  fam = f; state = fam.state; undoS = undoMap[fam.id] = undoMap[fam.id] || []; redoS = redoMap[fam.id] = redoMap[fam.id] || [];
  sel = null; msel = {}; mode = null;
  fillFamSel(); renderPanel(); draw(); if (!noFit) fit(); updUR();
  try { localStorage.setItem('gm2_active', fam.id); } catch (e) { }
  Store.listSnaps(fam.id).then(function (a) { if (state.persons.length && (!a.length || Date.now() - a[0].at > 1800000)) { lastSnapAt = Date.now(); Store.addSnap(fam.id, snapStr(), 'เปิดผัง', state.persons.length).catch(function () { }); } }).catch(function () { });
}
function addFamily(title, st) {
  var f = newFam(title || 'ครอบครัวที่ ' + (liveFams().length + 1)); if (st) f.state = normalize(st);
  project.families.push(f); setActive(f.id); fam.updated = Date.now(); dirty = true; persistNow(); mirrorNow(); return f;
}
function dupFamily() { var f = clone(fam); f.id = newFam().id; f.title = (fam.title || 'ผัง') + ' (สำเนา)'; f.created = f.updated = Date.now(); project.families.push(f); setActive(f.id); dirty = true; persistNow(); mirrorNow(); toast('ทำสำเนาแล้ว'); }
function delFamily() {
  if (!confirm('ย้ายผัง “' + famLabel(fam) + '” ไปถังขยะ?\n(ยังกู้คืนได้ที่ปุ่ม “สำรอง / กู้คืน” → ถังขยะ)')) return;
  var id = fam.id; fam.deleted = Date.now(); fam.updated = Date.now(); dirty = true; persistNow(); mirrorNow();
  var next = liveFams()[0]; if (!next) { next = newFam('ครอบครัวที่ 1'); project.families.push(next); next.updated = Date.now(); Store.putFamily(next).catch(function () { }); }
  setActive(next.id); toast('ย้ายไปถังขยะแล้ว', 'เลิกทำ', function () { var f = project.families.filter(function (x) { return x.id === id; })[0]; if (f) { delete f.deleted; f.updated = Date.now(); Store.putFamily(f).catch(function () { }); mirrorNow(); fillFamSel(); setActive(id); } });
}

/* ================= sample ================= */
function makeSample() {
  var P = [], U = [], R = [], Hm = [];
  function p(id, name, sex, x, y, ex) { var o = { id: id, name: name, sex: sex, x: x, y: y, c: 0 }; for (var k in ex || {}) o[k] = ex[k]; P.push(o); }
  p('a1', 'ตาบุญ มั่นคง', 'M', 150, 70, { c: 1, dead: 1, age: '78', cod: 'โรคหัวใจ', cond: ['cvd'], alias: 'บ.ม.' });
  p('a2', 'ยายคำ มั่นคง', 'F', 280, 70, { c: 1, byr: 2488, cond: ['dm', 'ht'], alias: 'ค.ม.' });
  p('b1', 'ปู่สุข สุขใจ', 'M', 520, 70, { c: 1, dead: 1, age: '82', cod: 'ชราภาพ', alias: 'ส.ส.' });
  p('b2', 'ย่าทอง สุขใจ', 'F', 650, 70, { c: 1, dead: 1, age: '70', cod: 'มะเร็ง', cond: ['ca'], alias: 'ท.ส.' });
  p('m0h', 'ชาญ', 'M', -60, 230, { c: 2, byr: 2513, alias: 'ช.' });
  p('m0', 'สมใจ มั่นคง', 'F', 70, 230, { c: 2, byr: 2515, from: 'u1', alias: 'ส.ม.' });
  p('m1', 'สมศรี สุขใจ', 'F', 330, 230, { c: 2, byr: 2517, cond: ['ht'], from: 'u1', alias: 'ส.ส.' });
  p('f1', 'สมชาย สุขใจ', 'M', 460, 230, { c: 2, byr: 2514, cond: ['dm', 'alc'], from: 'u2', alias: 'ส.ส.', note: 'เกษตรกร' });
  p('f2', 'สมพงษ์ สุขใจ', 'M', 740, 230, { c: 2, byr: 2519, from: 'u2', alias: 'ส.ส.' });
  p('x1', 'พรทิพย์', 'F', 880, 230, { c: 2, byr: 2521, alias: 'พ.' });
  p('k1', 'ก้อง สุขใจ', 'M', 330, 400, { c: 3, byr: 2540, from: 'u3', tw: 'k2', twi: 0, alias: 'ก.ส.' });
  p('k2', 'ใบเตย สุขใจ', 'F', 460, 400, { c: 3, byr: 2540, from: 'u3', tw: 'k1', st: 'pt', cond: ['dm'], alias: 'ใ.ส.', note: 'ผู้ให้ข้อมูลหลัก' });
  p('k3', 'น้องเล็ก', 'M', 590, 400, { c: 3, byr: 2550, from: 'u3', adopted: 1, alias: 'น.' });
  p('k4', 'ต้น สุขใจ', 'M', 810, 400, { c: 3, byr: 2545, from: 'u4', alias: 'ต.ส.' });
  U.push({ id: 'u1', a: 'a1', b: 'a2', t: 'married' }, { id: 'u2', a: 'b1', b: 'b2', t: 'married' }, { id: 'u3', a: 'm1', b: 'f1', t: 'married' }, { id: 'u4', a: 'f2', b: 'x1', t: 'divorced' }, { id: 'u5', a: 'm0', b: 'm0h', t: 'cohab' });
  R.push({ id: 'r1', a: 'm0', b: 'm1', t: 'vclose', bend: -70 }, { id: 'r2', a: 'k4', b: 'f1', t: 'conflict', bend: -110 });
  Hm.push({ id: 'h1', ids: ['m1', 'f1', 'k1', 'k2', 'k3'] });
  return { v: 2, persons: P, unions: U, rels: R, homes: Hm };
}

/* ================= export ================= */
var PAPERS = { a4l: { n: 'A4 แนวนอน', w: 297, h: 210 }, a4p: { n: 'A4 แนวตั้ง', w: 210, h: 297 }, a3l: { n: 'A3 แนวนอน', w: 420, h: 297 }, a3p: { n: 'A3 แนวตั้ง', w: 297, h: 420 }, auto: { n: 'ตามขนาดผัง (ไม่กำหนดกระดาษ)', w: 0, h: 0 } };
function expOpts() {
  var e = fam.exp = fam.exp || {};
  var d = { title: true, legend: true, gen: fam.gen !== false, alias: true, paper: 'a4l', margin: 15, subtitle: true };
  for (var k in d) if (e[k] === undefined) e[k] = d[k];
  return e;
}
function measure(inner) {
  var t = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  t.setAttribute('style', 'position:absolute;left:-99999px;top:0;width:100px;height:100px;visibility:hidden');
  t.innerHTML = '<g>' + inner + '</g>'; document.body.appendChild(t);
  var bb; try { bb = t.firstChild.getBBox(); } catch (e) { bb = { x: 0, y: 0, width: 800, height: 500 }; }
  t.remove(); return { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
}
function buildExport(o) {
  var ctx = ctxFor(fam, { alias: o.alias, gen: o.gen, pre: 'x_', nosel: true });
  var content = GE.inner(state, ctx), bb = measure(content);
  var padv = 26, items = o.legend ? GE.legendItems(state, ctx, false) : [], cw = Math.max(bb.w, 560), parts = '', y = padv;
  var title = o.title && fam.title ? fam.title : '', sub = [];
  if (o.title && o.subtitle) { if (fam.house) sub.push('บ้านเลขที่ ' + fam.house); if (fam.place) sub.push(fam.place); if (fam.date) sub.push('ข้อมูล ณ วันที่ ' + thaiDate(fam.date)); }
  if (title) { y += 22; parts += '<text x="' + (cw / 2 + padv) + '" y="' + y + '" text-anchor="middle" font-size="22" font-weight="600" fill="#1f2a44">' + esc(title) + '</text>'; y += 8; }
  if (sub.length) { y += 18; parts += '<text x="' + (cw / 2 + padv) + '" y="' + y + '" text-anchor="middle" font-size="14" fill="#4a5d80">' + esc(sub.join('   ·   ')) + '</text>'; y += 6; }
  if (title || sub.length) y += 14;
  var ox = padv + (cw - bb.w) / 2 - bb.x, oy = y - bb.y;
  parts += '<g transform="translate(' + ox.toFixed(1) + ',' + oy.toFixed(1) + ')">' + content + '</g>'; y += bb.h + 22;
  if (items.length) {
    parts += '<line x1="' + padv + '" y1="' + y + '" x2="' + (padv + cw) + '" y2="' + y + '" stroke="#d6d0bd" stroke-width="1"/>'; y += 22;
    parts += '<text x="' + padv + '" y="' + y + '" font-size="14" font-weight="600" fill="#1f2a44">สัญลักษณ์</text>'; y += 8;
    var lx = 0, ly = 0, rowH = 46;
    items.forEach(function (it) {
      var w = 66 + 8 + Math.min(300, it.label.length * 7.4) + 22;
      if (lx > 0 && lx + w > cw) { lx = 0; ly += rowH; }
      parts += '<g transform="translate(' + (padv + lx) + ',' + (y + ly) + ')">' + it.svg + '<text x="74" y="27" font-size="12.5" fill="#1f2a44">' + esc(it.label) + '</text></g>';
      lx += w;
    });
    y += ly + rowH;
  }
  var W = Math.round(cw + 2 * padv), Ht = Math.round(y + padv - 10);
  function build(wA, hA) { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + Ht + '" width="' + wA + '" height="' + hA + '" font-family="' + GE.FONT.replace(/"/g, "'") + '"><style>' + fontCss() + '</style><rect width="' + W + '" height="' + Ht + '" fill="#fff"/>' + parts + '</svg>'; }
  var P = PAPERS[o.paper] || PAPERS.auto, s = null, minPt = null, A = P.w ? P : PAPERS.a4l;
  if (P.w) { s = Math.min((P.w - 2 * o.margin) / W, (P.h - 2 * o.margin) / Ht, 0.35); minPt = 12.5 * s * 72 / 25.4; }
  var miss = state.persons.filter(function (p) { return p.name && !String(p.alias || '').trim(); }).length;
  return { build: build, W: W, H: Ht, s: s, minPt: minPt, paper: P, A: A, missingAlias: miss, svg: build(W, Ht) };
}
function dl(name, blob) {
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 1500);
}
function fname(ext) { return (fam.title || 'genogram').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60) + '.' + ext; }
function renderExportDialog() {
  var o = expOpts(), r = buildExport(o), box = $('#expOpts');
  function ck(k, t) { return '<label class="ck"><input type="checkbox" data-eo="' + k + '"' + (o[k] ? ' checked' : '') + '> ' + t + '</label>'; }
  box.innerHTML = '<div class="st">ตัวเลือก</div>' + ck('title', 'หัวเรื่อง') + ck('subtitle', 'บ้านเลขที่ / ที่ตั้ง / วันที่ใต้หัวเรื่อง') + ck('legend', 'คำอธิบายสัญลักษณ์ (เฉพาะที่ใช้ในผัง)') + ck('gen', 'ป้ายรุ่น I, II, III') + ck('alias', 'ใช้ “ตัวย่อ” แทนชื่อจริง (แนะนำสำหรับรายงาน)') +
    (o.alias && r.missingAlias ? '<div class="warnbox">มี ' + r.missingAlias + ' คนที่ยังไม่ตั้งตัวย่อ — ระบบใช้ตัวย่อที่สร้างอัตโนมัติจากชื่อให้ (ตรวจดูก่อนส่ง)</div>' : '') +
    (!o.alias ? '<div class="warnbox">กำลังจะแสดง<b>ชื่อจริง</b>ของชาวบ้านในรูป — ตรวจว่ารายงานอนุญาตหรือไม่</div>' : '') +
    '<label>ขนาดกระดาษ<select data-eo="paper">' + Object.keys(PAPERS).map(function (k) { return opt(k, PAPERS[k].n, o.paper); }).join('') + '</select></label>' +
    '<label>ขอบกระดาษ (มม.)<input type="number" min="0" max="40" data-eo="margin" value="' + o.margin + '"></label>' +
    '<div class="btns" style="margin-top:10px"><button class="pri" data-ex="pdf">พิมพ์ / บันทึกเป็น PDF</button><button data-ex="png">ดาวน์โหลด PNG</button><button data-ex="svg">ดาวน์โหลด SVG</button></div>' +
    '<p class="note" style="margin-top:8px">PDF เป็นเวกเตอร์ (คมที่สุด) — ในหน้าต่างพิมพ์ให้เลือกปลายทาง “บันทึกเป็น PDF” และปิด “หัวกระดาษและท้ายกระดาษ”<br>PNG ความละเอียด 300 dpi ตามขนาดกระดาษ ใช้แทรกใน Word ได้ · SVG ไม่ควรใช้ใน Word</p>';
  $('#expPv').innerHTML = r.svg;
  var info = 'ขนาดภาพ ' + r.W + '×' + r.H + ' หน่วย';
  if (r.minPt != null) {
    info += ' · ตัวอักษรเล็กสุดเมื่อพิมพ์ ≈ <b>' + r.minPt.toFixed(1) + ' pt</b>';
    if (r.minPt < 7.5) info += '<div class="warnbox">ตัวอักษรเล็กไปจนอ่านยากในเล่ม — ลองเลือก A3 / เปลี่ยนแนวกระดาษ / ปิด “หมายเหตุ” / ใช้ “จัดวาง” ให้ผังกระชับขึ้น หรือแยกเป็นหลายผัง</div>';
    else info += '<div class="okbox">อ่านได้สบายเมื่อพิมพ์ในขนาดนี้ (ควรไม่ต่ำกว่า 8 pt)</div>';
  }
  $('#expInfo').innerHTML = info; return r;
}
function openExport() { persistNow(); renderExportDialog(); $('#dExp').showModal(); }
function doPng(r, o) {
  var k = r.s ? r.s / 25.4 * 300 : 2; k = Math.min(k, 9000 / Math.max(r.W, r.H));
  var url = URL.createObjectURL(new Blob([r.build(r.W, r.H)], { type: 'image/svg+xml;charset=utf-8' })), img = new Image();
  img.onload = function () {
    (img.decode ? img.decode() : Promise.resolve()).catch(function () { }).then(function () {
      var c = document.createElement('canvas'); c.width = Math.round(r.W * k); c.height = Math.round(r.H * k);
      var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(function (b) { if (b) { dl(fname('png'), b); toast('สร้าง PNG แล้ว (' + c.width + '×' + c.height + ' px)'); } else toast('สร้าง PNG ไม่ได้ — ใช้ PDF หรือ SVG แทน'); }, 'image/png');
    });
  };
  img.onerror = function () { toast('สร้าง PNG ไม่ได้ — ใช้ PDF หรือ SVG แทน'); };
  img.src = url;
}
function doPrint(r, o) {
  var A = r.A, m = o.margin, wmm = A.w - 2 * m, hmm = A.h - 2 * m, s = Math.min(wmm / r.W, hmm / r.H, 0.35), w = r.W * s, h = r.H * s;
  var st = $('#pageCss'); if (!st) { st = document.createElement('style'); st.id = 'pageCss'; document.head.appendChild(st); }
  st.textContent = '@page{size:' + A.w + 'mm ' + A.h + 'mm;margin:0}';
  $('#printArea').innerHTML = '<div style="width:' + A.w + 'mm;height:' + A.h + 'mm;display:flex;align-items:center;justify-content:center;overflow:hidden">' + r.build(w.toFixed(2) + 'mm', h.toFixed(2) + 'mm') + '</div>';
  $('#dExp').close(); setTimeout(function () { window.print(); }, 150);
}
window.addEventListener('afterprint', function () { var a = $('#printArea'); if (a) a.innerHTML = ''; });

/* ================= backup dialog ================= */
function downloadBackup() { dl('genogram-สำรอง-' + stamp() + '.json', new Blob([JSON.stringify(bundle())], { type: 'application/json' })); markBackup(); toast('ดาวน์โหลดไฟล์สำรองแล้ว — เก็บไว้ในที่ที่ปลอดภัย (เช่น Google Drive / ส่งเข้าไลน์ตัวเอง)'); }
function importText(t) {
  var j; try { j = JSON.parse(t); } catch (e) { toast('นำเข้าไม่ได้: ไฟล์ไม่ใช่ JSON'); return; }
  var added = 0;
  if (j && j.app === 'genogram-maker' && Array.isArray(j.families)) {
    j.families.forEach(function (f) {
      f = normFam(f); if (project.families.some(function (x) { return x.id === f.id; })) { f.id = newFam().id; f.title = (f.title || 'ผัง') + ' (นำเข้า)'; }
      delete f.deleted; f.updated = Date.now(); project.families.push(f); Store.putFamily(f).catch(function () { }); added++;
    });
  } else if (j && Array.isArray(j.persons)) {
    var f = newFam('ผังที่นำเข้า'); f.state = normalize(j); project.families.push(f); Store.putFamily(f).catch(function () { }); added = 1;
  } else { toast('นำเข้าไม่ได้: ไม่ใช่ไฟล์ของ Genogram Maker'); return; }
  mirrorNow(); fillFamSel(); toast('นำเข้า ' + added + ' ผังแล้ว (เพิ่มเป็นผังใหม่ ไม่ทับของเดิม)'); renderBackup();
}
function openBackup() { renderBackup(); if (!$('#dBk').open) $('#dBk').showModal(); }
function renderBackup() {
  var box = $('#bkBody'); if (!box) return;
  Promise.all([Store.listSnaps(fam.id).catch(function () { return []; }), Store.estimate()]).then(function (res) {
    var snaps = res[0], est = res[1], trash = project.families.filter(function (f) { return f.deleted; });
    var fsTxt = fsState === 'ok' ? '<div class="okbox">เชื่อมไฟล์อยู่ — บันทึกอัตโนมัติทุกครั้งที่แก้</div>' : fsState === 'need' ? '<div class="warnbox">ต้องอนุญาตการเขียนไฟล์อีกครั้ง <button data-bk="reperm">อนุญาต</button></div>' : fsState === 'err' ? '<div class="warnbox">เขียนไฟล์ไม่ได้ ลองเชื่อมใหม่</div>' : '';
    box.innerHTML =
      '<div class="st">1) สำรองเป็นไฟล์ (สำคัญที่สุด)</div><p class="note">ข้อมูลถูกเก็บอัตโนมัติในเบราว์เซอร์นี้ 3 ชั้น (IndexedDB + สำเนา localStorage + ประวัติย้อนหลัง) แต่ถ้าล้างข้อมูลเบราว์เซอร์/เปลี่ยนเครื่อง ข้อมูลจะหาย จึงควรมีไฟล์สำรองไว้เสมอ</p>' +
      '<div class="btns"><button class="pri" data-bk="dl">ดาวน์โหลดไฟล์สำรองทุกผัง (.json)</button><button data-bk="dl1">เฉพาะผังนี้</button>' + (fsh ? '<button data-bk="unlink">เลิกเชื่อมไฟล์</button>' : '<button data-bk="link">เชื่อมไฟล์สำรองอัตโนมัติ (Chrome/Edge)</button>') + '</div>' + fsTxt +
      '<p class="note">สำรองล่าสุด: ' + (backupAt ? hhmm(backupAt) + ' (' + ago(backupAt) + ')' : 'ยังไม่เคย') + ' · ที่เก็บถาวร: ' + (persisted === true ? '✓ ขอสิทธิ์แล้ว (เบราว์เซอร์จะไม่ลบเอง)' : persisted === false ? 'ยังไม่ได้รับสิทธิ์ (เสี่ยงถูกลบเมื่อพื้นที่เต็ม)' : 'ตรวจสอบไม่ได้') + (Store.idb ? '' : ' · <b style="color:#c0392b">IndexedDB ใช้ไม่ได้ ใช้สำเนา localStorage อย่างเดียว</b>') + (est && est.usage ? ' · ใช้พื้นที่ ' + Math.round(est.usage / 1024) + ' KB' : '') + '</p>' +
      '<div class="st" style="margin-top:14px">2) นำเข้า</div><div class="btns"><input type="file" id="bkFile" accept=".json,application/json"></div><p class="note">นำเข้าไฟล์สำรอง หรือไฟล์ผังจาก Genogram Maker เวอร์ชันเก่า — จะเพิ่มเป็นผังใหม่ ไม่ทับของเดิม</p>' +
      '<div class="st" style="margin-top:14px">3) ประวัติอัตโนมัติของผังนี้ (' + esc(famLabel(fam)) + ')</div>' + (snaps.length ? '<div class="list">' + snaps.map(function (s) { return '<div class="r"><span>' + new Date(s.at).toLocaleString('th-TH') + ' · ' + s.n + ' คน · ' + esc(s.reason) + '</span><button data-bk="snap" data-sid="' + s.sid + '">กู้คืนผังนี้</button></div>'; }).join('') + '</div><p class="note">กู้คืนแล้วสถานะปัจจุบันจะถูกเก็บเป็นประวัติก่อน — กู้กลับได้</p>' : '<p class="note">ยังไม่มีประวัติ (ระบบเก็บให้ทุก ~3 นาทีที่มีการแก้ไข สูงสุด 40 จุดต่อผัง)</p>') +
      '<div class="st" style="margin-top:14px">4) ถังขยะ</div>' + (trash.length ? '<div class="list">' + trash.map(function (f) { return '<div class="r"><span>' + esc(famLabel(f)) + ' · ' + f.state.persons.length + ' คน</span><button data-bk="restore" data-id="' + f.id + '">กู้คืน</button><button class="dng" data-bk="purge" data-id="' + f.id + '">ลบถาวร</button></div>'; }).join('') + '</div>' : '<p class="note">ว่าง</p>');
  });
}
function bkClick(e) {
  var b = e.target.closest('[data-bk]'); if (!b) return; var a = b.getAttribute('data-bk');
  if (a === 'dl') downloadBackup();
  else if (a === 'dl1') { dl(fname('json'), new Blob([JSON.stringify({ app: 'genogram-maker', v: 2, saved: new Date().toISOString(), families: [clone(fam)] })], { type: 'application/json' })); markBackup(); toast('ดาวน์โหลดแล้ว'); }
  else if (a === 'link') linkFile();
  else if (a === 'unlink') unlinkFile();
  else if (a === 'reperm') writeFs(true).then(renderBackup);
  else if (a === 'snap') {
    var sid = +b.getAttribute('data-sid');
    Store.listSnaps(fam.id).then(function (L) {
      var s = L.filter(function (x) { return x.sid === sid; })[0]; if (!s) return;
      maybeSnap(true, 'ก่อนกู้คืน'); pushSnap(); state = fam.state = normalize(JSON.parse(s.data)); afterLoad(); fit(); toast('กู้คืนจากประวัติแล้ว (ย้อนกลับได้)'); renderBackup();
    });
  }
  else if (a === 'restore') { var f = project.families.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0]; if (f) { delete f.deleted; f.updated = Date.now(); Store.putFamily(f).catch(function () { }); mirrorNow(); fillFamSel(); renderBackup(); toast('กู้คืนผังแล้ว'); } }
  else if (a === 'purge') {
    if (!confirm('ลบถาวร? ไม่สามารถกู้คืนได้ (ยกเว้นมีไฟล์สำรอง)')) return;
    var id = b.getAttribute('data-id'); project.families = project.families.filter(function (x) { return x.id !== id; }); Store.delFamily(id).catch(function () { }); mirrorNow(); renderBackup();
  }
}

/* ================= help ================= */
function renderHelp() {
  $('#helpBody').innerHTML = '<div class="grid2" style="grid-template-columns:1fr 1fr"><div><div class="st">เริ่มวาด</div><ol class="note" style="padding-left:18px;margin:0"><li>กด “+ ชาย / + หญิง” (คนแรก)</li><li>คลิกที่คนนั้น แล้วกด “+ คู่สมรส / + ลูก / + พ่อแม่ / + พี่น้อง” — ระบบต่อเส้นให้เอง</li><li>ดับเบิลคลิกคนเพื่อพิมพ์ชื่อ ใส่อายุหรือปีเกิด ติ๊กโรค</li><li>ลากเพื่อจัดตำแหน่ง หรือใช้เมนู “⚙ จัดวาง” เพื่อให้แต่ละรุ่นอยู่แถวเดียวกัน</li><li>เส้นสนิท/ขัดแย้ง: เลือกชนิดจากเมนูบนแถบเครื่องมือ แล้วคลิกคนแรก-คนที่สอง ลากจุดสีส้มกลางเส้นเพื่อโค้ง</li></ol></div>' +
    '<div><div class="st">เมื่อจะลงเล่ม</div><ol class="note" style="padding-left:18px;margin:0"><li>ตั้ง “ตัวย่อ” ของแต่ละคน (ปุ่ม ตั้งอัตโนมัติ ช่วยได้) — รายงานไม่ควรมีชื่อจริงชาวบ้าน</li><li>ใส่หัวเรื่อง บ้านเลขที่ วันที่ในแผง “ข้อมูลผังนี้” (คลิกพื้นที่ว่าง)</li><li>กด “ส่งออก / พิมพ์” เลือกกระดาษ ดูค่า pt ว่าอ่านได้ → PDF หรือ PNG</li></ol>' +
    '<div class="st" style="margin-top:12px">ข้อมูลห้ามหาย</div><p class="note" style="margin:0">ระบบบันทึกอัตโนมัติทุกครั้งที่แก้ และเก็บประวัติย้อนหลัง แต่ข้อมูลอยู่ในเบราว์เซอร์นี้เท่านั้น <b>ให้กด “สำรอง / กู้คืน” แล้วดาวน์โหลดไฟล์ไว้เป็นระยะ</b> (หรือเชื่อมไฟล์อัตโนมัติใน Chrome/Edge) ข้อมูลไม่ถูกส่งไปที่ไหนเลย</p></div></div>' +
    '<p class="note" style="margin-top:10px">คีย์ลัด: Ctrl+Z ย้อนกลับ · Ctrl+Y ทำซ้ำ · Delete ลบ · ลูกศรขยับทีละ 10 (Shift = 50) · Shift+ลาก เลือกหลายคน · Esc ยกเลิก</p>';
}

/* ================= init ================= */
function init() {
  svg = $('#cv'); panel = $('#pn');
  bindPanel(); bindCanvas();
  $('#undo').onclick = undo; $('#redo').onclick = redo;
  $('#zi').onclick = function () { zoomAt(0.8); }; $('#zo').onclick = function () { zoomAt(1.25); }; $('#zf').onclick = fit;
  $('#reltool').innerHTML = '<option value="">＋ เส้นความสัมพันธ์ / คู่ชีวิต / แฝด</option>' + linkOptions();
  $('#reltool').onchange = function () { var v = this.value; this.value = ''; if (!v) return; mode = { kind: 'link', type: v, from: null, keep: true }; sel = null; msel = {}; renderPanel(); draw(); };
  $('#selmode').onclick = function () { selMode = !selMode; this.classList.toggle('on', selMode); this.textContent = selMode ? '☑ เลือกหลายคน (เปิดอยู่)' : '☐ เลือกหลายคน'; };
  $('#tidy').onchange = function () { var v = this.value; this.value = ''; if (v) tidy(v); };
  $('#famSel').onchange = function () { setActive(this.value); };
  $('#famNew').onclick = function () { addFamily(); };
  $('#famDup').onclick = dupFamily; $('#famDel').onclick = delFamily;
  $('#stat').onclick = function () { if (saveState === 'fail') downloadBackup(); else openBackup(); };
  $('#bk').onclick = openBackup; $('#exp').onclick = openExport; $('#help').onclick = function () { renderHelp(); $('#dHelp').showModal(); };
  $('#loadSample').onclick = function () { pushSnap(); maybeSnap(true, 'ก่อนโหลดตัวอย่าง'); state = fam.state = normalize(makeSample()); fam.title = fam.title || 'ตัวอย่าง: ผังเครือญาติ (ข้อมูลสมมติ)'; sel = null; fillFamSel(); afterLoad(); fit(); };
  document.querySelectorAll('dialog [data-close]').forEach(function (b) { b.onclick = function () { b.closest('dialog').close(); }; });
  document.querySelectorAll('dialog').forEach(function (d) { d.addEventListener('click', function (e) { if (e.target === d) d.close(); }); });
  $('#bkBody').addEventListener('click', bkClick);
  $('#bkBody').addEventListener('change', function (e) { if (e.target.id === 'bkFile') { var f = e.target.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { importText(r.result); }; r.readAsText(f); e.target.value = ''; } });
  $('#expOpts').addEventListener('change', function (e) { var k = e.target.getAttribute('data-eo'); if (!k) return; var o = expOpts(); o[k] = e.target.type === 'checkbox' ? e.target.checked : (e.target.type === 'number' ? Math.max(0, Math.min(40, +e.target.value || 0)) : e.target.value); touch(); renderExportDialog(); });
  $('#expOpts').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ex]'); if (!b) return; var o = expOpts(), r = buildExport(o), a = b.getAttribute('data-ex');
    if (a === 'svg') { dl(fname('svg'), new Blob([r.build(r.W, r.H)], { type: 'image/svg+xml' })); toast('ดาวน์โหลด SVG แล้ว'); }
    else if (a === 'png') doPng(r, o); else if (a === 'pdf') doPrint(r, o);
  });
  window.addEventListener('resize', function () { setVB(); showZoom(); });
  window.addEventListener('pagehide', function () { mirrorNow(); persistNow(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { mirrorNow(); persistNow(); } });
  window.addEventListener('beforeunload', function (e) { if (dirty && saveState !== 'ok') { mirrorNow(); e.preventDefault(); e.returnValue = ''; } });
  setInterval(function () { setStat(); updNag(); }, 30000);
  boot();
}
function boot() {
  try { backupAt = +localStorage.getItem('gm2_backupAt') || 0; } catch (e) { }
  Store.open().then(function () {
    return Store.all().catch(function () { return []; });
  }).then(function (fromDb) {
    var fams = Store.merge(fromDb, Store.mirrorRead()).map(normFam);
    var leg = Store.legacyRead(); if (leg && Array.isArray(leg.persons) && leg.persons.length && !fams.length) { var lf = newFam('ผังที่นำเข้าจากเวอร์ชันเก่า'); lf.state = normalize(leg); fams.push(lf); }
    project.families = fams;
    var act = null; try { act = localStorage.getItem('gm2_active'); } catch (e) { }
    if (!liveFams().length) { var f = newFam('ครอบครัวที่ 1'); project.families.push(f); f.updated = Date.now(); Store.putFamily(f).catch(function () { }); }
    setActive(act); mirrorNow();
    /* make sure everything merged from the mirror also lands in IndexedDB */
    if (Store.idb) project.families.forEach(function (f) { var d = fromDb.filter(function (x) { return x.id === f.id; })[0]; if (!d || (f.updated || 0) > (d.updated || 0)) Store.putFamily(f).catch(function () { }); });
    saveState = Store.idb ? 'ok' : (Store.mirrorOK ? 'mirror' : 'fail'); lastSaved = 0;
    var mx = Math.max.apply(null, project.families.map(function (f) { return f.updated || 0; }).concat([0]));
    if (totalPersons() && mx > backupAt) { editsSinceBackup = 1; firstEditAt = backupAt || (Date.now() - 16 * 60000); }
    setStat(); updNag();
    Store.persist().then(function (p) { persisted = p; });
    return Store.getMeta('backupAt');
  }).then(function (b) { if (b && b > backupAt) { backupAt = b; setStat(); } return Store.getMeta('fsHandle'); }).then(function (h) {
    if (h && h.queryPermission) { fsh = h; return h.queryPermission({ mode: 'readwrite' }).then(function (p) { fsState = p === 'granted' ? 'ok' : 'need'; setStat(); }); }
  }).catch(function () { });
  window.GM = { get state() { return state; }, get fam() { return fam; }, get project() { return project; }, draw: draw, fit: fit, addPerson: addPerson, addSpouse: addSpouse, addChildOf: addChildOf, addParents: addParents, addSibling: addSibling, pushSnap: pushSnap, save: save, persistNow: persistNow, select: select, tidy: tidy, buildExport: buildExport, makeSample: makeSample, importText: importText, setActive: setActive, addFamily: addFamily, expOpts: expOpts, bundle: bundle, normalize: normalize, get saveState() { return saveState; }, mirrorNow: mirrorNow, snapNow: function () { return Store.addSnap(fam.id, snapStr(), 'test', state.persons.length); } };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

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
var sel = null, msel = {}, mode = null, selMode = false, brkMode = false, snipMode = false, view = { x: 0, y: 0, w: 1200, h: 700 };
var svg, panel, ctr = 0;

function newState() { return { v: 2, persons: [], unions: [], rels: [], homes: [], texts: [], cuts: [] }; }
function newFam(title) {
  return { id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: title || '', house: '', place: '', interviewer: '', date: '', alias: false, showNote: true, condText: true, gen: true, typed: false, tcol: {}, pstyle: 'both', adopt: 'caption', hhs: 'ellipse', hhc: '', condFill: false, mono: false, unk: true, unkBlank: false, cx: {}, exp: {}, state: newState(), created: Date.now(), updated: Date.now() };
}
function normalize(s) {
  s = s || {}; s.persons = s.persons || []; s.unions = s.unions || []; s.rels = s.rels || []; s.homes = s.homes || []; s.texts = s.texts || []; s.cuts = s.cuts || []; s.v = 2;
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
  var o = { alias: !!f.alias, showNote: f.showNote !== false, condText: f.condText !== false, gen: f.gen !== false, refYear: y + 543, cm: GE.condMapFor(f), typed: !!f.typed, tcol: f.tcol || {}, pstyle: f.pstyle || 'both', adopt: f.adopt || 'caption', hhs: f.hhs || 'ellipse', hhc: f.hhc || '', condFill: !!f.condFill, mono: !!f.mono, unk: f.unk !== false, unkBlank: !!f.unkBlank };
  for (var k in over || {}) o[k] = over[k];
  return o;
}
function ixOf(st) { return GE.ixOf(st || state); }
function exists(id) { return state.persons.some(function (p) { return p.id === id; }) || state.unions.some(function (p) { return p.id === id; }) || state.rels.some(function (p) { return p.id === id; }) || state.homes.some(function (p) { return p.id === id; }) || state.texts.some(function (p) { return p.id === id; }); }
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
  var list = sel.k === 'p' ? state.persons : sel.k === 'u' ? state.unions : sel.k === 'r' ? state.rels : sel.k === 't' ? state.texts : state.homes;
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
function brkCount() { return state.persons.filter(function (q) { return q.brk; }).length + (state.cuts || []).length; }
function overlayBreaks() {
  var bs = state.persons.filter(function (q) { return q.brk; }), cx0 = state.cuts || []; if (!bs.length && !cx0.length) return;
  var boxes = GE.personBoxes(state, ctxFor(fam, {})), ys = state.persons.map(function (q) { return q.y; }), y0 = Math.min.apply(null, ys) - 70, y1 = Math.max.apply(null, ys) + 110, h = '';
  bs.forEach(function (q) {
    var bx = boxes.filter(function (b) { return b.id === q.id; })[0]; if (!bx) return; var x = bx.x0 - 6;
    h += '<line x1="' + x + '" y1="' + y0 + '" x2="' + x + '" y2="' + y1 + '" stroke="#e8590c" stroke-width="2.5" stroke-dasharray="10 7" pointer-events="none"/><text x="' + (x + 6) + '" y="' + (y0 + 4) + '" font-size="16" font-weight="700" fill="#e8590c" pointer-events="none">▶ แถวใหม่</text>';
  });
  cx0.forEach(function (x) { h += '<line x1="' + x + '" y1="' + y0 + '" x2="' + x + '" y2="' + y1 + '" stroke="#e8590c" stroke-width="2.5" stroke-dasharray="10 7" pointer-events="none"/><text x="' + (x + 6) + '" y="' + (y0 + 4) + '" font-size="16" font-weight="700" fill="#e8590c" pointer-events="none">▶ แถวใหม่</text>'; });
  svg.insertAdjacentHTML('beforeend', h);
}
function overlaySnip() {
  var z = state.snip; if (!z) return;
  svg.insertAdjacentHTML('beforeend', '<rect x="' + z.x + '" y="' + z.y + '" width="' + z.w + '" height="' + z.h + '" fill="rgba(37,99,235,.06)" stroke="#2563eb" stroke-width="3" stroke-dasharray="14 8" pointer-events="none"/><text x="' + (z.x + 8) + '" y="' + (z.y + 22) + '" font-size="18" font-weight="700" fill="#2563eb" pointer-events="none">▭ พื้นที่ส่งออก</text>');
}
function draw() {
  svg.innerHTML = GE.inner(state, ctxFor(fam, { sel: sel, msel: msel, mode: mode }));
  overlayBreaks(); overlaySnip();
  var e = $('#empty'); if (e) e.style.display = state.persons.length ? 'none' : 'flex';
}
function select(s) { sel = s; if (s) msel = {}; renderPanel(); draw(); }

/* ================= editing ================= */
function addTextBox() {
  var c = svgCenter(); pushSnap(); var t = { id: newId('t'), x: c.x, y: c.y, t: 'ข้อความ', s: 16, c: '#1f2a44', a: 'middle' };
  state.texts.push(t); sel = { k: 't', id: t.id }; msel = {}; renderPanel(); draw(); save();
  setTimeout(function () { var i = $('[data-f="t"]', panel); if (i) { i.focus(); i.select(); } }, 30);
}
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
  else if (s.k === 't') { state.texts = state.texts.filter(function (t) { return t.id !== s.id; }); label = 'ลบข้อความแล้ว'; }
  else { state.homes = state.homes.filter(function (h) { return h.id !== s.id; }); label = 'ลบวงบ้านแล้ว'; }
  sel = null; renderPanel(); draw(); save();
  toast(label + (orph ? ' — ลูก ' + orph + ' คนหลุดจากพ่อแม่ (เส้นถูกตัด)' : ''), 'ย้อนกลับ', undo);
}
function doDeleteMulti() {
  var ids = Object.keys(msel); if (!ids.length) return; pushSnap();
  var orph = 0; ids.forEach(function (i) { orph += orphansOf(i); delPerson(i); }); msel = {};
  renderPanel(); draw(); save(); toast('ลบ ' + ids.length + ' คนแล้ว' + (orph ? ' — ลูกที่ไม่ได้ถูกลบอีก ' + orph + ' คนหลุดจากพ่อแม่' : ''), 'ย้อนกลับ', undo);
}
/* squeeze ("บีบช่องว่างแนวนอน"): slide the right-hand part of the chart left, one vertical cut at a time, as far as no symbol / text overlaps another one
   (so a gap that only exists on one row can be closed, and the empty corner of a stepped chart is not wasted). Rows keep their y; only x changes. Verified afterwards, reverted if anything would overlap. */
function textW(t) { var sz = t.s || 15, ls = String(t.t || '').split('\n'); return Math.max.apply(null, ls.map(function (l) { return Array.from(l).length; }).concat([2])) * 0.56 * sz; }
function textBox(t) { var sz = t.s || 15, w = textW(t), a = t.a || 'middle', x0 = a === 'start' ? t.x : a === 'end' ? t.x - w : t.x - w / 2, n = String(t.t || '').split('\n').length; return { x0: x0, x1: x0 + w, y0: t.y - sz, y1: t.y + n * 1.25 * sz }; }
function squeezeBoxes() {
  var out = [], pm = {}; state.persons.forEach(function (p) { pm[p.id] = p; });
  GE.personBoxes(state, ctxFor(fam)).forEach(function (b) { out.push({ ox: pm[b.id].x, id: b.id, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 }); });
  (state.texts || []).forEach(function (t) { var q = textBox(t), o = { ox: (q.x0 + q.x1) / 2, tid: t.id, x0: q.x0, x1: q.x1, y0: q.y0, y1: q.y1 }; out.push(o); });
  /* a same-household outline is one obstacle that surrounds its members (moves with them; never cut through) */
  (state.homes || []).forEach(function (h) { var m = out.filter(function (q) { return q.id && h.ids.indexOf(q.id) >= 0; }); if (m.length < 1) return; out.push({ home: true, ox: m.reduce(function (a, q) { return a + q.ox; }, 0) / m.length, x0: Math.min.apply(null, m.map(function (q) { return q.x0; })) - 34, x1: Math.max.apply(null, m.map(function (q) { return q.x1; })) + 34, y0: Math.min.apply(null, m.map(function (q) { return q.y0; })) - 34, y1: Math.max.apply(null, m.map(function (q) { return q.y1; })) + 34 }); });
  return out;
}
function squeezeOverlaps(bx) { var n = 0; for (var i = 0; i < bx.length; i++) for (var j = i + 1; j < bx.length; j++) { var A = bx[i], B = bx[j]; if (A.home || B.home || (A.id && A.id === B.id)) continue; if (Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) > 0 && Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) > 0) n++; } return n; }
function squeezeX() {
  var MX = 30, MY = 6, bx = squeezeBoxes(), ov0 = squeezeOverlaps(bx), minX = Math.min.apply(null, bx.map(function (q) { return q.x0; })), maxX = Math.max.apply(null, bx.map(function (q) { return q.x1; })), before = maxX - minX;
  var save0 = { p: state.persons.map(function (p) { return [p, p.x]; }), t: (state.texts || []).map(function (t) { return [t, t.x]; }), c: (state.cuts || []).slice() }, moved = 0;
  var pmx = {};
  for (var it = 0; it < 150; it++) {
    state.persons.forEach(function (p) { pmx[p.id] = p.x; });
    var ks = [], seen = {}; bx.forEach(function (q) { if (q.home) return; var k = Math.round(q.ox * 10); if (!seen[k]) { seen[k] = 1; ks.push(q.ox); } }); ks.sort(function (a, b) { return a - b; });
    var best = 0, bestC = null;
    for (var i = 0; i + 1 < ks.length; i++) {
      var c = (ks[i] + ks[i + 1]) / 2, L = [], R = [];
      if ((state.homes || []).some(function (h) { var xs = h.ids.map(function (id) { return pmx[id]; }).filter(function (v) { return v != null; }); return xs.length > 1 && Math.min.apply(null, xs) <= c && Math.max.apply(null, xs) > c; })) continue; bx.forEach(function (q) { (q.ox > c ? R : L).push(q); });
      var d = Math.min.apply(null, R.map(function (q) { return q.x0; })) - Math.min.apply(null, L.map(function (q) { return q.x0; }));
      for (var a = 0; a < L.length && d > best; a++) for (var b = 0; b < R.length; b++) { var A = L[a], B = R[b]; if (B.y0 - MY < A.y1 && A.y0 - MY < B.y1) { var al = B.x0 - A.x1 - MX; if (al < d) d = al; if (d <= best) break; } }
      if (d > best) { best = d; bestC = c; }
    }
    if (best < 4) break;
    bx.forEach(function (q) { if (q.ox > bestC) { q.ox -= best; q.x0 -= best; q.x1 -= best; } });
    state.persons.forEach(function (p) { if (p.x > bestC) p.x -= best; }); (state.texts || []).forEach(function (t) { var q = textBox(t); if ((q.x0 + q.x1) / 2 > bestC) t.x -= best; });
    if (state.cuts) state.cuts = state.cuts.map(function (x) { return x > bestC ? x - best : x; });
    moved++;
  }
  if (!moved) { toast('ไม่มีช่องว่างแนวนอนให้บีบ — ผังชิดกันอยู่แล้ว'); return; }
  state.persons.forEach(function (p) { p.x = Math.round(p.x * 10) / 10; }); (state.texts || []).forEach(function (t) { t.x = Math.round(t.x * 10) / 10; });
  var ba = squeezeBoxes(), ov1 = squeezeOverlaps(ba), after = Math.max.apply(null, ba.map(function (q) { return q.x1; })) - Math.min.apply(null, ba.map(function (q) { return q.x0; }));
  if (ov1 > ov0) { /* labels re-flowed into each other: put everything back */
    save0.p.forEach(function (z) { z[0].x = z[1]; }); save0.t.forEach(function (z) { z[0].x = z[1]; }); state.cuts = save0.c; draw();
    toast('บีบแล้วจะมีข้อความ/สัญลักษณ์ทับกัน จึงไม่ได้ย้ายอะไร'); return;
  }
  var dropped = !!state.snip; if (dropped) delete state.snip; /* its rectangle was in the old coordinates */
  draw(); fit(); save();
  toast('บีบช่องว่างแล้ว: ผังแคบลง ' + Math.round((1 - after / before) * 100) + '% (กว้าง ' + Math.round(before) + ' → ' + Math.round(after) + ')' + (dropped ? ' · กรอบตัดภาพส่งออกเดิมถูกล้าง ให้ลากใหม่' : ''), 'ย้อนกลับ', undo);
}
function tidy(kind) {
  if (!state.persons.length) return; pushSnap(); var g = GE.gens(state), moved = 0;
  if (kind === 'labels') {
    var res = GE.autoLabels(state, ctxFor(fam)), m0 = ixOf();
    Object.keys(res).forEach(function (id) { var q = m0[id]; if (!q) return; var nv = res[id]; if ((q.lp || '') !== nv) { if (nv) q.lp = nv; else delete q.lp; moved++; } });
    draw(); save(); toast(moved ? 'จัดตำแหน่งข้อความใหม่ ' + moved + ' คน — ข้อความที่คุณลากเองไม่ถูกแตะ ย้อนกลับได้' : 'ตำแหน่งข้อความดีอยู่แล้ว', moved ? 'ย้อนกลับ' : null, undo);
    return;
  }
  if (kind === 'squeeze') { squeezeX(); return; }
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
  if (mode.kind === 'home') h = 'วงบ้านเดียวกัน — คลิกคนที่อยู่ด้วยกัน (เลือกแล้ว ' + mode.ids.length + ' คน — คลิกซ้ำเพื่อเอาออก) <button class="pri" data-act="homedone">เสร็จ</button><button data-act="cancel">ยกเลิก</button>';
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
    '<label class="ck"><input type="checkbox" data-fm="showNote"' + (fam.showNote !== false ? ' checked' : '') + '> หมายเหตุใต้ชื่อ</label>' +
    '<label class="ck"><input type="checkbox" data-fm="mono"' + (fam.mono ? ' checked' : '') + '> สัญลักษณ์ตามคู่มือ (เส้นดำ พื้นขาว วงบ้านดำเส้นบาง — ข้อความยังมีสีได้)</label>' +
    '<label class="ck"><input type="checkbox" data-fm="condFill"' + (fam.condFill ? ' checked' : '') + '> ระบายลายโรคในสัญลักษณ์ (ปิดไว้ = โรคขึ้นเป็นตัวหนังสืออย่างเดียว)</label>' +
    '<label class="ck"><input type="checkbox" data-fm="unk"' + (fam.unk !== false ? ' checked' : '') + '> ชื่อ “ไม่ทราบ” แสดงเป็น “ไม่ทราบ” (ไม่ย่อเป็น ม.)</label>' +
    '<label class="ck"><input type="checkbox" data-fm="unkBlank"' + (fam.unkBlank ? ' checked' : '') + '> ช่องชื่อ/อายุที่ว่าง ให้ขึ้น “ไม่ทราบ”</label></div>' +
    '<div class="sec"><div class="st">รูปแบบสัญลักษณ์</div>' +
    '<label>ผู้ป่วย<select data-fm="pstyle">' + opt('both', 'ซ้อนสองชั้น + ลูกศร', fam.pstyle || 'both') + opt('double', 'ซ้อนสองชั้น (ไม่มีลูกศร — ใช้ลูกศรแทนผู้ให้ข้อมูล)', fam.pstyle) + opt('arrow', 'ลูกศรชี้สัญลักษณ์ (ไม่ซ้อน — ตามคู่มือ)', fam.pstyle) + '</select></label>' +
    '<label>ลูกบุญธรรม<select data-fm="adopt">' + opt('caption', 'ป้าย “บุตรบุญธรรม (adopted)” ตามคู่มือ', fam.adopt || 'caption') + opt('bracket', 'วงเล็บครอบ (แบบสากล)', fam.adopt) + '</select></label>' +
    '<label>กรอบสมาชิกบ้านเดียวกัน<select data-fm="hhs">' + opt('ellipse', 'วงรี (ตามคู่มือ)', fam.hhs || 'ellipse') + opt('round', 'กล่องมุมมน (แบบเขต 7, 9)', fam.hhs) + opt('hug', 'โค้งตามสมาชิก (อ้อมคนอื่น เหมาะบ้านที่มีหลายรุ่น)', fam.hhs) + '</select></label>' +
    '<label>สีกรอบ <input type="color" data-fm="hhc" value="' + (fam.hhc || '#234e8c') + '" style="width:44px;height:28px;padding:0;display:inline-block;vertical-align:middle"> <button type="button" data-act="hhcclear" style="padding:2px 8px;font-size:12px">ค่าเดิม</button></label><div class="btns" style="margin:4px 0"><button type="button" data-act="autohomes">สร้างวงบ้านอัตโนมัติจาก “บ้านเลขที่ …” ในช่อง ย้ายถิ่น</button></div></div>' +
    '<div class="sec"><div class="st">สีข้อความ</div><label class="ck"><input type="checkbox" data-fm="typed"' + (fam.typed ? ' checked' : '') + '> แยกสีตามชนิดข้อมูล (แบบเขต 7)</label>' +
    (fam.typed ? '<div class="tcs">' + GE.TEXT_KINDS.map(function (t) { return '<label class="tc"><input type="color" data-tc="' + t.k + '" value="' + ((fam.tcol || {})[t.k] || t.c) + '"> ' + esc(t.n) + '</label>'; }).join('') + '<button type="button" data-act="tcreset" style="padding:2px 8px;font-size:12px">คืนสีมาตรฐาน</button></div>' : '<p class="mut" style="font-size:12px">เปิดแล้ว ชื่อ/อาชีพ/โรค/พฤติกรรมเสี่ยง/สาเหตุการตายจะคนละสี และมีคำอธิบายสีในรูปที่ส่งออก</p>') + '</div>' +
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
    h += '<div class="sec"><div class="st">เลือกไว้ ' + nm + ' คน</div><p class="mut">ลากคนใดคนหนึ่งเพื่อย้ายทั้งกลุ่ม</p><div class="btns"><button data-act="malign">จัดให้อยู่แนวเดียวกัน</button><button data-act="mdist">เว้นระยะเท่ากัน</button></div><div class="btns"><button class="pri" data-act="mhome">ทำวงสมาชิกที่อยู่ด้วยกัน (' + nm + ' คน)</button></div>' +
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
      '<div class="btns" style="margin:0 0 4px"><button type="button" data-act="unkname">ไม่ทราบชื่อ</button><button type="button" data-act="unkage">ไม่ทราบอายุ</button></div>' +
      '<p class="mut" style="margin:-2px 0 6px;font-size:12px">ใส่ปีเกิดอย่างเดียวก็ได้ — ระบบคำนวณอายุจากวันที่เก็บข้อมูลให้</p>' +
      '<div class="two"><label>เพศ<select data-f="sex">' + opt('M', 'ชาย', p.sex) + opt('F', 'หญิง', p.sex) + opt('U', 'ไม่ทราบเพศ', p.sex) + '</select></label>' +
      '<label>สถานะ<select data-f="st">' + Object.keys(GE.STS).map(function (k) { return opt(k, GE.STS[k], p.st || ''); }).join('') + '</select></label></div>' +
      '<div class="chk"><label><input type="checkbox" data-f="dead"' + (dead ? ' checked' : '') + '> เสียชีวิต</label><label><input type="checkbox" data-f="adopted"' + (p.adopted ? ' checked' : '') + '> ลูกบุญธรรม</label></div>' +
      (dead ? '<label>สาเหตุการเสียชีวิต<input data-f="cod" value="' + esc(p.cod || '') + '" placeholder="เช่น โรคหัวใจ อุบัติเหตุ ชราภาพ"></label>' : '') + '</div>' +
      '<div class="sec"><div class="st">ข้อมูลเพิ่มเติม</div>' +
      '<div class="two"><label>ระดับการศึกษา<input data-f="edu" value="' + esc(p.edu || '') + '" placeholder="เช่น ป.6, ปริญญาตรี"></label><label>อาชีพ<input data-f="occ" value="' + esc(p.occ || '') + '" placeholder="เช่น เกษตรกร"></label></div>' +
      '<div class="two"><label>บทบาทในชุมชน<input data-f="role" value="' + esc(p.role || '') + '" placeholder="เช่น อสม."></label><label>ย้ายถิ่น / ที่อยู่ปัจจุบัน<input data-f="mig" value="' + esc(p.mig || '') + '" placeholder="เช่น กรุงเทพฯ"></label></div>' +
      '<label>พฤติกรรมเสี่ยง<input data-f="risk" value="' + esc(p.risk || '') + '" placeholder="เช่น ไม่ออกกำลังกาย กินเค็ม"></label>' +
      '<div class="chk"><label><input type="checkbox" data-f="inf"' + (p.inf ? ' checked' : '') + '> ผู้ให้ข้อมูล (ลูกศรชี้)</label><label><input type="checkbox" data-f="key"' + (p.key ? ' checked' : '') + '> ผู้ให้ข้อมูลหลัก (ระบายเหลือง)</label></div></div>' +
      '<div class="sec"><div class="st">โรค / ภาวะสุขภาพ</div><div class="chips">' + Object.keys(cm).map(function (k) { var on = (p.cond || []).indexOf(k) >= 0; return '<button class="chip' + (on ? ' on' : '') + '" data-act="cond" data-v="' + k + '" title="' + esc(cm[k].n) + '">' + esc(cm[k].t) + '</button>'; }).join('') + '</div>' +
      '<label>โรคอื่นๆ (พิมพ์เอง ขึ้นเป็นตัวหนังสือสีเดียวกับโรคอื่น)<textarea data-f="dz" rows="2" placeholder="เช่น ไขมันในเลือดสูง, เก๊าท์ (คั่นด้วย , หรือขึ้นบรรทัดใหม่)">' + esc(p.dz || '') + '</textarea></label>' +
      (fam.condFill ? '<div class="chk"><label><input type="checkbox" data-f="nofill"' + (p.nofill ? ' checked' : '') + '> ไม่ระบายลายโรคในสัญลักษณ์ของคนนี้</label></div>' + ((p.cond || []).length > 3 ? '<p class="mut" style="color:#b26a00">ลายแสดงบนสัญลักษณ์ได้ 3 อย่างแรก (ที่เหลือยังขึ้นเป็นตัวหนังสือ)</p>' : '') : '<p class="mut" style="font-size:12px">โรคขึ้นเป็นตัวหนังสือใต้ชื่อเท่านั้น (เปิดลายได้ที่แผง “ข้อมูลผังนี้” คลิกพื้นที่ว่าง)</p>') + '</div>' +
      '<div class="sec"><label>หมายเหตุ<textarea data-f="note" rows="2" placeholder="ข้อความเพิ่มเติมใต้ชื่อ">' + esc(p.note || '') + '</textarea></label>' +
      '<div class="sw">' + GE.FILLS.map(function (c, i) { return '<button class="swb' + ((p.c || 0) === i ? ' on' : '') + '" data-act="color" data-v="' + i + '" title="' + GE.FILL_NAMES[i] + '" style="background:' + c + '"></button>'; }).join('') + '</div>' +
      '<label>ตำแหน่งชื่อ<select data-f="lp">' + opt('', 'อัตโนมัติ', p.lp || '') + opt('b', 'ใต้สัญลักษณ์', p.lp) + opt('t', 'เหนือสัญลักษณ์', p.lp) + opt('l', 'ซ้าย', p.lp) + opt('r', 'ขวา', p.lp) + '</select></label></div>' +
      '<div class="sec"><div class="st">ข้อความของคนนี้</div><p class="mut" style="font-size:12px;margin-bottom:6px">ลากข้อความบนผังเพื่อย้ายได้เลย</p>' +
      '<div class="two"><label>ขนาด<select data-f="ls">' + opt('', 'ปกติ', p.ls || '') + opt('0.8', 'เล็ก', p.ls) + opt('1.25', 'ใหญ่', p.ls) + opt('1.5', 'ใหญ่มาก', p.ls) + '</select></label><label>สี<input type="color" data-f="lc" value="' + (p.lc || '#234e8c') + '" style="height:32px;padding:2px"></label></div>' +
      '<div class="sw tsw">' + TCOLS.map(function (c) { return '<button class="swb" data-act="lcol" data-v="' + c + '" style="background:' + c + '"></button>'; }).join('') + '</div>' +
      '<div class="chk"><label><input type="checkbox" data-f="lh"' + (p.lh ? ' checked' : '') + '> ซ่อนข้อความของคนนี้</label></div>' +
      '<div class="btns"><button data-act="lcclear">ล้างสี</button><button data-act="lreset"' + (p.lo ? '' : ' disabled') + '>คืนตำแหน่งข้อความ</button></div></div>' +
      '<div class="sec"><div class="st">เพิ่มญาติ</div><div class="btns">' +
      '<button data-act="spouse">+ คู่สมรส</button><button data-act="child" data-v="M">+ ลูกชาย</button><button data-act="child" data-v="F">+ ลูกหญิง</button>' +
      '<button data-act="parents"' + (p.from ? ' disabled' : '') + '>+ พ่อแม่</button><button data-act="sib" data-v="M">+ พี่น้องชาย</button><button data-act="sib" data-v="F">+ พี่น้องหญิง</button></div></div>' +
      '<div class="sec"><div class="st">อยู่บ้านเดียวกัน</div><div class="btns"><button data-act="homefrom">เริ่มวงจากคนนี้ (แล้วคลิกคนอื่นเพิ่ม)</button></div></div>' +
      '<div class="sec"><div class="st">เชื่อมกับคนอื่น</div><select id="linktype" style="width:100%;max-width:none">' + linkOptions() + '</select><div class="btns"><button class="pri" data-act="link">เลือกคนที่จะเชื่อม</button>' + (p.tw ? '<button data-act="untwin">ยกเลิกแฝด</button>' : '') + '</div></div>' +
      '<div class="sec"><div class="st">ตัดแถวสำหรับส่งออก (แบบเล่มรายงาน)</div><p class="mut">ตั้งให้คนนี้เป็นคนแรกของแถวใหม่ — ตอนส่งออกจะตัดที่ด้านซ้ายของคนนี้ (เส้นประสีส้มบนผัง)</p><div class="btns"><button data-act="brk">' + (p.brk ? 'ยกเลิกจุดตัดที่คนนี้' : 'เริ่มแถวใหม่ที่คนนี้') + '</button>' + (brkCount() ? '<button data-act="brkclear">ล้างจุดตัดทั้งหมด (' + brkCount() + ')</button>' : '') + '</div></div>' +
      '<div class="sec"><button class="dng" data-act="del">ลบคนนี้</button></div>';
  } else if (sel.k === 't') {
    var tx = s;
    h += '<div class="sec"><div class="st">กล่องข้อความ</div>' +
      '<label>ข้อความ (ขึ้นบรรทัดใหม่ได้)<textarea data-f="t" rows="3">' + esc(tx.t || '') + '</textarea></label>' +
      '<div class="two"><label>ขนาด (px)<input type="number" data-f="s" min="8" max="72" value="' + (tx.s || 15) + '"></label><label>จัดชิด<select data-f="a">' + opt('middle', 'กึ่งกลาง', tx.a || 'middle') + opt('start', 'ซ้าย', tx.a) + opt('end', 'ขวา', tx.a) + '</select></label></div>' +
      '<div class="two"><label>สี<input type="color" data-f="c" value="' + (tx.c || '#1f2a44') + '" style="height:32px;padding:2px"></label><label class="ck" style="margin-top:22px"><input type="checkbox" data-f="b"' + (tx.b ? ' checked' : '') + '> ตัวหนา</label></div>' +
      '<div class="sw tsw">' + TCOLS.map(function (c) { return '<button class="swb" data-act="lcol" data-v="' + c + '" style="background:' + c + '"></button>'; }).join('') + '</div>' +
      '<p class="mut" style="font-size:12px">ลากข้อความบนผังเพื่อย้าย · ดับเบิลคลิกเพื่อแก้</p></div>' +
      '<div class="sec"><button class="dng" data-act="del">ลบกล่องข้อความ</button></div>';
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
    var hm = ixOf(), mem = (s.ids || []).map(function (i) { return hm[i] ? (GE.dispName(hm[i], ctxFor(fam)) || 'ไม่มีชื่อ') : null; }).filter(Boolean);
    h += '<div class="sec"><div class="st">วงสมาชิกที่อยู่ด้วยกัน</div><p class="mut">สมาชิก ' + mem.length + ' คน: ' + esc(mem.join(', ')) + '</p><div class="btns"><button data-act="homeedit">แก้สมาชิก (คลิกคนเพิ่ม/เอาออก)</button><button class="dng" data-act="del">ลบวงนี้</button></div>' +
      '<label>ป้ายชื่อบ้าน (ขึ้นเหนือวง)<input data-f="label" value="' + esc(s.label || '') + '" placeholder="เช่น บ้านเลขที่ 32"></label>' +
      (GE.homeOutsiders(state, s) ? '<div class="warnbox">วงนี้ทับคนนอกบ้าน ' + GE.homeOutsiders(state, s) + ' คน — ลองเลือกกรอบ “โค้งตามสมาชิก” ในแผงผัง หรือลากคนให้อยู่ใกล้กัน</div>' : '') + '</div>';
  }
  panel.querySelector('#dyn').innerHTML = h; renderMode();
  refreshLegend();
}

var TCOLS = ['#1f2a44', '#234e8c', '#2447d6', '#e11d1d', '#8b5a2b', '#1f8a3a', '#7c3aed', '#ea580c', '#6b7280'];
function refreshLegend(force) { var lg = $('#legend'); if (!lg || (lg.dataset.k && !force)) return; lg.innerHTML = GE.legendHTML({ persons: [], unions: [], rels: [], homes: [] }, ctxFor(fam)); lg.dataset.k = 1; }
var fieldSnap = null, fieldPushed = false;
function bindPanel() {
  panel.addEventListener('focusin', function (e) { if (e.target.matches('[data-f]')) { fieldSnap = snapStr(); fieldPushed = false; } });
  panel.addEventListener('focusout', function () { fieldSnap = null; });
  function onField(e) {
    var t = e.target; if (!t.matches) return;
    if (t.matches('[data-fm]')) {
      var k = t.getAttribute('data-fm'); fam[k] = t.type === 'checkbox' ? t.checked : t.value;
      if (k === 'condFill' || k === 'mono' || k === 'unk' || k === 'unkBlank') { fam.exp = fam.exp || {}; fam.exp[k] = fam[k]; }
      if (k === 'title' || k === 'house') fillFamSel();
      refreshLegend(true); draw(); save(); if (k === 'typed') renderPanel(); return;
    }
    if (t.matches('[data-tc]')) { fam.tcol = fam.tcol || {}; fam.tcol[t.getAttribute('data-tc')] = t.value; refreshLegend(true); draw(); save(); return; }
    if (t.matches('[data-cx]')) {
      var pr = t.getAttribute('data-cx').split('.'); fam.cx = fam.cx || {}; fam.cx[pr[0]] = fam.cx[pr[0]] || {}; fam.cx[pr[0]][pr[1]] = t.value;
      $('#legend').dataset.k = ''; draw(); save(); return;
    }
    if (!t.matches('[data-f]')) return;
    var s = findSel(); if (!s) return;
    if (!fieldPushed) { pushSnap(fieldSnap || snapStr()); fieldPushed = true; }
    var f = t.getAttribute('data-f'), v = t.type === 'checkbox' ? t.checked : t.value;
    if (f === 'dp' || f === 's') v = +v;
    if (f === 'ls') v = v === '' ? '' : +v;
    if (f === 'byr') { v = String(v).replace(/\D/g, '').slice(0, 4); if (v !== t.value) t.value = v; if (v !== '') v = +v; }
    if (f === 'age' && /^\d{4}$/.test(String(v)) && +v >= 1800) { /* typed a birth year in the age box: move it */
      s.byr = +v > 2300 ? +v : +v + 543; delete s.age; draw(); save(); renderPanel(); toast('เป็นปีเกิด ย้ายไปช่อง “ปีเกิด” ให้แล้ว (อายุจะคำนวณเอง)');
      var bi = $('[data-f="byr"]', panel); if (bi) bi.focus(); return;
    }
    if (v === '' || v === false) { if (f !== 'name' && f !== 'note' && f !== 't') { delete s[f]; v = undefined; } }
    if (v !== undefined) s[f] = v;
    draw(); save();
    if (e.type === 'change' && (f === 'sex' || f === 'st' || f === 'dead' || (f === 't' && sel && sel.k !== 't') || f === 'lh')) renderPanel();
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
  else if (act === 'homefrom' && s) { mode = { kind: 'home', ids: [s.id] }; sel = null; }
  else if (act === 'homeedit' && s) { mode = { kind: 'home', ids: s.ids.slice(), edit: s.id }; sel = null; }
  else if (act === 'mhome') { var mids = Object.keys(msel); if (mids.length) { pushSnap(); var mh = { id: newId('h'), ids: mids }; state.homes.push(mh); msel = {}; sel = { k: 'h', id: mh.id }; toast('สร้างวงสมาชิกที่อยู่ด้วยกันแล้ว (' + mids.length + ' คน)'); } }
  else if (act === 'unkname' && s) { pushSnap(); s.name = 'ไม่ทราบ'; delete s.alias; }
  else if (act === 'unkage' && s) { pushSnap(); s.age = 'ไม่ทราบ'; delete s.byr; }
  else if (act === 'homedone') {
    if (mode.edit) { var eh = state.homes.filter(function (z) { return z.id === mode.edit; })[0]; if (eh) { pushSnap(); if (mode.ids.length) { eh.ids = mode.ids.slice(); sel = { k: 'h', id: eh.id }; } else { state.homes = state.homes.filter(function (z) { return z.id !== eh.id; }); sel = null; } } }
    else if (mode.ids.length) { pushSnap(); var h = { id: newId('h'), ids: mode.ids.slice() }; state.homes.push(h); sel = { k: 'h', id: h.id }; }
    mode = null;
  }
  else if (act === 'cancel') { mode = null; }
  else if (act === 'color' && s) { pushSnap(); s.c = +v; }
  else if (act === 'cond' && s) { pushSnap(); var a = s.cond || []; var i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); if (a.length) s.cond = a; else delete s.cond; }
  else if (act === 'addtext') { addTextBox(); return; }
  else if (act === 'lcol' && s) { pushSnap(); if (sel.k === 't') s.c = v; else s.lc = v; }
  else if (act === 'lcclear' && s) { pushSnap(); delete s.lc; }
  else if (act === 'lreset' && s) { pushSnap(); delete s.lo; }
  else if (act === 'hhcclear') { fam.hhc = ''; refreshLegend(true); }
  else if (act === 'autohomes') {
    var grp = {}; state.persons.forEach(function (p) { var mm = /(?:บ้านเลขที่|เลขที่)\s*([0-9]+(?:\/[0-9]+)?)/.exec(p.mig || ''); if (mm) (grp[mm[1]] = grp[mm[1]] || []).push(p.id); });
    var made = 0, nums = Object.keys(grp).filter(function (k) { return grp[k].length > 1; });
    nums.forEach(function (k) { var ids = grp[k]; if (state.homes.some(function (z) { return z.ids.length === ids.length && ids.every(function (i) { return z.ids.indexOf(i) >= 0; }); })) return; if (!made) pushSnap(); state.homes.push({ id: newId('h'), ids: ids.slice(), label: 'บ้านเลขที่ ' + k }); made++; });
    toast(made ? 'สร้างวงบ้านจากบ้านเลขที่ ' + made + ' วง (ตรวจดูแล้วแก้สมาชิกได้)' : (nums.length ? 'มีวงบ้านครบแล้ว' : 'ไม่พบ “บ้านเลขที่ …” ซ้ำกันในช่อง ย้ายถิ่น'));
    if (made && fam.hhs !== 'hug') { fam.hhs = 'hug'; }
  }
  else if (act === 'tcreset') { fam.tcol = {}; refreshLegend(true); }
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
  else if (act === 'brk' && s && sel && sel.k === 'p') { pushSnap(); if (s.brk) delete s.brk; else s.brk = 1; }
  else if (act === 'brkclear') { pushSnap(); state.persons.forEach(function (q) { delete q.brk; }); state.cuts = []; }
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
    var tg = e.target.closest && e.target.closest('[data-pid],[data-uid],[data-rid],[data-hid],[data-bh],[data-lid],[data-tid]'), q = pt(e);
    if (snipMode) { drag = { k: 'mq', c0: { x: e.clientX, y: e.clientY }, snip: true }; return; } /* snipping-tool style: drag a rectangle anywhere */
    var onThing = tg && (tg.getAttribute('data-pid') || tg.getAttribute('data-lid') || tg.getAttribute('data-tid')); /* people / labels / text boxes keep their normal click-and-drag even while the cut mode is on */
    var thr = 10 * view.w / (svg.clientWidth || 1000), hitI = -1;
    (state.cuts || []).forEach(function (cx, i) { if (Math.abs(cx - q.x) <= thr) hitI = i; });
    if (brkMode && (!onThing || hitI >= 0)) { /* place a row cut exactly where clicked (click near an existing cut line to remove it) */
      var cuts = state.cuts = state.cuts || [];
      pushSnap();
      if (hitI >= 0) cuts.splice(hitI, 1); else cuts.push(Math.round(q.x));
      toast(hitI >= 0 ? 'ลบจุดตัดแล้ว (เหลือ ' + brkCount() + ' จุด)' : 'วางจุดตัดแล้ว (' + brkCount() + ' จุด)'); renderPanel(); draw(); save(); return;
    }
    if (mode) {
      if (tg && tg.getAttribute('data-pid')) {
        var id = tg.getAttribute('data-pid');
        if (mode.kind === 'home') { var i = mode.ids.indexOf(id); if (i >= 0) mode.ids.splice(i, 1); else mode.ids.push(id); renderPanel(); draw(); }
        else if (mode.kind === 'link') { if (!mode.from) { mode.from = id; renderPanel(); draw(); } else finishLink(id); }
      }
      return;
    }
    if (tg && tg.getAttribute('data-bh')) { drag = { k: 'bend', id: tg.getAttribute('data-bh'), snap: snapStr(), moved: false }; }
    else if (tg && tg.getAttribute('data-lid')) {
      var lid = tg.getAttribute('data-lid'), lp_ = ixOf()[lid]; if (!lp_) return;
      if (e.shiftKey || selMode) { msel[lid] = 1; sel = null; renderPanel(); draw(); return; }
      msel = {}; select({ k: 'p', id: lid }); drag = { k: 'label', id: lid, q0: q, lo0: (lp_.lo || [0, 0]).slice(), moved: false, snap: snapStr() };
    }
    else if (tg && tg.getAttribute('data-tid')) {
      var tid = tg.getAttribute('data-tid'), tt_ = state.texts.filter(function (z) { return z.id === tid; })[0]; if (!tt_) return;
      msel = {}; select({ k: 't', id: tid }); drag = { k: 'text', id: tid, q0: q, x0: tt_.x, y0: tt_.y, moved: false, snap: snapStr() };
    }
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
    if (drag.k === 'label' || drag.k === 'text') {
      var q3 = pt(e), ex = q3.x - drag.q0.x, ey = q3.y - drag.q0.y;
      if (!drag.moved) { if (Math.abs(ex) + Math.abs(ey) < 3) return; drag.moved = true; pushSnap(drag.snap); }
      if (drag.k === 'label') { var pp2 = ixOf()[drag.id]; if (pp2) pp2.lo = [Math.round(drag.lo0[0] + ex), Math.round(drag.lo0[1] + ey)]; }
      else { var t2 = state.texts.filter(function (z) { return z.id === drag.id; })[0]; if (t2) { t2.x = Math.round(drag.x0 + ex); t2.y = Math.round(drag.y0 + ey); } }
      draw(); return;
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
    if (drag && drag.k === 'mq' && drag.snip) {
      hideMq();
      if (drag.c1) {
        var sa = pt({ clientX: drag.c0.x, clientY: drag.c0.y }), sb = pt({ clientX: drag.c1.x, clientY: drag.c1.y }), sw = Math.abs(sb.x - sa.x), sh = Math.abs(sb.y - sa.y);
        if (sw > 40 && sh > 40) { pushSnap(); state.snip = { x: Math.round(Math.min(sa.x, sb.x)), y: Math.round(Math.min(sa.y, sb.y)), w: Math.round(sw), h: Math.round(sh) }; save(); toast('เลือกพื้นที่ส่งออกแล้ว (' + state.snip.w + '×' + state.snip.h + ') — กด “ส่งออก / พิมพ์” ได้เลย'); }
      }
      renderPanel(); draw();
    } else if (drag && drag.k === 'mq') {
      hideMq();
      if (drag.c1) {
        var a = pt({ clientX: drag.c0.x, clientY: drag.c0.y }), b = pt({ clientX: drag.c1.x, clientY: drag.c1.y }), x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
        if (!e.shiftKey && !selMode) msel = {}; sel = null;
        state.persons.forEach(function (p) { if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) msel[p.id] = 1; });
      } else { msel = {}; }
      renderPanel(); draw();
    } else if (drag && (drag.k === 'p' || drag.k === 'bend' || drag.k === 'label' || drag.k === 'text') && drag.moved) { save(); renderPanel(); }
    drag = null;
  }
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', function (e) { e.preventDefault(); var q = pt(e); zoomAt(e.deltaY < 0 ? 0.87 : 1.15, q.x, q.y); }, { passive: false });
  svg.addEventListener('dblclick', function (e) {
    var tg = e.target.closest && e.target.closest('[data-pid],[data-lid],[data-tid]'); if (!tg || mode) return;
    if (tg.getAttribute('data-tid')) { select({ k: 't', id: tg.getAttribute('data-tid') }); setTimeout(function () { var i = $('[data-f="t"]', panel); if (i) { i.focus(); i.select(); } }, 30); return; }
    select({ k: 'p', id: tg.getAttribute('data-pid') || tg.getAttribute('data-lid') });
    setTimeout(function () { var i = $('[data-f="name"]', panel); if (i) { i.focus(); i.select(); } }, 30);
  });
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { if (mode) { mode = null; renderPanel(); draw(); } else if (brkMode && $('#brkmode')) { $('#brkmode').click(); } else if (snipMode && $('#snipmode')) { $('#snipmode').click(); } else if (sel || Object.keys(msel).length) { sel = null; msel = {}; renderPanel(); draw(); } }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); persistNow(); toast('บันทึกในเครื่องแล้ว'); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) { if (Object.keys(msel).length) { e.preventDefault(); doDeleteMulti(); } else if (sel) { e.preventDefault(); doDelete(); } }
    if (!typing && !mode && /^Arrow/.test(e.key) && (sel && (sel.k === 'p' || sel.k === 't') || Object.keys(msel).length)) {
      e.preventDefault(); var st = e.shiftKey ? 50 : 10, dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
      if (Date.now() - nudgeT > 900) pushSnap(); nudgeT = Date.now();
      if (!Object.keys(msel).length && sel.k === 't') { var tn = findSel(); if (tn) { tn.x += dx; tn.y += dy; } draw(); save(); return; }
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
  sel = null; msel = {}; mode = null; var lg0 = $('#legend'); if (lg0) lg0.dataset.k = '';
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
  p('m1', 'สมศรี สุขใจ', 'F', 330, 230, { c: 2, byr: 2517, cond: ['ht'], from: 'u1', alias: 'ส.ส.', key: 1, occ: 'แม่บ้าน', role: 'อสม.' });
  p('f1', 'สมชาย สุขใจ', 'M', 460, 230, { c: 2, byr: 2514, cond: ['dm', 'alc'], from: 'u2', alias: 'ส.ส.', occ: 'เกษตรกร', edu: 'ป.6', risk: 'ไม่ออกกำลังกาย' });
  p('f2', 'สมพงษ์ สุขใจ', 'M', 740, 230, { c: 2, byr: 2519, from: 'u2', alias: 'ส.ส.' });
  p('x1', 'พรทิพย์', 'F', 880, 230, { c: 2, byr: 2521, alias: 'พ.' });
  p('k1', 'ก้อง สุขใจ', 'M', 330, 400, { c: 3, byr: 2540, from: 'u3', tw: 'k2', twi: 0, alias: 'ก.ส.', inf: 1, occ: 'พนักงานบริษัท', mig: 'ทำงานกรุงเทพฯ' });
  p('k2', 'ใบเตย สุขใจ', 'F', 460, 400, { c: 3, byr: 2540, from: 'u3', tw: 'k1', st: 'pt', cond: ['dm'], alias: 'ใ.ส.', note: 'ผู้ให้ข้อมูลหลัก' });
  p('k3', 'น้องเล็ก', 'M', 590, 400, { c: 3, byr: 2550, from: 'u3', adopted: 1, alias: 'น.' });
  p('k4', 'ต้น สุขใจ', 'M', 810, 400, { c: 3, byr: 2545, from: 'u4', alias: 'ต.ส.', occ: 'นักเรียน' });
  U.push({ id: 'u1', a: 'a1', b: 'a2', t: 'married' }, { id: 'u2', a: 'b1', b: 'b2', t: 'married' }, { id: 'u3', a: 'm1', b: 'f1', t: 'married' }, { id: 'u4', a: 'f2', b: 'x1', t: 'divorced' }, { id: 'u5', a: 'm0', b: 'm0h', t: 'cohab' });
  R.push({ id: 'r1', a: 'm0', b: 'm1', t: 'vclose', bend: -70 }, { id: 'r2', a: 'k4', b: 'f1', t: 'conflict', bend: -110 });
  Hm.push({ id: 'h1', ids: ['m1', 'f1', 'k1', 'k2', 'k3'] });
  return { v: 2, persons: P, unions: U, rels: R, homes: Hm, texts: [{ id: 't1', x: 150, y: 330, t: 'ตระกูลนี้ทำนาและเลี้ยงวัว\n(ข้อมูลสมมติเพื่อสาธิต)', s: 13, c: '#6b7280', a: 'middle' }] };
}

/* ================= export ================= */
var PAPERS = { a4l: { n: 'A4 แนวนอน', w: 297, h: 210 }, a4p: { n: 'A4 แนวตั้ง', w: 210, h: 297 }, a3l: { n: 'A3 แนวนอน', w: 420, h: 297 }, a3p: { n: 'A3 แนวตั้ง', w: 297, h: 420 }, auto: { n: 'ตามขนาดผัง (ไม่กำหนดกระดาษ)', w: 0, h: 0 } };
function expOpts() {
  var e = fam.exp = fam.exp || {};
  var d = { snip: true, title: true, legendMode: e.legend === false ? 'none' : 'used', gen: fam.gen !== false, alias: true, paper: 'a4l', margin: 15, subtitle: true, mode: 'single', bookPt: 8, longPt: 6, condFill: !!fam.condFill, mono: !!fam.mono, unk: fam.unk !== false, unkBlank: !!fam.unkBlank };
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
/* people selected on the chart when the export dialog was opened → crop box (symbols + their labels) */
var expCropIds = [];
function snipIds(o) { /* people whose symbol lies inside the snipped rectangle */
  var z = state.snip; if (!z || o.snip === false) return null;
  return state.persons.filter(function (p) { return p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h; }).map(function (p) { return p.id; });
}
function cropBBox(o, ctx) {
  if (state.snip && o.snip !== false) return { x: state.snip.x, y: state.snip.y, w: state.snip.w, h: state.snip.h };
  if (!o.crop || !expCropIds.length) return null;
  var set = {}; expCropIds.forEach(function (i) { set[i] = 1; });
  var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, PADC = 26;
  GE.personBoxes(state, ctx).forEach(function (b) { if (!set[b.id]) return; x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); });
  if (x0 > x1) return null;
  return { x: x0 - PADC, y: y0 - PADC, w: x1 - x0 + 2 * PADC, h: y1 - y0 + 2 * PADC };
}
function clipTo(cb, content, id) { return cb ? '<defs><clipPath id="' + id + '"><rect x="' + cb.x + '" y="' + cb.y + '" width="' + cb.w + '" height="' + cb.h + '"/></clipPath></defs><g clip-path="url(#' + id + ')">' + content + '</g>' : content; }
function buildExport(o) {
  var ctx = ctxFor(fam, { alias: o.alias, gen: o.gen, condFill: o.condFill, mono: o.mono, unk: o.unk, unkBlank: o.unkBlank, pre: 'x_', nosel: true });
  var content = GE.inner(state, ctx), bb = measure(content), cb = cropBBox(o, ctx); if (cb) bb = cb;
  var lmode = o.legendMode || (o.legend === false ? 'none' : 'used'), padv = 26, items = lmode === 'none' ? [] : GE.legendItems(state, ctx, lmode), cw = Math.max(bb.w, 560), parts = '', y = padv;
  var title = o.title && fam.title ? fam.title : '', sub = [];
  if (o.title && o.subtitle) { if (fam.house) sub.push('บ้านเลขที่ ' + fam.house); if (fam.place) sub.push(fam.place); if (fam.date) sub.push('ข้อมูล ณ วันที่ ' + thaiDate(fam.date)); }
  if (title) { y += 22; parts += '<text x="' + (cw / 2 + padv) + '" y="' + y + '" text-anchor="middle" font-size="22" font-weight="600" fill="#1f2a44">' + esc(title) + '</text>'; y += 8; }
  if (sub.length) { y += 18; parts += '<text x="' + (cw / 2 + padv) + '" y="' + y + '" text-anchor="middle" font-size="14" fill="#4a5d80">' + esc(sub.join('   ·   ')) + '</text>'; y += 6; }
  if (title || sub.length) y += 14;
  var ox = padv + (cw - bb.w) / 2 - bb.x, oy = y - bb.y;
  parts += '<g transform="translate(' + ox.toFixed(1) + ',' + oy.toFixed(1) + ')">' + clipTo(cb, content, 'x_crop') + '</g>'; y += bb.h + 22;
  if (items.length) {
    parts += '<line x1="' + padv + '" y1="' + y + '" x2="' + (padv + cw) + '" y2="' + y + '" stroke="#d6d0bd" stroke-width="1"/>'; y += 22;
    parts += '<text x="' + padv + '" y="' + y + '" font-size="14" font-weight="600" fill="#1f2a44">' + (lmode === 'standard' ? GE.LEGEND_TITLE : 'สัญลักษณ์') + '</text>'; y += 8;
    var lx = 0, ly = 0, rowH = 46;
    items.forEach(function (it) {
      var w = 66 + 8 + Math.min(300, it.label.length * 7.4) + 22;
      if (lx > 0 && lx + w > cw) { lx = 0; ly += rowH; }
      parts += '<g transform="translate(' + (padv + lx) + ',' + (y + ly) + ')">' + it.svg + '<text x="74" y="27" font-size="12.5" fill="#1f2a44">' + esc(it.label) + '</text></g>';
      lx += w;
    });
    y += ly + rowH;
  }
  var W0 = Math.round(cw + 2 * padv), H0 = Math.round(y + padv - 10), rot = !!o.rotate; /* rotate: turn the whole picture 90° counter-clockwise (generations run left→right) so a wide chart fills a portrait page */
  var W = rot ? H0 : W0, Ht = rot ? W0 : H0;
  function build(wA, hA) { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + Ht + '" width="' + wA + '" height="' + hA + '" font-family="' + GE.FONT.replace(/"/g, "'") + '"><style>' + fontCss() + '</style><rect width="' + W + '" height="' + Ht + '" fill="#fff"/>' + (rot ? '<g transform="translate(0,' + W0 + ') rotate(-90)">' + parts + '</g>' : parts) + '</svg>'; }
  var P = PAPERS[o.paper] || PAPERS.auto, s = null, minPt = null, A = P.w ? P : PAPERS.a4l;
  if (P.w) { s = Math.min((P.w - 2 * o.margin) / W, (P.h - 2 * o.margin) / Ht, 0.35); minPt = 12.5 * s * 72 / 25.4; }
  var miss = state.persons.filter(function (p) { return p.name && !(o.unk !== false && GE.isUnk(p.name)) && !String(p.alias || '').trim(); }).length;
  return { build: build, W: W, H: Ht, s: s, minPt: minPt, paper: P, A: A, missingAlias: miss, svg: build(W, Ht) };
}
/* ================= book export: 1 overview page + readable detail pages ================= */
function genRowLabels(st) {
  var g = GE.gens(st), rows = {};
  st.persons.forEach(function (p) { var v = g[p.id]; if (v != null) (rows[v] = rows[v] || []).push(p.y); });
  return Object.keys(rows).map(function (k) { var ys = rows[k]; return { y: ys.reduce(function (a, b) { return a + b; }, 0) / ys.length, t: GE.ROMAN[+k] || String(+k + 1) }; });
}
function tileCuts(boxes, pairs, mp, x0, x1, capW) {
  var cuts = [x0], start = x0;
  while (x1 - start > capW + 1) {
    var end = start + capW, best = end, bs = -1e18;
    for (var c = end; c >= start + capW * 0.5; c -= 3) {
      var sc = 0, i;
      for (i = 0; i < boxes.length; i++) if (boxes[i].x0 < c && boxes[i].x1 > c) sc -= 500;
      for (i = 0; i < pairs.length; i++) { var a = mp[pairs[i][0]], b = mp[pairs[i][1]]; if (a && b && Math.min(a.x, b.x) < c && Math.max(a.x, b.x) > c) sc -= 200; }
      sc -= (end - c) * 1.3;
      if (sc > bs) { bs = sc; best = c; }
    }
    cuts.push(best); start = best;
  }
  cuts.push(x1); return cuts;
}
function buildBook(o) {
  var one = o.mode === 'one', P = (PAPERS[o.paper] && PAPERS[o.paper].w) ? PAPERS[o.paper] : PAPERS.a4l, m = Math.max(5, +o.margin || 12), minPt = Math.max(5, +o.bookPt || 8);
  var base = { alias: o.alias, condFill: o.condFill, mono: o.mono, unk: o.unk, unkBlank: o.unkBlank, nosel: true };
  var ctx = ctxFor(fam, Object.assign({ gen: false, pre: 'x_' }, base)), ctxO = ctxFor(fam, Object.assign({ gen: true, pre: 'x_' }, base));
  var content = GE.inner(state, ctx), bb = measure(content), PADU = 24;
  bb = { x: bb.x - PADU, y: bb.y - PADU, w: bb.w + 2 * PADU, h: bb.h + 2 * PADU };
  var boxes = GE.personBoxes(state, ctx), segs = GE.lineSegs(state), mp = ixOf(), pairs = state.unions.filter(function (u) { return u.a && u.b; }).map(function (u) { return [u.a, u.b]; });
  var HDR = 11, FTR = 7, GUT = 10, title = fam.title || 'ผังเครือญาติ';
  var Wmm = P.w - 2 * m - GUT, Hmm = P.h - 2 * m - HDR - FTR;
  var s = minPt * 25.4 / 72 / 12.5, cuts, tiles, it;
  function tileWin(c0, c1) {
    var y0 = 1e9, y1 = -1e9;
    boxes.forEach(function (b) { if (b.x1 > c0 && b.x0 < c1) { y0 = Math.min(y0, b.y0); y1 = Math.max(y1, b.y1); } });
    segs.forEach(function (g) { if (Math.max(g[0], g[2]) > c0 && Math.min(g[0], g[2]) < c1) { y0 = Math.min(y0, g[1], g[3]); y1 = Math.max(y1, g[1], g[3]); } });
    if (y0 > y1) { y0 = bb.y; y1 = bb.y + bb.h; }
    return { y0: y0 - PADU, y1: y1 + PADU };
  }
  for (it = 0; it < 5; it++) {
    cuts = tileCuts(boxes, pairs, mp, bb.x, bb.x + bb.w, Wmm / s);
    tiles = []; var maxH = 0;
    for (var i = 0; i + 1 < cuts.length; i++) { var w = tileWin(cuts[i], cuts[i + 1]); tiles.push({ c0: cuts[i], c1: cuts[i + 1], y0: w.y0, y1: w.y1 }); maxH = Math.max(maxH, w.y1 - w.y0); }
    var sNew = Math.min(minPt * 25.4 / 72 / 12.5, Hmm / maxH);
    if (Math.abs(sNew - s) < 1e-6) break; s = sNew;
  }
  tiles.forEach(function (t, i) {
    t.e0 = t.c0; t.e1 = t.c1;
    if (i > 0) boxes.forEach(function (b) { if (b.x0 < t.c0 && b.x1 > t.c0 && t.c0 - b.x0 < 140) t.e0 = Math.min(t.e0, b.x0 - 2); });
    if (i < tiles.length - 1) boxes.forEach(function (b) { if (b.x0 < t.c1 && b.x1 > t.c1 && b.x1 - t.c1 < 140) t.e1 = Math.max(t.e1, b.x1 + 2); });
  });
  var ptEff = 12.5 * s * 72 / 25.4, N = tiles.length, sTxt = minPt * 25.4 / 72 / 12.5;
  var font = GE.FONT.replace(/"/g, "'");
  function wrap(inner, wA, hA, withFont) { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + P.w + ' ' + P.h + '" width="' + wA + '" height="' + hA + '" font-family="' + font + '">' + (withFont ? '<style>' + fontCss() + '</style>' : '') + '<rect width="' + P.w + '" height="' + P.h + '" fill="#fff"/>' + inner + '</svg>'; }
  function head(pg, tot, sub) {
    return '<text x="' + m + '" y="' + (m + 5) + '" font-size="5" font-weight="600" fill="#1f2a44">' + esc(title) + '</text>' +
      (sub ? '<text x="' + m + '" y="' + (m + 9.4) + '" font-size="3" fill="#4a5d80">' + esc(sub) + '</text>' : '') +
      '<text x="' + (P.w - m) + '" y="' + (m + 5) + '" text-anchor="end" font-size="3.6" fill="#4a5d80">หน้า ' + pg + ' / ' + tot + '</text>';
  }
  var sub = [fam.house ? 'บ้านเลขที่ ' + fam.house : '', fam.place || '', fam.date ? 'ข้อมูล ณ วันที่ ' + thaiDate(fam.date) : ''].filter(Boolean).join('   ·   ');
  var total = one ? 1 : (N > 1 ? N + 1 : 1), pages = [], ovPt = null;
  /* ---- overview ---- */
  if (N > 1 || one) {
    var cO = GE.inner(state, ctxO), bo = measure(cO), items = (o.legendMode === 'none') ? [] : GE.legendItems(state, ctxO, o.legendMode || 'used');
    var sl = one ? sTxt * 0.5 : sTxt, capL = (P.w - 2 * m) / sl, lx = 0, ly = 0, RH = 46, lg = '';
    var legY0 = 0, rowsPos = [];
    items.forEach(function (it2) { var w2 = 66 + 8 + Math.min(300, it2.label.length * 7.4) + 22; if (lx > 0 && lx + w2 > capL) { lx = 0; ly += RH; } rowsPos.push([lx, ly, it2]); lx += w2; });
    var legH = items.length ? (ly + RH) * sl + 8 : 0;
    var Ho = P.h - 2 * m - HDR - FTR - legH - 3, Wo = P.w - 2 * m, bestK = 1, so = 0, GAPS = 4, k, kcuts, kwin;
    var boxesO = GE.personBoxes(state, ctxO);
    function evenCuts(kk) {
      var cs = [bo.x], span = bo.w / kk;
      for (var j = 1; j < kk; j++) {
        var ideal = bo.x + span * j, best = ideal, bs = -1e18;
        for (var c = ideal - 0.12 * span; c <= ideal + 0.12 * span; c += 3) {
          var sc = -Math.abs(c - ideal) * 1.3, i;
          for (i = 0; i < boxesO.length; i++) if (boxesO[i].x0 < c && boxesO[i].x1 > c) sc -= 500;
          for (i = 0; i < pairs.length; i++) { var pa = mp[pairs[i][0]], pb = mp[pairs[i][1]]; if (pa && pb && Math.min(pa.x, pb.x) < c && Math.max(pa.x, pb.x) > c) sc -= 200; }
          if (sc > bs) { bs = sc; best = c; }
        }
        cs.push(best);
      }
      cs.push(bo.x + bo.w); return cs;
    }
    for (k = 1; k <= (one ? 7 : 5); k++) {
      var cc = evenCuts(k), wins = [], wmax = 0, sumH = 0;
      for (var q = 0; q < k; q++) { var wq = tileWin(cc[q], cc[q + 1]); wins.push(wq); wmax = Math.max(wmax, cc[q + 1] - cc[q]); sumH += wq.y1 - wq.y0; }
      var sK = Math.min(Wo / wmax, (Ho - GAPS * (k - 1)) / sumH);
      if (sK > so) { so = sK; bestK = k; kcuts = cc; kwin = wins; }
    }
    var strips = '', yoff = 0;
    for (k = 0; k < bestK; k++) {
      var a0 = kcuts[k], a1 = kcuts[k + 1], wn = kwin[k], hh = (wn.y1 - wn.y0) * so, tx = m + (Wo - (a1 - a0) * so) / 2 - a0 * so, ty = m + HDR + yoff - wn.y0 * so, cidO = 'ovc' + k;
      var fr = '';
      if (!one) tiles.forEach(function (t, i) {
        var x0 = Math.max(t.c0, a0), x1 = Math.min(t.c1, a1); if (x1 <= x0) return;
        var fs = 3.4 / so;
        fr += '<rect x="' + x0 + '" y="' + t.y0 + '" width="' + (x1 - x0) + '" height="' + (t.y1 - t.y0) + '" fill="rgba(232,89,12,.06)" stroke="#e8590c" stroke-width="' + (0.35 / so) + '" stroke-dasharray="' + (1.8 / so) + ' ' + (1.1 / so) + '"/>' +
          '<text x="' + (x0 + 1 / so) + '" y="' + (t.y0 + fs * 1.0) + '" font-size="' + fs + '" font-weight="700" fill="#e8590c" paint-order="stroke" stroke="#fff" stroke-width="' + (0.7 / so) + '">หน้า ' + (i + 2) + '</text>';
      });
      strips += '<defs><clipPath id="' + cidO + '"><rect x="' + a0 + '" y="' + wn.y0 + '" width="' + (a1 - a0) + '" height="' + (wn.y1 - wn.y0) + '"/></clipPath></defs><g transform="translate(' + tx.toFixed(3) + ',' + ty.toFixed(3) + ') scale(' + so.toFixed(5) + ')"><g clip-path="url(#' + cidO + ')">' + cO + fr + '</g></g>' +
        (bestK > 1 ? '<text x="' + (P.w - m) + '" y="' + (m + HDR + yoff - 0.6) + '" text-anchor="end" font-size="2.4" fill="#9aa7c0">แถวที่ ' + (k + 1) + '/' + bestK + (k < bestK - 1 ? ' — ต่อแถวถัดไป' : '') + '</text>' : '');
      yoff += hh + GAPS;
    }
    ovPt = 12.5 * so * 72 / 25.4;
    var ovInner = head(1, total, sub) + strips;
    if (items.length) {
      var gy = P.h - m - FTR - legH + 3;
      ovInner += '<line x1="' + m + '" y1="' + (gy - 2) + '" x2="' + (P.w - m) + '" y2="' + (gy - 2) + '" stroke="#d6d0bd" stroke-width="0.25"/>';
      rowsPos.forEach(function (r) { ovInner += '<g transform="translate(' + (m + r[0] * sl).toFixed(2) + ',' + (gy + r[1] * sl).toFixed(2) + ') scale(' + sl.toFixed(5) + ')">' + r[2].svg + '<text x="74" y="27" font-size="12.5" fill="#1f2a44">' + esc(r[2].label) + '</text></g>'; });
    }
    ovInner += '<text x="' + (P.w / 2) + '" y="' + (P.h - m - 1) + '" text-anchor="middle" font-size="2.8" fill="#6b7280">' + (one ? 'ผังทั้งหมดในหน้าเดียว · ตัวหนังสือเล็กสุด ≈ ' + ovPt.toFixed(1) + ' pt บนกระดาษ — ซูมในไฟล์ PDF เพื่ออ่านรายละเอียด (เวกเตอร์ ไม่แตก)' : 'ภาพรวมทั้งผัง · กรอบสีส้มคือส่วนที่แสดงในแต่ละหน้า · ตัวหนังสือในหน้านี้เล็ก ดูรายละเอียดที่หน้า 2–' + total + ' (หรือซูมในไฟล์ PDF)') + '</text>';
    pages.push({ kind: 'overview', build: function (w, h, f) { return wrap(ovInner, w, h, f); } });
  }
  /* ---- detail pages ---- */
  var gl = genRowLabels(state);
  if (!one) tiles.forEach(function (t, i) {
    var th = t.y1 - t.y0, x0m = m + GUT, y0m = m + HDR, cid = 'bkc' + i, pg = (N > 1 ? i + 2 : 1);
    var tf = 'translate(' + (x0m - t.c0 * s).toFixed(3) + ',' + (y0m - t.y0 * s).toFixed(3) + ') scale(' + s.toFixed(5) + ')';
    var fsz = 12.5, marks = '', seen = {};
    function mark(y, txt, left) { var k = Math.round(y / 14); if (seen[(left ? 'L' : 'R') + k]) return; seen[(left ? 'L' : 'R') + k] = 1; marks += '<text x="' + (left ? t.c0 + 3 : t.c1 - 3) + '" y="' + (y - 4) + '" text-anchor="' + (left ? 'start' : 'end') + '" font-size="' + fsz + '" font-weight="600" fill="#e8590c" paint-order="stroke" stroke="#fff" stroke-width="3" stroke-linejoin="round">' + txt + '</text>'; }
    segs.forEach(function (g) { if (Math.abs(g[1] - g[3]) > 1) return; var xa = Math.min(g[0], g[2]), xb = Math.max(g[0], g[2]), y = g[1]; if (y < t.y0 || y > t.y1) return; if (i < N - 1 && xa < t.c1 && xb > t.c1) mark(y, 'ต่อหน้า ' + (pg + 1) + ' ▶', false); if (i > 0 && xa < t.c0 && xb > t.c0) mark(y, '◀ ต่อจากหน้า ' + (pg - 1), true); });
    var gtxt = gl.filter(function (r) { return r.y > t.y0 && r.y < t.y1; }).map(function (r) { return '<text x="' + (t.c0 - GUT / 2 / s) + '" y="' + (r.y + 6) + '" text-anchor="middle" font-size="19" font-weight="600" fill="#7a8bab">' + r.t + '</text>'; }).join('');
    var inner = head(pg, total, sub) +
      '<defs><clipPath id="' + cid + '"><rect x="' + t.e0 + '" y="' + t.y0 + '" width="' + (t.e1 - t.e0) + '" height="' + th + '"/></clipPath></defs>' +
      '<g transform="' + tf + '">' + (o.gen !== false ? gtxt : '') + '<g clip-path="url(#' + cid + ')">' + content + marks + '</g></g>' +
      '<text x="' + (P.w / 2) + '" y="' + (P.h - m - 1) + '" text-anchor="middle" font-size="2.8" fill="#6b7280">' + (N > 1 ? 'สัญลักษณ์ดูหน้า 1 · ' : '') + 'ตัวหนังสือเล็กสุด ≈ ' + ptEff.toFixed(1) + ' pt</text>';
    pages.push({ kind: 'detail', build: function (w, h, f) { return wrap(inner, w, h, f); } });
  });
  var miss = state.persons.filter(function (p) { return p.name && !(o.unk !== false && GE.isUnk(p.name)) && !String(p.alias || '').trim(); }).length;
  return { book: true, one: one, ovPt: ovPt, pages: pages, P: P, N: N, total: total, ptEff: ptEff, ptWant: minPt, shrunk: ptEff < minPt * 0.95, missingAlias: miss, cuts: cuts, tiles: tiles, straddle: cuts.slice(1, -1).map(function (c) { return boxes.filter(function (b) { return b.x0 < c && b.x1 > c; }).length; }) };
}

/* ---- "report style": whole chart on 1 or 2 landscape/portrait pages, text enlarged relative to symbols, rows folded to fill each page ---- */
function buildReport(o) {
  var P = (PAPERS[o.paper] && PAPERS[o.paper].w) ? PAPERS[o.paper] : PAPERS.a4l, m = Math.max(5, +o.margin || 12), NP = (+o.repPages === 1) ? 1 : 2, TS = Math.max(1, Math.min(3, +o.repScale || 1.7));
  var saved = state, st2 = clone(state), cropped = false;
  var cids = snipIds(o) || ((o.crop && expCropIds.length) ? expCropIds : null);
  if (cids && cids.length) { /* only the selected people (a family line or the snipped area): drop everyone else so the page is spent on them */
    var keep = {}, kun = {}; cids.forEach(function (i) { keep[i] = 1; });
    st2.persons = st2.persons.filter(function (p) { return keep[p.id]; });
    st2.unions = st2.unions.filter(function (u) { var ok = u.a && keep[u.a] && (!u.b || keep[u.b]); if (ok) kun[u.id] = 1; return ok; });
    st2.persons.forEach(function (p) { if (p.from && !kun[p.from]) delete p.from; });
    st2.rels = st2.rels.filter(function (r) { return keep[r.a] && keep[r.b]; });
    st2.homes.forEach(function (h) { h.ids = h.ids.filter(function (i) { return keep[i]; }); }); st2.homes = st2.homes.filter(function (h) { return h.ids.length; });
    cropped = true;
  }
  st2.persons.forEach(function (p) { p.ls = (p.ls || 1) * TS; if (o.repLean) { delete p.edu; delete p.occ; delete p.role; delete p.mig; delete p.risk; delete p.note; } });
  var base = { alias: o.alias, condFill: o.condFill, mono: o.mono, unk: o.unk, unkBlank: o.unkBlank, nosel: true };
  var out;
  state = st2;
  try {
    var ctx0 = ctxFor(fam, Object.assign({ gen: false, pre: 'x_' }, base));
    var al = GE.autoLabels(st2, ctx0);
    st2.persons.forEach(function (p) { if (!p.lo && al[p.id] !== undefined) { if (al[p.id]) p.lp = al[p.id]; else delete p.lp; } });
    /* count label/symbol boxes that overlap, optionally shrink only the crowded labels */
    function overlapPairs() {
      var bx = GE.personBoxes(st2, ctx0), out = [];
      for (var i = 0; i < bx.length; i++) for (var j = i + 1; j < bx.length; j++) {
        var a = bx[i], b = bx[j]; if (a.id === b.id) continue;
        var w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (w > 4 && h > 4) out.push([a.id, b.id, w * h]);
      }
      return out;
    }
    var ovBefore = overlapPairs().length, ovAfter = ovBefore, minLs = TS, mp0 = ixOf();
    if (o.repFit !== false) {
      for (var itx = 0; itx < 10 && ovAfter; itx++) {
        var prs = overlapPairs(), hit = {};
        prs.forEach(function (pr) { var a = mp0[pr[0]], b = mp0[pr[1]]; if (!a || !b) return; var v = (a.ls || 1) >= (b.ls || 1) ? a : b; hit[v.id] = v; });
        Object.keys(hit).forEach(function (id) { var v = hit[id]; if (!v.lo) v.ls = Math.max(1.05, (v.ls || 1) * 0.9); });
        if (itx % 2 === 1) { var al2 = GE.autoLabels(st2, ctx0); st2.persons.forEach(function (q) { if (!q.lo && al2[q.id] !== undefined) { if (al2[q.id]) q.lp = al2[q.id]; else delete q.lp; } }); }
        ovAfter = overlapPairs().length;
      }
      st2.persons.forEach(function (q) { minLs = Math.min(minLs, q.ls || 1); });
    }
    var ctxO = ctxFor(fam, Object.assign({ gen: o.gen !== false && !cropped, pre: 'x_' }, base));
    var cO = GE.inner(st2, ctxO), bo = measure(cO), PADU = 24;
    bo = { x: bo.x - PADU, y: bo.y - PADU, w: bo.w + 2 * PADU, h: bo.h + 2 * PADU };
    var boxes = GE.personBoxes(st2, ctxO), segs = GE.lineSegs(st2), mpx = ixOf(), pairs = st2.unions.filter(function (u) { return u.a && u.b; }).map(function (u) { return [u.a, u.b]; });
    var HDR = 11, FTR = 6, GAPS = 4, title = fam.title || 'ผังเครือญาติ', Wo = P.w - 2 * m;
    var items = (o.legendMode === 'none') ? [] : GE.legendItems(st2, ctxO, o.legendMode || 'used');
    var RH = 46;
    function legLay(sl) {
      var capL = Wo / sl, lx = 0, ly = 0, rp = [];
      items.forEach(function (it2) { var w2 = 66 + 8 + Math.min(300, it2.label.length * 7.4) + 22; if (lx > 0 && lx + w2 > capL) { lx = 0; ly += RH; } rp.push([lx, ly, it2]); lx += w2; });
      return { rows: rp, h: items.length ? (ly + RH) * sl + 6 : 0 };
    }
    var slg = 0.12 * (P.w / 297), LL = legLay(slg), rowsPos = LL.rows, legH = LL.h;
    function tileWin(c0, c1) {
      var y0 = 1e9, y1 = -1e9;
      boxes.forEach(function (b) { if (b.x1 > c0 && b.x0 < c1) { y0 = Math.min(y0, b.y0); y1 = Math.max(y1, b.y1); } });
      segs.forEach(function (g) { if (Math.max(g[0], g[2]) > c0 && Math.min(g[0], g[2]) < c1) { y0 = Math.min(y0, g[1], g[3]); y1 = Math.max(y1, g[1], g[3]); } });
      if (y0 > y1) { y0 = bo.y; y1 = bo.y + bo.h; }
      return { y0: y0 - PADU, y1: y1 + PADU };
    }
    function cleanCut(ideal, span) {
      var best = ideal, bs = -1e18;
      for (var c = ideal - 0.3 * span; c <= ideal + 0.3 * span; c += 3) {
        var sc = -Math.abs(c - ideal) * 0.6, i;
        for (i = 0; i < boxes.length; i++) if (boxes[i].x0 < c && boxes[i].x1 > c) sc -= 500;
        for (i = 0; i < pairs.length; i++) { var pa = mpx[pairs[i][0]], pb = mpx[pairs[i][1]]; if (pa && pb && Math.min(pa.x, pb.x) < c && Math.max(pa.x, pb.x) > c) sc -= 200; }
        if (sc > bs) { bs = sc; best = c; }
      }
      return best;
    }
    /* best fold of the column range [a,b] into k rows for a page of usable height Hp: returns scale + rows */
    function foldBest(a, b, Hp) {
      var bestS = 0, rows = null;
      var RR = Math.max(0, Math.min(8, +o.repRows || 0));
      for (var k = RR || 1; k <= (RR || 8); k++) {
        var cs = [a], span = (b - a) / k, j;
        for (j = 1; j < k; j++) cs.push(cleanCut(a + span * j, span));
        cs.push(b);
        var wins = [], wmax = 0, sumH = 0;
        for (j = 0; j < k; j++) { var w = tileWin(cs[j], cs[j + 1]); wins.push(w); wmax = Math.max(wmax, cs[j + 1] - cs[j]); sumH += w.y1 - w.y0; }
        var sK = Math.min(Wo / wmax, (Hp - GAPS * (k - 1)) / sumH);
        if (sK > bestS) { bestS = sK; rows = { cuts: cs, wins: wins }; }
      }
      if (!rows) { var w0 = tileWin(a, b); rows = { cuts: [a, b], wins: [w0] }; bestS = Math.max(1e-4, Math.min(Wo / (b - a), Math.max(10, Hp) / (w0.y1 - w0.y0))); }
      return { s: bestS, rows: rows };
    }
    function foldFixed(cs, Hp) {
      var wins = [], wmax = 0, sumH = 0;
      for (var j = 0; j + 1 < cs.length; j++) { var w = tileWin(cs[j], cs[j + 1]); wins.push(w); wmax = Math.max(wmax, cs[j + 1] - cs[j]); sumH += w.y1 - w.y0; }
      return { s: Math.max(1e-4, Math.min(Wo / wmax, (Hp - GAPS * (cs.length - 2)) / sumH)), rows: { cuts: cs, wins: wins } };
    }
    var manualCuts = [];
    st2.persons.forEach(function (q) { if (!q.brk) return; var bx = boxes.filter(function (b) { return b.id === q.id; })[0]; if (bx) manualCuts.push(bx.x0 - 6); });
    (st2.cuts || []).forEach(function (cx) { manualCuts.push(cx); });
    manualCuts = manualCuts.sort(function (a, b) { return a - b; }).filter(function (c, i, arr) { return c > bo.x + 20 && c < bo.x + bo.w - 20 && (!i || c - arr[i - 1] > 30); });
    var Hfull = P.h - 2 * m - HDR - FTR - 2, plan = null;
    if (manualCuts.length) { /* the user placed the row breaks: use exactly those */
      var allC = [bo.x].concat(manualCuts, [bo.x + bo.w]);
      if (NP === 1) { var fm = foldFixed(allC, Hfull - legH); plan = { s: fm.s, parts: [fm.rows] }; }
      else { var mh = Math.ceil((allC.length - 1) / 2), fa2 = foldFixed(allC.slice(0, mh + 1), Hfull), fb2 = foldFixed(allC.slice(mh), Hfull - legH); plan = { s: Math.min(fa2.s, fb2.s), parts: [fa2.rows, fb2.rows] }; }
    } else if (NP === 1) { var f1 = foldBest(bo.x, bo.x + bo.w, Hfull - legH); plan = { s: f1.s, parts: [f1.rows] }; }
    else {
      for (var fr = 0.34; fr <= 0.66; fr += 0.02) {
        var cut = cleanCut(bo.x + bo.w * fr, bo.w * 0.1), fa = foldBest(bo.x, cut, Hfull), fb = foldBest(cut, bo.x + bo.w, Hfull - legH), sc2 = Math.min(fa.s, fb.s);
        if (!plan || sc2 > plan.s) plan = { s: sc2, parts: [fa.rows, fb.rows] };
      }
    }
    var so = plan.s, pages = [], font = GE.FONT.replace(/"/g, "'");
    if (items.length) { /* use the empty space under the last page's chart for a bigger legend */
      var lastRows = plan.parts[plan.parts.length - 1], usedH = 0; lastRows.wins.forEach(function (w) { usedH += (w.y1 - w.y0) * so; }); usedH += GAPS * (lastRows.wins.length - 1);
      var freeH = Hfull - usedH - 4, best = LL;
      var slg0 = slg; for (var kk = 1.1; kk <= 3; kk += 0.1) { var cand = legLay(slg0 * kk); if (cand.h <= freeH) { best = cand; slg = slg0 * kk; } else break; }
      rowsPos = best.rows; legH = best.h;
    }
    function wrapSvg(inner, wA, hA, withFont) { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + P.w + ' ' + P.h + '" width="' + wA + '" height="' + hA + '" font-family="' + font + '">' + (withFont ? '<style>' + fontCss() + '</style>' : '') + '<rect width="' + P.w + '" height="' + P.h + '" fill="#fff"/>' + inner + '</svg>'; }
    plan.parts.forEach(function (rows, pi) {
      var inner = '', yoff = 0, nr = rows.wins.length;
      if (o.title !== false) inner += '<text x="' + m + '" y="' + (m + 5) + '" font-size="5" font-weight="600" fill="#1f2a44">' + esc(title) + (pi > 0 ? ' (ต่อ)' : '') + '</text>';
      for (var k = 0; k < nr; k++) {
        var a0 = rows.cuts[k], a1 = rows.cuts[k + 1], wn = rows.wins[k], hh = (wn.y1 - wn.y0) * so, tx = m + (Wo - (a1 - a0) * so) / 2 - a0 * so, ty = m + HDR + yoff - wn.y0 * so, cid = 'rpc' + pi + '_' + k;
        inner += '<defs><clipPath id="' + cid + '"><rect x="' + a0 + '" y="' + wn.y0 + '" width="' + (a1 - a0) + '" height="' + (wn.y1 - wn.y0) + '"/></clipPath></defs><g transform="translate(' + tx.toFixed(3) + ',' + ty.toFixed(3) + ') scale(' + so.toFixed(5) + ')"><g clip-path="url(#' + cid + ')">' + cO + '</g></g>';
        if (nr > 1 && k < nr - 1) inner += '<text x="' + (P.w - m) + '" y="' + (m + HDR + yoff + hh + 2.2) + '" text-anchor="end" font-size="2.2" fill="#9aa7c0">ต่อแถวถัดไป ▼</text>';
        yoff += hh + GAPS;
      }
      if (pi === plan.parts.length - 1 && items.length) {
        var gy = P.h - m - FTR - legH + 3;
        inner += '<line x1="' + m + '" y1="' + (gy - 2) + '" x2="' + (P.w - m) + '" y2="' + (gy - 2) + '" stroke="#d6d0bd" stroke-width="0.25"/>';
        rowsPos.forEach(function (r) { inner += '<g transform="translate(' + (m + r[0] * slg).toFixed(2) + ',' + (gy + r[1] * slg).toFixed(2) + ') scale(' + slg.toFixed(5) + ')">' + r[2].svg + '<text x="74" y="27" font-size="12.5" fill="#1f2a44">' + esc(r[2].label) + '</text></g>'; });
      }
      pages.push({ kind: 'report', build: function (w, h, f) { return wrapSvg(inner, w, h, f); } });
    });
    var nameMin = 15 * minLs * so * 72 / 25.4, noteMin = 12.5 * minLs * so * 72 / 25.4;
    var miss = st2.persons.filter(function (p) { return p.name && !(o.unk !== false && GE.isUnk(p.name)) && !String(p.alias || '').trim(); }).length;
    out = { book: true, rep: true, pages: pages, P: P, N: pages.length, total: pages.length, nameMin: nameMin, noteMin: noteMin, so: so, missingAlias: miss, rowsPerPage: plan.parts.map(function (r) { return r.wins.length; }), manual: manualCuts.length, ovBefore: ovBefore, ovAfter: ovAfter, nameNominal: 15 * TS * so * 72 / 25.4 };
  } finally { state = saved; }
  return out;
}
/* ---- one long row on an extra-wide custom page (PDF only: zoom or draw over it on a tablet) ---- */
function buildLong(o) {
  var m = Math.max(5, +o.margin || 12), pt = Math.max(3, +o.longPt || 6), s = pt * 25.4 / 72 / 12.5;
  var base = { alias: o.alias, condFill: o.condFill, mono: o.mono, unk: o.unk, unkBlank: o.unkBlank, nosel: true };
  var ctxO = ctxFor(fam, Object.assign({ gen: o.gen !== false, pre: 'x_' }, base));
  var cO = GE.inner(state, ctxO), bo = measure(cO), PAD = 20, title = fam.title || 'ผังเครือญาติ', cbL = cropBBox(o, ctxO); if (cbL) bo = cbL;
  var HDR = 11, FTR = 7;
  var items = (o.legendMode === 'none') ? [] : GE.legendItems(state, ctxO, o.legendMode || 'used');
  var capL = Math.min(bo.w, 1400), lx = 0, ly = 0, RH = 46, rowsPos = [];
  items.forEach(function (it) { var w = 66 + 8 + Math.min(300, it.label.length * 7.4) + 22; if (lx > 0 && lx + w > capL) { lx = 0; ly += RH; } rowsPos.push([lx, ly, it]); lx += w; });
  var legH = items.length ? (ly + RH) * s + 8 : 0;
  var W = Math.round(bo.w * s + 2 * m + 2 * PAD * s), H = Math.round(HDR + bo.h * s + legH + FTR + 2 * m + 4);
  var P = { w: W, h: H, n: 'ยาวพิเศษ' }, font = GE.FONT.replace(/"/g, "'");
  var sub = [fam.house ? 'บ้านเลขที่ ' + fam.house : '', fam.place || '', fam.date ? 'ข้อมูล ณ วันที่ ' + thaiDate(fam.date) : ''].filter(Boolean).join('   ·   ');
  var inner = '<text x="' + m + '" y="' + (m + 5) + '" font-size="5" font-weight="600" fill="#1f2a44">' + esc(title) + '</text>' + (sub ? '<text x="' + m + '" y="' + (m + 9.4) + '" font-size="3" fill="#4a5d80">' + esc(sub) + '</text>' : '') +
    '<g transform="translate(' + (m + PAD * s - bo.x * s).toFixed(3) + ',' + (m + HDR - bo.y * s).toFixed(3) + ') scale(' + s.toFixed(5) + ')">' + clipTo(cbL, cO, 'x_cropl') + '</g>';
  if (items.length) {
    var gy = m + HDR + bo.h * s + 6;
    rowsPos.forEach(function (r) { inner += '<g transform="translate(' + (m + r[0] * s).toFixed(2) + ',' + (gy + r[1] * s).toFixed(2) + ') scale(' + s.toFixed(5) + ')">' + r[2].svg + '<text x="74" y="27" font-size="12.5" fill="#1f2a44">' + esc(r[2].label) + '</text></g>'; });
  }
  var svgFn = function (w, h, f) { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + w + '" height="' + h + '" font-family="' + font + '">' + (f ? '<style>' + fontCss() + '</style>' : '') + '<rect width="' + W + '" height="' + H + '" fill="#fff"/>' + inner + '</svg>'; };
  var miss = state.persons.filter(function (p) { return p.name && !(o.unk !== false && GE.isUnk(p.name)) && !String(p.alias || '').trim(); }).length;
  return { book: true, long: true, pages: [{ kind: 'long', build: svgFn }], P: P, N: 1, total: 1, ptEff: pt, ptWant: pt, shrunk: false, missingAlias: miss, widthMm: W, heightMm: H, tooWide: W > 5080 };
}
function fillPrintBook(r) {
  var st = $('#pageCss'); if (!st) { st = document.createElement('style'); st.id = 'pageCss'; document.head.appendChild(st); }
  st.textContent = '@page{size:' + r.P.w + 'mm ' + r.P.h + 'mm;margin:0}';
  $('#printArea').innerHTML = r.pages.map(function (pg, i) { return '<div style="width:' + r.P.w + 'mm;height:' + r.P.h + 'mm;overflow:hidden;' + (i < r.pages.length - 1 ? 'break-after:page;page-break-after:always' : '') + '">' + pg.build(r.P.w + 'mm', r.P.h + 'mm', i === 0) + '</div>'; }).join('');
}
function pngOfSvg(svgStr, wmm, hmm, name) {
  var k = Math.min(300 / 25.4, 16000 / Math.max(wmm, hmm)), url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })), img = new Image();
  img.onload = function () {
    (img.decode ? img.decode() : Promise.resolve()).catch(function () { }).then(function () {
      var c = document.createElement('canvas'); c.width = Math.round(wmm * k); c.height = Math.round(hmm * k);
      var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(function (b) { if (b) dl(name, b); }, 'image/png');
    });
  };
  img.src = url;
}
function bookAction(r, a) {
  if (a === 'pdf') { fillPrintBook(r); $('#dExp').close(); setTimeout(function () { window.print(); }, 150); return; }
  r.pages.forEach(function (pg, i) {
    setTimeout(function () {
      var svg = pg.build(r.P.w + 'mm', r.P.h + 'mm', true), base = fname('x').replace(/\.x$/, '') + '-หน้า' + (i + 1);
      if (a === 'svg') dl(base + '.svg', new Blob([svg], { type: 'image/svg+xml' })); else pngOfSvg(svg, r.P.w, r.P.h, base + '.png');
    }, i * 900);
  });
  toast('กำลังดาวน์โหลด ' + r.pages.length + ' ไฟล์ — ถ้าเบราว์เซอร์ถาม ให้อนุญาตการดาวน์โหลดหลายไฟล์');
}
function dl(name, blob) {
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 1500);
}
/* ---------- Canva export: symbols/lines as one picture layer + every text line as its own editable PPTX text box ---------- */
var CRC_T = null;
function crc32(u8) {
  if (!CRC_T) { CRC_T = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
  var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files) {
  var enc = new TextEncoder(), out = [], cen = [], off = 0;
  function u16(v) { return [v & 255, (v >>> 8) & 255]; }
  function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
  function put(a) { var u = a instanceof Uint8Array ? a : new Uint8Array(a); out.push(u); off += u.length; }
  files.forEach(function (f) {
    var nm = enc.encode(f.n), crc = crc32(f.d), sz = f.d.length, at = off;
    put([].concat([0x50, 0x4b, 3, 4], u16(20), u16(0x0800), u16(0), u16(0), u16(33), u32(crc), u32(sz), u32(sz), u16(nm.length), u16(0)));
    put(nm); put(f.d);
    cen.push([].concat([0x50, 0x4b, 1, 2], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(33), u32(crc), u32(sz), u32(sz), u16(nm.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(at)), Array.prototype.slice.call(nm));
  });
  var cs = off; cen.forEach(function (c) { put(c); });
  put([].concat([0x50, 0x4b, 5, 6], u16(0), u16(0), u16(files.length), u16(files.length), u32(off - cs), u32(cs), u16(0)));
  return new Blob(out, { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
var NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main', NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
var XH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', NSALL = ' xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '"';
var GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
function pptxTheme() {
  function ln(w) { return '<a:ln w="' + w + '" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'; }
  var fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  return XH + '<a:theme xmlns:a="' + NS_A + '" name="Genogram"><a:themeElements><a:clrScheme name="Genogram"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2A44"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="234E8C"/></a:accent1><a:accent2><a:srgbClr val="D9534F"/></a:accent2><a:accent3><a:srgbClr val="2E9E6B"/></a:accent3><a:accent4><a:srgbClr val="D98B00"/></a:accent4><a:accent5><a:srgbClr val="5B2A86"/></a:accent5><a:accent6><a:srgbClr val="0A7F8F"/></a:accent6><a:hlink><a:srgbClr val="234E8C"/></a:hlink><a:folHlink><a:srgbClr val="5B2A86"/></a:folHlink></a:clrScheme>' +
    '<a:fontScheme name="Genogram"><a:majorFont><a:latin typeface="Sarabun"/><a:ea typeface=""/><a:cs typeface="Sarabun"/></a:majorFont><a:minorFont><a:latin typeface="Sarabun"/><a:ea typeface=""/><a:cs typeface="Sarabun"/></a:minorFont></a:fontScheme>' +
    '<a:fmtScheme name="Genogram"><a:fillStyleLst>' + fill + fill + fill + '</a:fillStyleLst><a:lnStyleLst>' + ln(6350) + ln(12700) + ln(19050) + '</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>' + fill + fill + fill + '</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';
}
function pptxBuild(slides, wmm, hmm) {
  var enc = new TextEncoder(), E = function (mm) { return Math.round(mm * 36000); }, files = [], n = slides.length;
  function x(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function add(name, str) { files.push({ n: name, d: enc.encode(str) }); }
  var ct = XH + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>';
  for (var i = 1; i <= n; i++) ct += '<Override PartName="/ppt/slides/slide' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
  add('[Content_Types].xml', ct + '</Types>');
  add('_rels/.rels', XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + NS_R + '/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
  var pr = XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + NS_R + '/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="' + NS_R + '/theme" Target="theme/theme1.xml"/>', ids = '';
  for (i = 1; i <= n; i++) { pr += '<Relationship Id="rId' + (i + 2) + '" Type="' + NS_R + '/slide" Target="slides/slide' + i + '.xml"/>'; ids += '<p:sldId id="' + (255 + i) + '" r:id="rId' + (i + 2) + '"/>'; }
  add('ppt/_rels/presentation.xml.rels', pr + '</Relationships>');
  add('ppt/presentation.xml', XH + '<p:presentation' + NSALL + '><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' + ids + '</p:sldIdLst><p:sldSz cx="' + E(wmm) + '" cy="' + E(hmm) + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>');
  add('ppt/theme/theme1.xml', pptxTheme());
  add('ppt/slideMasters/slideMaster1.xml', XH + '<p:sldMaster' + NSALL + '><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>' + GRP + '</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>');
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels', XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + NS_R + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="' + NS_R + '/theme" Target="../theme/theme1.xml"/></Relationships>');
  add('ppt/slideLayouts/slideLayout1.xml', XH + '<p:sldLayout' + NSALL + ' type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>' + GRP + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>');
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + NS_R + '/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>');
  slides.forEach(function (s, k) {
    var id = 2, body = '<p:pic><p:nvPicPr><p:cNvPr id="' + (id++) + '" name="สัญลักษณ์และเส้น"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + E(wmm) + '" cy="' + E(hmm) + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
    s.texts.forEach(function (t) {
      var pad = t.pt * 0.3528 * 0.4, w = t.w + 2 * pad, l = t.al === 'ctr' ? t.x + t.w / 2 - w / 2 : t.al === 'r' ? t.x + t.w + pad - w : t.x - pad;
      body += '<p:sp><p:nvSpPr><p:cNvPr id="' + (id++) + '" name="ข้อความ ' + (id - 2) + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="' + E(l) + '" y="' + E(t.y) + '"/><a:ext cx="' + E(w) + '" cy="' + E(t.h) + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="' + t.al + '"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:rPr lang="th-TH" sz="' + Math.max(100, Math.round(t.pt * 100)) + '" b="' + (t.b ? 1 : 0) + '" dirty="0"><a:solidFill><a:srgbClr val="' + t.col + '"/></a:solidFill><a:latin typeface="Sarabun"/><a:ea typeface="Sarabun"/><a:cs typeface="Sarabun"/></a:rPr><a:t>' + x(t.s) + '</a:t></a:r></a:p></p:txBody></p:sp>';
    });
    add('ppt/slides/slide' + (k + 1) + '.xml', XH + '<p:sld' + NSALL + '><p:cSld><p:spTree>' + GRP + body + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>');
    add('ppt/slides/_rels/slide' + (k + 1) + '.xml.rels', XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + NS_R + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="' + NS_R + '/image" Target="../media/image' + (k + 1) + '.png"/></Relationships>');
    files.push({ n: 'ppt/media/image' + (k + 1) + '.png', d: s.png });
  });
  return zipStore(files);
}
/* one page: measure every <text> as rendered, then strip them and rasterise what is left */
function canvaPage(svgStr, wmm, hmm) {
  var PXMM = 4, host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none';
  host.innerHTML = svgStr; var svg = host.firstChild; svg.setAttribute('width', wmm * PXMM); svg.setAttribute('height', hmm * PXMM); document.body.appendChild(host);
  return (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () { return new Promise(function (r) { setTimeout(r, 200); }); }).then(function () {
    var sr = svg.getBoundingClientRect(), texts = [];
    function hex(c) { var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); return m ? [m[1], m[2], m[3]].map(function (v) { return ('0' + (+v).toString(16)).slice(-2); }).join('').toUpperCase() : '1F2A44'; }
    Array.prototype.forEach.call(svg.querySelectorAll('text'), function (el) {
      if (el.closest('defs,clipPath,pattern,mask')) return;
      var s = el.textContent.replace(/\s+$/, ''); if (!s.trim()) return;
      var cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return;
      var r = el.getBoundingClientRect(); if (!(r.width > 0)) return;
      /* skip text that a clipPath hides (folded-row export keeps the whole chart in every row, clipped) */
      var cg = el.closest('[clip-path]');
      if (cg) {
        var cm = /url\(#([^)]+)\)/.exec(cg.getAttribute('clip-path') || ''), cr = cm && svg.querySelector('[id="' + cm[1] + '"] rect'), CM = cg.getScreenCTM && cg.getScreenCTM();
        if (cr && CM) {
          var cx0 = +cr.getAttribute('x'), cy0 = +cr.getAttribute('y'), cw = +cr.getAttribute('width'), ch = +cr.getAttribute('height');
          var L0 = CM.a * cx0 + CM.e, T0 = CM.d * cy0 + CM.f, R0 = CM.a * (cx0 + cw) + CM.e, B0 = CM.d * (cy0 + ch) + CM.f, tx = (r.left + r.right) / 2, ty = (r.top + r.bottom) / 2;
          if (tx < L0 || tx > R0 || ty < T0 || ty > B0) return;
        }
      }
      var m = el.getScreenCTM(), ppu = m ? Math.sqrt(m.a * m.a + m.b * m.b) : 1, fpx = parseFloat(cs.fontSize) * ppu;
      texts.push({ s: s, x: (r.left - sr.left) / PXMM, y: (r.top - sr.top) / PXMM, w: r.width / PXMM, h: r.height / PXMM, pt: fpx / PXMM * 72 / 25.4, col: hex(cs.fill), b: parseInt(cs.fontWeight, 10) >= 600, al: cs.textAnchor === 'middle' ? 'ctr' : cs.textAnchor === 'end' ? 'r' : 'l' });
    });
    Array.prototype.slice.call(svg.querySelectorAll('text')).forEach(function (el) { el.parentNode.removeChild(el); });
    var bg = svg.querySelector(':scope > rect'); if (bg && /^(#fff|#ffffff|white)$/i.test(bg.getAttribute('fill') || '')) bg.parentNode.removeChild(bg);
    svg.setAttribute('width', wmm + 'mm'); svg.setAttribute('height', hmm + 'mm');
    var layer = new XMLSerializer().serializeToString(svg); document.body.removeChild(host);
    var k = Math.min(300 / 25.4, 14000 / Math.max(wmm, hmm), Math.sqrt(1.4e8 / (wmm * hmm))), url = URL.createObjectURL(new Blob([layer], { type: 'image/svg+xml;charset=utf-8' }));
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        (img.decode ? img.decode() : Promise.resolve()).catch(function () { }).then(function () {
          var c = document.createElement('canvas'); c.width = Math.round(wmm * k); c.height = Math.round(hmm * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
          c.toBlob(function (b) { if (!b) { rej(new Error('png')); return; } var fr = new FileReader(); fr.onload = function () { res({ texts: texts, png: new Uint8Array(fr.result), svg: layer }); }; fr.readAsArrayBuffer(b); }, 'image/png');
        });
      };
      img.onerror = function () { rej(new Error('svg')); }; img.src = url;
    });
  });
}
function canvaMake(o) {
  var specs = [], wmm, hmm;
  if (o.mode === 'book' || o.mode === 'one' || o.mode === 'rep') { var r = o.mode === 'rep' ? buildReport(o) : buildBook(o); wmm = r.P.w; hmm = r.P.h; r.pages.forEach(function (pg, i) { specs.push(pg.build(wmm + 'mm', hmm + 'mm', i === 0)); }); }
  else { var q = buildExport(o), s = Math.min(1400 / q.W, 1400 / q.H, 0.3); wmm = +(q.W * s).toFixed(2); hmm = +(q.H * s).toFixed(2); specs.push(q.build(wmm + 'mm', hmm + 'mm')); }
  var done = [], chain = Promise.resolve();
  specs.forEach(function (sv) { chain = chain.then(function () { return canvaPage(sv, wmm, hmm); }).then(function (p) { done.push(p); }); });
  return chain.then(function () { return { blob: pptxBuild(done, wmm, hmm), pages: done, w: wmm, h: hmm }; });
}
function doCanva(o) {
  if (o.mode === 'long') { toast('โหมดแถวยาวใช้กับ Canva ไม่ได้ — เลือก “หน้าเดียว” หรือ “ชุดลงเล่ม”'); return; }
  toast('กำลังสร้างไฟล์สำหรับ Canva…');
  canvaMake(o).then(function (c) {
    dl(fname('pptx'), c.blob);
    if (c.pages.length === 1) setTimeout(function () { dl(fname('x').replace(/\.x$/, '') + '-สัญลักษณ์.svg', new Blob([c.pages[0].svg], { type: 'image/svg+xml' })); }, 700);
    toast('ได้ไฟล์ .pptx แล้ว (' + c.pages.length + ' หน้า, ข้อความ ' + c.pages.reduce(function (a, p) { return a + p.texts.length; }, 0) + ' กล่อง) — อัปโหลดเข้า Canva ได้เลย');
  }).catch(function () { toast('สร้างไฟล์สำหรับ Canva ไม่ได้ — ลองโหมดอื่นหรือใช้ PDF'); });
}
function fname(ext) { return (fam.title || 'genogram').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60) + '.' + ext; }
function renderExportDialog() {
  var o = expOpts(), book = o.mode === 'book' || o.mode === 'one' || o.mode === 'long' || o.mode === 'rep', r = o.mode === 'long' ? buildLong(o) : (o.mode === 'rep' ? buildReport(o) : (book ? buildBook(o) : buildExport(o))), box = $('#expOpts');
  function ck(k, t) { return '<label class="ck"><input type="checkbox" data-eo="' + k + '"' + (o[k] ? ' checked' : '') + '> ' + t + '</label>'; }
  box.innerHTML = '<div class="st">ตัวเลือก</div><label>รูปแบบ<select data-eo="mode">' + opt('single', 'หน้าเดียว (ย่อทั้งผัง)', o.mode) + opt('one', 'หน้าเดียว A4 (พับแถว ซูมใน PDF)', o.mode) + opt('long', 'แถวเดียวยาวต่อเนื่อง (หน้ากระดาษยาวพิเศษ — PDF เท่านั้น)', o.mode) + opt('book', 'ชุดลงเล่ม: ภาพรวม 1 หน้า + หน้ารายละเอียด (ตัวอ่านออก)', o.mode) + opt('rep', 'แบบเล่มรายงาน: เต็มที่ 1–2 หน้า (ข้อความใหญ่ พับแถวให้เต็มหน้า)', o.mode) + '</select></label>' + (o.mode === 'rep' ? '<label>จำนวนหน้า<select data-eo="repPages">' + opt('1', '1 หน้า', String(o.repPages || 2)) + opt('2', '2 หน้า', String(o.repPages || 2)) + '</select></label><label class=\"ck\"><input type=\"checkbox\" data-eo=\"repLean\"' + (o.repLean ? ' checked' : '') + '> ซ่อนบรรทัดรอง (การศึกษา/อาชีพ/บทบาท/ย้ายถิ่น/พฤติกรรม/หมายเหตุ) — เหมาะกับภาพรวม</label><label class=\"ck\"><input type=\"checkbox\" data-eo=\"repFit\"' + (o.repFit === false ? '' : ' checked') + '> ย่อเฉพาะป้ายที่ทับกันอัตโนมัติ</label><label>จำนวนแถวที่พับ<select data-eo=\"repRows\">' + opt('0', 'อัตโนมัติ (ให้ตัวใหญ่สุด)', String(o.repRows || 0)) + opt('1', '1 แถว (ไม่พับ)', String(o.repRows || 0)) + opt('2', '2 ชั้น', String(o.repRows || 0)) + opt('3', '3 ชั้น', String(o.repRows || 0)) + '</select></label><label>ขยายข้อความเทียบกับสัญลักษณ์ (เท่า)<input type="number" step="0.1" min="1" max="3" data-eo="repScale" value="' + (o.repScale || 1.7) + '"></label>' : '') + (o.mode === 'book' ? '<label>ขนาดตัวอักษรเล็กสุดที่ต้องการ (pt)<input type="number" step="0.5" min="5" max="14" data-eo="bookPt" value="' + o.bookPt + '"></label>' : '') + (o.mode === 'long' ? '<label>ขนาดตัวอักษรเล็กสุด (pt) — ยิ่งใหญ่ ยิ่งยาว<input type="number" step="0.5" min="3" max="14" data-eo="longPt" value="' + o.longPt + '"></label>' : '') + ((o.mode === 'single' || o.mode === 'long' || o.mode === 'rep') && state.snip ? ck('snip', 'ส่งออกเฉพาะ<b>พื้นที่ที่ตัดไว้</b> (' + state.snip.w + '×' + state.snip.h + ') — เลือก “ตามขนาดผัง” ถ้าอยากได้ภาพขนาดเท่าพื้นที่นั้นพอดี') : '') + ((o.mode === 'single' || o.mode === 'long' || o.mode === 'rep') ? (expCropIds.length ? ck('crop', 'ตัดเอาเฉพาะส่วนที่เลือก (' + expCropIds.length + ' คน) — ส่วนอื่นของผังไม่ติดมา') : '<div class="note" style="margin:4px 0">อยากตัดเฉพาะบางส่วน: ปิดหน้าต่างนี้ → กด “เลือกหลายคน” แล้วลากกรอบรอบคนที่ต้องการ (หรือ Shift+คลิก) → เปิดส่งออกอีกครั้ง</div>') : '') + (o.mode === 'single' ? ck('rotate', 'หมุนผัง 90° (ทวนเข็มนาฬิกา — วางผังกว้างบนหน้ากระดาษแนวตั้งให้เต็มหน้า แบบเล่มเขต 7/9)') : '') + ck('title', 'หัวเรื่อง') + ck('subtitle', 'บ้านเลขที่ / ที่ตั้ง / วันที่ใต้หัวเรื่อง') + '<label>คำอธิบายสัญลักษณ์<select data-eo="legendMode">' + opt('none', 'ไม่แสดง', o.legendMode) + opt('used', 'เฉพาะที่ใช้ในผัง', o.legendMode) + opt('standard', 'ครบตามตารางของคู่มือ', o.legendMode) + '</select></label>' + ck('gen', 'ป้ายรุ่น I, II, III') + ck('alias', 'ใช้ “ตัวย่อ” แทนชื่อจริง (แนะนำสำหรับรายงาน)') + ck('unk', 'ชื่อ “ไม่ทราบ” ให้ขึ้นว่า “ไม่ทราบ” (ไม่ย่อเป็น ม.)') + ck('unkBlank', 'ช่องชื่อ/อายุที่ว่าง ให้ขึ้น “ไม่ทราบ”') + ck('mono', 'สัญลักษณ์ตามคู่มือ (เส้นดำ พื้นขาว วงบ้านดำเส้นบาง — ข้อความยังมีสีได้)') + ck('condFill', 'ระบายลายโรคในสัญลักษณ์ (ปิด = โรคเป็นตัวหนังสืออย่างเดียว)') +
    (o.alias && r.missingAlias ? '<div class="warnbox">มี ' + r.missingAlias + ' คนที่ยังไม่ตั้งตัวย่อ — ระบบใช้ตัวย่อที่สร้างอัตโนมัติจากชื่อให้ (ตรวจดูก่อนส่ง)</div>' : '') +
    (!o.alias ? '<div class="warnbox">กำลังจะแสดง<b>ชื่อจริง</b>ของชาวบ้านในรูป — ตรวจว่ารายงานอนุญาตหรือไม่</div>' : '') +
    '<label>ขนาดกระดาษ<select data-eo="paper">' + Object.keys(PAPERS).filter(function (k) { return !book || k !== 'auto'; }).map(function (k) { return opt(k, PAPERS[k].n, o.paper); }).join('') + '</select></label>' +
    '<label>ขอบกระดาษ (มม.)<input type="number" min="0" max="40" data-eo="margin" value="' + o.margin + '"></label>' +
    '<div class="btns" style="margin-top:10px"><button class="pri" data-ex="pdf">พิมพ์ / บันทึกเป็น PDF</button><button data-ex="png">ดาวน์โหลด PNG</button><button data-ex="svg">ดาวน์โหลด SVG</button><button data-ex="canva">สำหรับ Canva (.pptx)</button></div>' +
    '<p class="note" style="margin-top:8px">PDF เป็นเวกเตอร์ (คมที่สุด) — ในหน้าต่างพิมพ์ให้เลือกปลายทาง “บันทึกเป็น PDF” และปิด “หัวกระดาษและท้ายกระดาษ”<br>PNG ความละเอียด 300 dpi ตามขนาดกระดาษ ใช้แทรกใน Word ได้ · SVG ไม่ควรใช้ใน Word<br><b>สำหรับ Canva:</b> ได้ไฟล์ .pptx ที่ข้อความทุกบรรทัดเป็นกล่องข้อความแยก (ย้าย/แก้/เปลี่ยนสีได้) วางบนภาพสัญลักษณ์และเส้น · ใช้ได้กับ “หน้าเดียว” และ “ชุดลงเล่ม”</p>';
  if (book) {
    $('#expPv').innerHTML = r.pages.map(function (pg, i) { return '<div style="margin-bottom:8px;border:1px solid #cfd6e4;background:#fff">' + pg.build('100%', 'auto', i === 0) + '</div>'; }).join('');
    if (r.rep) { $('#expInfo').innerHTML = r.total + ' หน้า (แถวพับ ' + r.rowsPerPage.join(' + ') + ')' + (r.manual ? ' · ตัดตามจุดที่ตั้งไว้ ' + r.manual + ' จุด' : '') + ' · ข้อความทับกัน ' + r.ovBefore + ' → ' + r.ovAfter + ' จุด · ชื่อ (ส่วนใหญ่) ≈ ' + r.nameNominal.toFixed(1) + ' pt, เล็กสุด <b>' + r.nameMin.toFixed(1) + ' pt</b> · ข้อความอื่นเล็กสุด ≈ <b>' + r.noteMin.toFixed(1) + ' pt</b> บนกระดาษ' + (r.nameMin < 4 ? '<div class="warnbox">ตัวอักษรยังเล็ก (เขตอื่นอยู่ราว 5–6 pt สำหรับชื่อ) — ลองซ่อนหมายเหตุ / ลดจำนวนบรรทัด / เปลี่ยนเป็น 2 หน้า</div>' : '<div class="okbox">ใกล้เคียงรายงานเขตอื่น</div>'); return r; }
    if (r.long) { $('#expInfo').innerHTML = 'หน้ากระดาษยาวพิเศษ <b>' + Math.round(r.widthMm) + ' × ' + Math.round(r.heightMm) + ' มม.</b> (ยาว ≈ ' + (r.widthMm / 1000).toFixed(2) + ' ม.) · ตัวอักษรเล็กสุด ' + r.ptEff + ' pt' + (r.tooWide ? '<div class="warnbox">ยาวเกิน 5,080 มม. (ขีดจำกัดของหลายโปรแกรมอ่าน PDF) — ลดขนาดตัวอักษรลง</div>' : '<div class="warnbox">สำหรับไฟล์ PDF ที่ซูมอ่านหรือวาดทับบนแท็บเล็ต — พิมพ์ลงกระดาษมาตรฐานไม่ได้ ใช้ “ชุดลงเล่ม” สำหรับฉบับพิมพ์</div>'); return r; }
    if (r.one) { $('#expInfo').innerHTML = 'ผังทั้งหมดในหน้าเดียว · ตัวอักษรเล็กสุดบนกระดาษ ≈ <b>' + r.ovPt.toFixed(1) + ' pt</b><div class="warnbox">เหมาะกับไฟล์ PDF ที่ซูมอ่านได้ (เวกเตอร์คม) — ถ้าพิมพ์ลงกระดาษ ตัวหนังสือจะเล็กเกินอ่าน ใช้ “ชุดลงเล่ม” สำหรับฉบับพิมพ์</div>'; return r; }
    var bi = 'ทั้งหมด <b>' + r.total + ' หน้า</b>' + (r.N > 1 ? ' (ภาพรวม 1 + รายละเอียด ' + r.N + ')' : '') + ' · ตัวอักษรเล็กสุดเมื่อพิมพ์ ≈ <b>' + r.ptEff.toFixed(1) + ' pt</b>';
    if (r.shrunk) bi += '<div class="warnbox">ผังสูงเกินกว่าจะใส่ในหน้าได้ที่ ' + r.ptWant + ' pt จึงย่อเหลือ ' + r.ptEff.toFixed(1) + ' pt — ลองเปลี่ยนเป็นกระดาษแนวตั้ง / A3 หรือ “แก้คนที่ซ้อนกัน/จัดวาง” ให้ผังเตี้ยลง</div>';
    else bi += '<div class="okbox">อ่านได้ตามที่ตั้งไว้ (' + r.ptWant + ' pt ขึ้นไป)</div>';
    $('#expInfo').innerHTML = bi; return r;
  }
  $('#expPv').innerHTML = r.svg;
  var info = 'ขนาดภาพ ' + r.W + '×' + r.H + ' หน่วย';
  if (r.minPt != null) {
    info += ' · ตัวอักษรเล็กสุดเมื่อพิมพ์ ≈ <b>' + r.minPt.toFixed(1) + ' pt</b>';
    if (r.s && r.A && (r.H * r.s) < 0.4 * (r.A.h - 2 * o.margin)) info += '<div class="warnbox">ผังนี้แบนและกว้างมาก จึงเป็นแถบแคบกลางกระดาษ เหลือที่ว่างเกือบทั้งหน้า — ถ้าอยากให้เต็ม A4 ใช้รูปแบบ “แบบเล่มรายงาน” หรือ “หน้าเดียว A4 (พับแถว)”</div>';
    if (r.minPt < 7.5) info += '<div class="warnbox">ตัวอักษรเล็กไปจนอ่านยากในเล่ม — ลองเลือก A3 / เปลี่ยนแนวกระดาษ / ปิด “หมายเหตุ” / ใช้ “จัดวาง” ให้ผังกระชับขึ้น หรือแยกเป็นหลายผัง</div>';
    else info += '<div class="okbox">อ่านได้สบายเมื่อพิมพ์ในขนาดนี้ (ควรไม่ต่ำกว่า 8 pt)</div>';
  }
  $('#expInfo').innerHTML = info; return r;
}
function openExport() { persistNow(); expCropIds = Object.keys(msel).slice(); if (!expCropIds.length && sel && sel.k === 'p') expCropIds = [sel.id]; renderExportDialog(); $('#dExp').showModal(); }
function doPng(r, o) {
  if (r.s && r.A) { /* a paper size was chosen: the PNG is that whole page (same layout as printing), not just the chart's own bounding box */
    var kmm = 300 / 25.4, Wp = Math.round(r.A.w * kmm), Hp = Math.round(r.A.h * kmm), cw = r.W * r.s * kmm, ch = r.H * r.s * kmm;
    var url0 = URL.createObjectURL(new Blob([r.build(r.W, r.H)], { type: 'image/svg+xml;charset=utf-8' })), im0 = new Image();
    im0.onload = function () {
      (im0.decode ? im0.decode() : Promise.resolve()).catch(function () { }).then(function () {
        var c0 = document.createElement('canvas'); c0.width = Wp; c0.height = Hp;
        var g0 = c0.getContext('2d'); g0.fillStyle = '#fff'; g0.fillRect(0, 0, Wp, Hp);
        g0.drawImage(im0, (Wp - cw) / 2, (Hp - ch) / 2, cw, ch); URL.revokeObjectURL(url0);
        c0.toBlob(function (b) { if (b) { dl(fname('png'), b); toast('สร้าง PNG ขนาดหน้ากระดาษแล้ว (' + Wp + '×' + Hp + ' px)'); } else toast('สร้าง PNG ไม่ได้ — ใช้ PDF หรือ SVG แทน'); }, 'image/png');
      });
    };
    im0.onerror = function () { toast('สร้าง PNG ไม่ได้ — ใช้ PDF หรือ SVG แทน'); };
    im0.src = url0; return;
  }
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
  if ($('#snipmode')) $('#snipmode').onclick = function () { snipMode = !snipMode; if (snipMode && brkMode && $('#brkmode')) $('#brkmode').click(); this.classList.toggle('on', snipMode); this.textContent = snipMode ? '▭ ตัดภาพส่งออก (เปิดอยู่ — ลากกรอบบนผังเพื่อเลือกพื้นที่)' : '▭ ตัดภาพส่งออก'; };
  if ($('#snipclr')) $('#snipclr').onclick = function () { if (!state.snip) { toast('ยังไม่ได้เลือกพื้นที่'); return; } pushSnap(); delete state.snip; draw(); save(); toast('ล้างพื้นที่ที่ตัดไว้แล้ว'); };
  if ($('#brkmode')) $('#brkmode').onclick = function () { if (!brkMode && snipMode && $('#snipmode')) $('#snipmode').click(); brkMode = !brkMode; this.classList.toggle('on', brkMode); this.textContent = brkMode ? '✂ ตั้งจุดตัดแถว (เปิดอยู่ — คลิกตรงไหนก็ตัดตรงนั้น / คลิกเส้นเพื่อลบ)' : '✂ ตั้งจุดตัดแถว'; };
  if ($('#brkclr')) $('#brkclr').onclick = function () { if (!brkCount()) { toast('ยังไม่มีจุดตัด'); return; } pushSnap(); state.persons.forEach(function (q) { delete q.brk; }); state.cuts = []; renderPanel(); draw(); save(); toast('ล้างจุดตัดทั้งหมดแล้ว'); };
  $('#selmode').onclick = function () { selMode = !selMode; this.classList.toggle('on', selMode); this.textContent = selMode ? '☑ เลือกหลายคน (เปิดอยู่)' : '☐ เลือกหลายคน'; };
  $('#addText').onclick = addTextBox;
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
    var b = e.target.closest('[data-ex]'); if (!b) return; var o = expOpts(), a = b.getAttribute('data-ex'); if (a === 'canva') { doCanva(o); return; } if (o.mode === 'long') { bookAction(buildLong(o), a); return; } if (o.mode === 'rep') { bookAction(buildReport(o), a); return; } if (o.mode === 'book' || o.mode === 'one') { bookAction(buildBook(o), a); return; } var r = buildExport(o);
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
  window.GM = { get state() { return state; }, get fam() { return fam; }, get project() { return project; }, draw: draw, fit: fit, addPerson: addPerson, addSpouse: addSpouse, addChildOf: addChildOf, addParents: addParents, addSibling: addSibling, pushSnap: pushSnap, save: save, persistNow: persistNow, select: select, tidy: tidy, buildExport: buildExport, buildBook: buildBook, buildLong: buildLong, fillPrintBook: fillPrintBook, makeSample: makeSample, importText: importText, canvaMake: canvaMake, setActive: setActive, addFamily: addFamily, expOpts: expOpts, bundle: bundle, normalize: normalize, get saveState() { return saveState; }, mirrorNow: mirrorNow, snapNow: function () { return Store.addSnap(fam.id, snapStr(), 'test', state.persons.length); } };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

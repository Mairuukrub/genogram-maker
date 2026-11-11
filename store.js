/* Genogram Maker - persistence. Layers: IndexedDB (primary) + localStorage mirror + rolling snapshots.
   File backups (download / linked file) are handled in app.js. Nothing is ever sent over the network. */
(function (G) {
'use strict';
var DB = 'genogram-maker', VER = 1, db = null, idbOK = false, MIRROR = 'gm2_mirror', mirrorOK = true;

function open() {
  return new Promise(function (res) {
    try {
      var rq = indexedDB.open(DB, VER);
      rq.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('families')) d.createObjectStore('families', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('snaps')) { var s = d.createObjectStore('snaps', { keyPath: 'sid', autoIncrement: true }); s.createIndex('fid', 'fid'); }
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      rq.onsuccess = function () { db = rq.result; idbOK = true; db.onversionchange = function () { db.close(); idbOK = false; }; res(true); };
      rq.onerror = rq.onblocked = function () { res(false); };
    } catch (e) { res(false); }
  });
}
function tx(store, mode, fn) {
  return new Promise(function (resolve, reject) {
    if (!idbOK) { reject(new Error('no-idb')); return; }
    var t, r;
    try { t = db.transaction(store, mode); r = fn(t.objectStore(store)); } catch (e) { reject(e); return; }
    t.oncomplete = function () { resolve(r && r.result); };
    t.onerror = t.onabort = function () { reject(t.error || new Error('tx')); };
  });
}
function all(store) { return tx(store, 'readonly', function (s) { return s.getAll(); }); }
function putFamily(f) { return tx('families', 'readwrite', function (s) { return s.put(f); }); }
function delFamily(id) { return tx('families', 'readwrite', function (s) { return s.delete(id); }); }
function getMeta(k) { return tx('meta', 'readonly', function (s) { return s.get(k); }).catch(function () { return undefined; }); }
function putMeta(k, v) { return tx('meta', 'readwrite', function (s) { return s.put(v, k); }); }

function addSnap(fid, data, reason, n) {
  var rec = { fid: fid, at: Date.now(), reason: reason || 'auto', n: n || 0, data: data };
  return tx('snaps', 'readwrite', function (s) { return s.add(rec); }).then(function () { return prune(fid, 40); });
}
function listSnaps(fid) {
  return tx('snaps', 'readonly', function (s) { return s.index('fid').getAll(fid); }).then(function (a) { return (a || []).sort(function (x, y) { return y.at - x.at; }); });
}
function prune(fid, keep) {
  return listSnaps(fid).then(function (a) {
    var extra = a.slice(keep); if (!extra.length) return;
    return tx('snaps', 'readwrite', function (s) { extra.forEach(function (r) { s.delete(r.sid); }); });
  });
}

/* localStorage mirror: a second full copy, written synchronously on page hide */
function mirrorWrite(families) {
  try { localStorage.setItem(MIRROR, JSON.stringify({ at: Date.now(), families: families })); mirrorOK = true; return true; }
  catch (e) { mirrorOK = false; return false; }
}
function mirrorRead() {
  try { var t = localStorage.getItem(MIRROR); return t ? (JSON.parse(t).families || []) : []; } catch (e) { return []; }
}
function legacyRead() {
  try { var t = localStorage.getItem('genogram-maker-v1'); return t ? JSON.parse(t) : null; } catch (e) { return null; }
}

/* merge two lists of families by id, keeping the newer `updated` */
function merge(a, b) {
  var m = {};
  (a || []).concat(b || []).forEach(function (f) { if (!f || !f.id) return; var o = m[f.id]; if (!o || (f.updated || 0) > (o.updated || 0)) m[f.id] = f; });
  return Object.keys(m).map(function (k) { return m[k]; });
}

function persist() {
  if (!(navigator.storage && navigator.storage.persist)) return Promise.resolve(null);
  return navigator.storage.persisted().then(function (p) { return p ? true : navigator.storage.persist(); }).catch(function () { return null; });
}
function estimate() {
  if (!(navigator.storage && navigator.storage.estimate)) return Promise.resolve(null);
  return navigator.storage.estimate().catch(function () { return null; });
}

G.Store = {
  open: open, all: function () { return all('families'); }, putFamily: putFamily, delFamily: delFamily, getMeta: getMeta, putMeta: putMeta,
  addSnap: addSnap, listSnaps: listSnaps, mirrorWrite: mirrorWrite, mirrorRead: mirrorRead, legacyRead: legacyRead, merge: merge,
  persist: persist, estimate: estimate, get idb() { return idbOK; }, get mirrorOK() { return mirrorOK; }
};
})(window);

// matériauthèque — the one public surface of the app, as a bkn hook.
//
// GET  /v1/hooks/materiautheque                   -> approved items (public)
// GET  /v1/hooks/materiautheque?view=pending      -> proposals awaiting moderation (admin)
// POST {action:"propose", ...}                    -> a resident proposes an item (public, anonymous)
// POST {action:"approve"|"reject"|"status"|"remove", id, ...}  -> moderation (admin)
//
// Admin = header X-Admin-Token equal to kv materiautheque.admin_token. The hook decides
// who may write; nothing else does (bkn rule). Approved changes are mirrored to the
// public register (greffe) with the node's own key, so anyone can verify what passed
// through the matériauthèque without trusting this server.

var ITEMS = 'materiautheque/items';        // approved, public
var PROPOSALS = 'materiautheque/proposals';  // pending / rejected, admin only
var CATEGORIES = ['bois', 'metal', 'isolation', 'menuiserie', 'plomberie', 'electricite', 'carrelage', 'peinture', 'outillage', 'mobilier', 'jardin', 'autre'];
var COMMUNES = ['Aillon-le-Jeune', 'Aillon-le-Vieux', 'Arith', 'Bellecombe-en-Bauges', 'Le Châtelard', 'La Compôte', 'Doucy-en-Bauges', 'École', 'Jarsy', 'Lescheraines', 'La Motte-en-Bauges', 'Le Noyer', 'Sainte-Reine', 'Saint-François-de-Sales', 'autre'];
var MODES = ['don', 'pret'];
var STATUSES = ['disponible', 'prete', 'parti'];

function main(d) {
  if (d.method === 'OPTIONS') return { status: 204, body: '' };
  if (d.method === 'GET') return handleGet(d);
  if (d.method !== 'POST') return { status: 405, body: { ok: false, error: 'method' } };
  var req = parseBody(d.body);
  if (!req) return { status: 400, body: { ok: false, error: 'body is not JSON' } };
  if (req.action === 'propose') return propose(req);
  if (!isAdmin(d)) return { status: 401, body: { ok: false, error: 'admin token required' } };
  // an admin may route an action's register entries to the TEST federation (verify runs),
  // so the real register never accumulates test objects
  REGISTER_TARGET = req.register === 'test' ? 'test' : 'live';
  if (req.action === 'approve') return approve(req);
  if (req.action === 'reject') return reject(req);
  if (req.action === 'status') return setStatus(req);
  if (req.action === 'remove') return remove(req);
  if (req.action === 'edit') return edit(req);
  return { status: 400, body: { ok: false, error: 'unknown action' } };
}

function handleGet(d) {
  if (d.query.view === 'pending') {
    if (!isAdmin(d)) return { status: 401, body: { ok: false, error: 'admin token required' } };
    var pend = bkn.store.list(PROPOSALS, { where: { status: 'pending' }, limit: 200, order_by: 'created_at', order: 'asc' });
    return { status: 200, body: { ok: true, items: pend } };
  }
  if (d.query.view === 'meta') {
    return { status: 200, body: { ok: true, categories: CATEGORIES, communes: COMMUNES, modes: MODES, statuses: STATUSES, register: registerUrl() } };
  }
  var where = {};
  if (d.query.status && STATUSES.indexOf(d.query.status) >= 0) where.status = d.query.status;
  if (d.query.commune) where.commune = d.query.commune;
  if (d.query.category) where.category = d.query.category;
  var items = bkn.store.list(ITEMS, { where: where, limit: 500, order_by: 'approved_at', order: 'desc' });
  return { status: 200, body: { ok: true, items: items, register: registerUrl() } };
}

// ---- public: propose ----

function propose(req) {
  // honeypot: a field no human sees; answer like success, store nothing
  if (req.website) { bkn.events.emit('materiautheque', 'proposal.honeypot', { level: 'warn' }); return { status: 200, body: { ok: true } }; }
  var f = req.item || {};
  var e = validate(f);
  if (e) return { status: 422, body: { ok: false, error: e.error, field: e.field } };
  var clean = {
    title: str(f.title, 80), description: str(f.description, 1000), category: f.category, commune: f.commune,
    mode: f.mode, quantity: str(f.quantity, 40), contact: str(f.contact, 120), photo_url: photoUrl(f.photo_url), nickname: str(f.nickname, 40),
    status: 'pending', created_at: bkn.now()
  };
  var rec = bkn.store.put(PROPOSALS, clean);
  bkn.events.emit('materiautheque', 'proposal.created', { subject: rec.id, data: { title: clean.title, commune: clean.commune } });
  return { status: 201, body: { ok: true, id: rec.id, status: 'pending' } };
}

function validate(f) {
  if (!str(f.title, 80)) return { field: 'title', error: 'un titre est nécessaire' };
  if (str(f.title, 80).length < 3) return { field: 'title', error: 'titre trop court' };
  if (CATEGORIES.indexOf(f.category) < 0) return { field: 'category', error: 'catégorie inconnue' };
  if (COMMUNES.indexOf(f.commune) < 0) return { field: 'commune', error: 'commune inconnue' };
  if (MODES.indexOf(f.mode) < 0) return { field: 'mode', error: 'don ou prêt' };
  if (!str(f.contact, 120)) return { field: 'contact', error: 'un moyen de contact est nécessaire (il sera affiché publiquement)' };
  return null;
}

// ---- admin: moderation ----

function approve(req) {
  var p = bkn.store.get(PROPOSALS, req.id || '');
  if (!p || p.status !== 'pending') return { status: 404, body: { ok: false, error: 'no such pending proposal' } };
  var item = {
    title: p.title, description: p.description, category: p.category, commune: p.commune, mode: p.mode,
    quantity: p.quantity, contact: p.contact, photo_url: p.photo_url, nickname: p.nickname || '', status: 'disponible',
    created_at: p.created_at, approved_at: bkn.now(), proposal_id: p.id
  };
  var rec = bkn.store.put(ITEMS, item);
  bkn.store.patch(PROPOSALS, p.id, { status: 'approved', item_id: rec.id });
  var reg = register('item.add', { id: rec.id, title: rec.title, category: rec.category, commune: rec.commune, mode: rec.mode, quantity: rec.quantity, by: rec.nickname || '' });
  if (reg.id) bkn.store.patch(ITEMS, rec.id, { register_id: reg.id });
  bkn.events.emit('materiautheque', 'item.approved', { subject: rec.id, data: { register: reg } });
  return { status: 200, body: { ok: true, id: rec.id, register: reg } };
}

function reject(req) {
  var p = bkn.store.get(PROPOSALS, req.id || '');
  if (!p || p.status !== 'pending') return { status: 404, body: { ok: false, error: 'no such pending proposal' } };
  bkn.store.patch(PROPOSALS, p.id, { status: 'rejected', reason: str(req.reason, 200) });
  return { status: 200, body: { ok: true } };
}

function setStatus(req) {
  var it = bkn.store.get(ITEMS, req.id || '');
  if (!it) return { status: 404, body: { ok: false, error: 'no such item' } };
  if (STATUSES.indexOf(req.status) < 0) return { status: 422, body: { ok: false, error: 'statut inconnu', field: 'status' } };
  if (it.status === req.status) return { status: 200, body: { ok: true, unchanged: true } };
  bkn.store.patch(ITEMS, it.id, { status: req.status, status_at: bkn.now() });
  var kind = req.status === 'parti' ? 'item.gone' : (req.status === 'prete' ? 'item.lent' : 'item.available');
  var reg = register(kind, { id: it.id, title: it.title, status: req.status });
  bkn.events.emit('materiautheque', 'item.status', { subject: it.id, data: { status: req.status, register: reg } });
  return { status: 200, body: { ok: true, register: reg } };
}

// edit: moderation may correct the public fields of a published item (typos, a nickname added
// after the fact). Wording changes are not recorded; a nickname change is, as item.correct,
// because 'by' is part of the register entry.
var EDITABLE = ['title', 'description', 'category', 'commune', 'mode', 'quantity', 'contact', 'photo_url', 'nickname'];
var LIMITS = { title: 80, description: 1000, quantity: 40, contact: 120, photo_url: 500, nickname: 40 };
function edit(req) {
  var it = bkn.store.get(ITEMS, req.id || '');
  if (!it) return { status: 404, body: { ok: false, error: 'no such item' } };
  var patch = {};
  var f = req.fields || {};
  for (var i = 0; i < EDITABLE.length; i++) {
    var k = EDITABLE[i];
    if (f[k] === undefined) continue;
    if (k === 'category' && CATEGORIES.indexOf(f[k]) < 0) return { status: 422, body: { ok: false, error: 'catégorie inconnue', field: k } };
    if (k === 'commune' && COMMUNES.indexOf(f[k]) < 0) return { status: 422, body: { ok: false, error: 'commune inconnue', field: k } };
    if (k === 'mode' && MODES.indexOf(f[k]) < 0) return { status: 422, body: { ok: false, error: 'don ou prêt', field: k } };
    patch[k] = k === 'photo_url' ? photoUrl(f[k]) : (LIMITS[k] ? str(f[k], LIMITS[k]) : f[k]);
  }
  if (Object.keys(patch).length === 0) return { status: 422, body: { ok: false, error: 'nothing to edit' } };
  patch.edited_at = bkn.now();
  bkn.store.patch(ITEMS, it.id, patch);
  // the nickname is the one edited field that is on the register ('by'): record a correction
  var reg = { skipped: 'no register field changed' };
  if (patch.nickname !== undefined && patch.nickname !== (it.nickname || '')) {
    reg = register('item.correct', { id: it.id, corrects: it.register_id || '', by: patch.nickname, note: 'nickname changed' });
  }
  return { status: 200, body: { ok: true, id: it.id, patched: Object.keys(patch), register: reg } };
}

function remove(req) {
  var it = bkn.store.get(ITEMS, req.id || '');
  if (!it) return { status: 404, body: { ok: false, error: 'no such item' } };
  bkn.store.delete(ITEMS, it.id);
  var reg = register('item.removed', { id: it.id, title: it.title, reason: str(req.reason, 200) });
  return { status: 200, body: { ok: true, register: reg } };
}

// ---- the public register (greffe) ----

var REGISTER_TARGET = 'live';
function register(kind, payload) {
  var suffix = REGISTER_TARGET === 'test' ? '_test' : '';
  var url = bkn.kv.get('materiautheque.register' + suffix + '_url');
  var tok = bkn.kv.get('materiautheque.register' + suffix + '_token');
  if (!url || !tok) return { skipped: 'register not configured' };
  try {
    var r = bkn.http.fetch(url + '/put', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'materiautheque.' + kind, payload: JSON.stringify(payload) })
    });
    var b = typeof r.body === 'string' ? JSON.parse(r.body) : r.body;
    if (r.status === 201 && b && b.id) return { id: b.id };
    bkn.events.emit('materiautheque', 'register.failed', { level: 'error', data: { status: r.status, body: String(r.body).slice(0, 200) } });
    return { error: 'register refused ' + r.status };
  } catch (e) {
    bkn.events.emit('materiautheque', 'register.failed', { level: 'error', data: { error: String(e) } });
    return { error: String(e) };
  }
}

function registerUrl() { var u = bkn.kv.get('materiautheque.register_public_url'); return u || ''; }

// ---- helpers ----

function isAdmin(d) {
  var want = bkn.kv.get('materiautheque.admin_token');
  var got = d.headers['x-admin-token'] || '';
  return !!want && want.length >= 16 && bkn.crypto.equal(got, want);
}
function str(v, max) { v = v === undefined || v === null ? '' : String(v).trim(); return v.length > max ? v.slice(0, max) : v; }
function photoUrl(u) { u = str(u, 500); return /^https?:\/\//.test(u) ? u : ''; }
function parseBody(b) { try { return JSON.parse(b); } catch (e) { return null; } }

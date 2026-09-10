// Data layer. Two backends share one API:
//   - LocalBackend:  localStorage only (single phone, no account needed)
//   - CloudBackend:  Firebase Firestore + Google sign-in (shared, live, offline-capable)
//
// The Store keeps an in-memory `state` and emits events:
//   'change'  -> state changed, re-render
//   'auth'    -> sign-in state changed
//   'ready'   -> first load finished
//   'migrate' -> cloud is empty but this phone has local data (offer to upload)

import { firebaseConfig, householdId, firebaseSdkVersion } from './firebase-config.js';

const LOCAL_KEY = 'reno-tracker-v1';

export const ASSIGNEE_BOTH = 'both';
export const ASSIGNEE_TRADE = 'trade';
export const ASSIGNEE_NONE = '';

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().slice(0, 12);
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function now() { return Date.now(); }

const DEFAULT_MEMBERS = [
  { id: 'm1', name: 'Me', colour: '#2a7de1' },
  { id: 'm2', name: 'Partner', colour: '#d9480f' },
];

const DEFAULT_ROOM_NAMES = [
  'Kitchen', 'Living room', 'Dining room', 'Hallway', 'Bathroom',
  'Bedroom 1', 'Bedroom 2', 'Garden', 'Outside / exterior',
];

function defaultRooms() {
  return DEFAULT_ROOM_NAMES.map((name, i) => ({ id: uid(), name, order: i, createdAt: now(), updatedAt: now() }));
}

function emptyState() {
  return { members: DEFAULT_MEMBERS.map(m => ({ ...m })), rooms: [], tasks: [] };
}

export function normaliseTask(t) {
  return {
    id: t.id || uid(),
    roomId: t.roomId || '',
    title: (t.title || '').trim(),
    notes: t.notes || '',
    assignee: t.assignee || ASSIGNEE_NONE,
    status: ['todo', 'doing', 'done'].includes(t.status) ? t.status : 'todo',
    priority: ['low', 'normal', 'high'].includes(t.priority) ? t.priority : 'normal',
    due: t.due || '',
    cost: Number.isFinite(Number(t.cost)) && t.cost !== '' && t.cost !== null ? Number(t.cost) : null,
    materials: Array.isArray(t.materials)
      ? t.materials
          .filter(m => m && (m.name || '').trim())
          .map(m => ({ id: m.id || uid(), name: m.name.trim(), qty: (m.qty || '').trim(), bought: !!m.bought }))
      : [],
    createdAt: t.createdAt || now(),
    updatedAt: now(),
  };
}

/* ---------------------------------------------------------------------- */

class LocalBackend {
  constructor(store) { this.store = store; }

  async start() {
    let state = null;
    try { state = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch { state = null; }
    if (!state) {
      state = emptyState();
      state.rooms = defaultRooms();
      this.persist(state);
    }
    this.store._setState({ ...emptyState(), ...state });
    this.store._emit('ready');
  }

  persist(state) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); }
    catch (e) { console.warn('Could not save locally', e); }
  }

  _mutate(fn) {
    const s = structuredClone(this.store.state);
    fn(s);
    this.persist(s);
    this.store._setState(s);
  }

  async upsertRoom(room) { this._mutate(s => upsertIn(s.rooms, room)); }
  async deleteRoom(id) { this._mutate(s => { s.rooms = s.rooms.filter(r => r.id !== id); s.tasks = s.tasks.filter(t => t.roomId !== id); }); }
  async upsertTask(task) { this._mutate(s => upsertIn(s.tasks, task)); }
  async deleteTask(id) { this._mutate(s => { s.tasks = s.tasks.filter(t => t.id !== id); }); }
  async setMembers(members) { this._mutate(s => { s.members = members; }); }
  async replaceAll(state) { this._mutate(s => Object.assign(s, state)); }
}

function upsertIn(list, item) {
  const i = list.findIndex(x => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
}

/* ---------------------------------------------------------------------- */

class CloudBackend {
  constructor(store) {
    this.store = store;
    this.unsubs = [];
    this.user = null;
    this.snapshotsSeen = 0;
    this.migrationChecked = false;
  }

  async start() {
    const v = firebaseSdkVersion;
    const base = `https://www.gstatic.com/firebasejs/${v}`;
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-firestore.js`),
    ]);
    this.auth = authMod;
    this.fs = fsMod;

    const app = appMod.initializeApp(firebaseConfig);
    this.authInstance = authMod.getAuth(app);
    try {
      this.db = fsMod.initializeFirestore(app, {
        localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
      });
    } catch (e) {
      console.warn('Offline cache unavailable, falling back to memory cache', e);
      this.db = fsMod.getFirestore(app);
    }

    // Finish a redirect-based sign in if one is pending (mobile fallback).
    try { await authMod.getRedirectResult(this.authInstance); } catch (e) { console.warn(e); }

    authMod.onAuthStateChanged(this.authInstance, user => {
      this.user = user;
      this.store.user = user ? { name: user.displayName, email: user.email, photo: user.photoURL } : null;
      this.detach();
      if (user) this.attach();
      else { this.store._setState(emptyState()); }
      this.store._emit('auth');
      if (!user) this.store._emit('ready');
    });
  }

  col(name) { return this.fs.collection(this.db, 'households', householdId, name); }
  docRef(name, id) { return this.fs.doc(this.db, 'households', householdId, name, id); }

  attach() {
    const { onSnapshot } = this.fs;
    const s = this.store;
    let roomsLoaded = false, tasksLoaded = false, membersLoaded = false;
    const markReady = () => {
      if (roomsLoaded && tasksLoaded && membersLoaded && !this._ready) {
        this._ready = true;
        s._emit('ready');
        this.maybeOfferMigration();
      }
    };
    this.unsubs.push(onSnapshot(this.col('rooms'), snap => {
      s._patch({ rooms: snap.docs.map(d => d.data()) });
      roomsLoaded = true; markReady();
    }, err => this.onError(err)));
    this.unsubs.push(onSnapshot(this.col('tasks'), snap => {
      s._patch({ tasks: snap.docs.map(d => d.data()) });
      tasksLoaded = true; markReady();
    }, err => this.onError(err)));
    this.unsubs.push(onSnapshot(this.docRef('settings', 'members'), snap => {
      const data = snap.data();
      s._patch({ members: data?.list?.length ? data.list : DEFAULT_MEMBERS.map(m => ({ ...m })) });
      membersLoaded = true; markReady();
    }, err => this.onError(err)));
  }

  onError(err) {
    console.error('Firestore error', err);
    this.store.error = err.code === 'permission-denied'
      ? 'This Google account is not allowed. Add its email to firestore.rules.'
      : (err.message || String(err));
    this.store._emit('auth');
    this.store._emit('ready');
  }

  detach() {
    this.unsubs.forEach(u => u());
    this.unsubs = [];
    this._ready = false;
  }

  maybeOfferMigration() {
    if (this.migrationChecked) return;
    this.migrationChecked = true;
    const st = this.store.state;
    if (st.rooms.length || st.tasks.length) return;
    let local = null;
    try { local = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch { local = null; }
    if (local && (local.tasks?.length || local.rooms?.length)) {
      this.store._emit('migrate', local);
    } else {
      // Brand new household: seed with default rooms so it isn't empty.
      this.replaceAll({ rooms: defaultRooms() });
    }
  }

  async signIn() {
    this.store.error = null;
    const provider = new this.auth.GoogleAuthProvider();
    try {
      await this.auth.signInWithPopup(this.authInstance, provider);
    } catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        await this.auth.signInWithRedirect(this.authInstance, provider);
      } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        this.store.error = e.message;
        this.store._emit('auth');
      }
    }
  }

  async signOut() { await this.auth.signOut(this.authInstance); }

  async upsertRoom(room) { await this.fs.setDoc(this.docRef('rooms', room.id), room); }
  async deleteRoom(id) {
    const batch = this.fs.writeBatch(this.db);
    batch.delete(this.docRef('rooms', id));
    this.store.state.tasks.filter(t => t.roomId === id).forEach(t => batch.delete(this.docRef('tasks', t.id)));
    await batch.commit();
  }
  async upsertTask(task) { await this.fs.setDoc(this.docRef('tasks', task.id), task); }
  async deleteTask(id) { await this.fs.deleteDoc(this.docRef('tasks', id)); }
  async setMembers(members) { await this.fs.setDoc(this.docRef('settings', 'members'), { list: members }); }

  async replaceAll(state) {
    // Firestore batches are capped at 500 writes; chunk to be safe.
    const writes = [];
    (state.rooms || []).forEach(r => writes.push(['rooms', r.id, r]));
    (state.tasks || []).forEach(t => writes.push(['tasks', t.id, t]));
    if (state.members) writes.push(['settings', 'members', { list: state.members }]);
    for (let i = 0; i < writes.length; i += 400) {
      const batch = this.fs.writeBatch(this.db);
      writes.slice(i, i + 400).forEach(([c, id, data]) => batch.set(this.docRef(c, id), data));
      await batch.commit();
    }
  }
}

/* ---------------------------------------------------------------------- */

export class Store extends EventTarget {
  constructor() {
    super();
    this.state = emptyState();
    this.mode = firebaseConfig ? 'cloud' : 'local';
    this.user = null;
    this.error = null;
    this.ready = false;
    this.backend = this.mode === 'cloud' ? new CloudBackend(this) : new LocalBackend(this);
  }

  async init() {
    try {
      await this.backend.start();
    } catch (e) {
      console.error('Backend failed to start', e);
      this.error = 'Could not start sync: ' + (e.message || e);
      this._emit('auth');
      this._emit('ready');
    }
  }

  _emit(type, detail) {
    if (type === 'ready') this.ready = true;
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  _setState(s) { this.state = s; this._emit('change'); }
  _patch(p) { this.state = { ...this.state, ...p }; this._emit('change'); }

  get signedIn() { return this.mode === 'local' || !!this.user; }

  /* Queries */
  room(id) { return this.state.rooms.find(r => r.id === id); }
  task(id) { return this.state.tasks.find(t => t.id === id); }
  member(id) { return this.state.members.find(m => m.id === id); }
  roomsSorted() { return [...this.state.rooms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)); }
  tasksInRoom(roomId) { return this.state.tasks.filter(t => t.roomId === roomId); }

  assigneeLabel(code) {
    if (code === ASSIGNEE_BOTH) return 'Both of us';
    if (code === ASSIGNEE_TRADE) return 'Tradesperson';
    if (!code) return 'Unassigned';
    return this.member(code)?.name || 'Unknown';
  }

  /* Commands */
  async saveRoom(room) {
    const r = {
      id: room.id || uid(),
      name: (room.name || '').trim(),
      order: room.order ?? this.state.rooms.length,
      createdAt: room.createdAt || now(),
      updatedAt: now(),
    };
    await this.backend.upsertRoom(r);
    return r;
  }
  async deleteRoom(id) { await this.backend.deleteRoom(id); }
  async saveTask(task) {
    const t = normaliseTask(task);
    await this.backend.upsertTask(t);
    return t;
  }
  async deleteTask(id) { await this.backend.deleteTask(id); }
  async setTaskStatus(id, status) {
    const t = this.task(id);
    if (t) await this.saveTask({ ...t, status });
  }
  async setMaterialBought(taskId, materialId, bought) {
    const t = this.task(taskId);
    if (!t) return;
    const materials = t.materials.map(m => m.id === materialId ? { ...m, bought } : m);
    await this.saveTask({ ...t, materials });
  }
  async setMembers(members) {
    const list = members.map(m => ({ id: m.id || uid(), name: (m.name || '').trim() || 'Someone', colour: m.colour || '#2a7de1' }));
    await this.backend.setMembers(list);
  }
  async importState(state) {
    const clean = {
      members: Array.isArray(state.members) && state.members.length ? state.members : this.state.members,
      rooms: Array.isArray(state.rooms) ? state.rooms : [],
      tasks: Array.isArray(state.tasks) ? state.tasks.map(normaliseTask) : [],
    };
    await this.backend.replaceAll(clean);
  }
  exportState() { return JSON.stringify(this.state, null, 2); }

  async seedDefaults() { await this.backend.replaceAll({ rooms: defaultRooms() }); }

  async signIn() { if (this.backend.signIn) await this.backend.signIn(); }
  async signOut() { if (this.backend.signOut) await this.backend.signOut(); }
}

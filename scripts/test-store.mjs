// Store tests, with a fake filesystem that can fail on demand.
//
// The interesting assertions here are the failure paths. Anyone can test that a
// save round-trips; the reason this store exists is what happens when the write
// is interrupted, the file is truncated, or the header is corrupted.
import { describe, eq, ok, report } from './harness.mjs';
import { applyEdit, NoteStore } from '../src/core/store/store.ts';
import { decodeVersions, exportFilename, exportNote, parseNote, serializeNote } from '../src/core/store/serialize.ts';
import { emptyNote } from '../src/core/types.ts';

/** In-memory filesystem with injectable faults. */
class FakeFS {
  constructor() {
    this.files = new Map();
    this.dirs = new Set();
    /** Paths whose next write should throw, simulating a full disk or a crash. */
    this.failWrites = new Set();
    this.renameWorks = true;
    this.writes = 0;
  }
  async readFile(p) {
    return this.files.has(p) ? this.files.get(p) : null;
  }
  async writeFile(p, d) {
    this.writes++;
    if (this.failWrites.has(p)) throw new Error('simulated write failure: ' + p);
    this.files.set(p, d);
  }
  async appendFile(p, d) {
    if (this.failWrites.has(p)) throw new Error('simulated append failure: ' + p);
    this.files.set(p, (this.files.get(p) ?? '') + d);
  }
  async deleteFile(p) {
    this.files.delete(p);
  }
  async rename(from, to) {
    if (!this.renameWorks) throw new Error('rename unsupported');
    if (!this.files.has(from)) throw new Error('missing ' + from);
    this.files.set(to, this.files.get(from));
    this.files.delete(from);
  }
  async listDir(p) {
    const prefix = p.endsWith('/') ? p : p + '/';
    const out = [];
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) out.push(k.slice(prefix.length));
    }
    return out;
  }
  async mkdirp(p) {
    this.dirs.add(p);
  }
}

const T0 = Date.UTC(2026, 7, 20);
const mkNote = (id, title, body, extra = {}) =>
  Object.assign(emptyNote(id, T0), { title, body }, extra);

describe('serialize round trip', () => {
  const n = mkNote('abc', 'My title', 'Body with #tag and [[Other]].', {
    pinned: true, archived: false, locked: true, rev: 7, updatedAt: T0 + 500,
  });
  const back = parseNote(serializeNote(n), 'abc');
  eq(back.id, 'abc', 'id');
  eq(back.title, 'My title', 'title');
  eq(back.body, n.body, 'body preserved exactly');
  eq(back.pinned, true, 'pinned');
  eq(back.locked, true, 'locked');
  eq(back.archived, false, 'archived');
  eq(back.rev, 7, 'rev');
  eq(back.updatedAt, T0 + 500, 'updatedAt');
  eq(back.trashedAt, null, 'not trashed');
  eq(back.tags, ['tag'], 'tags derived on parse');
  eq(back.links, ['other'], 'links derived on parse');

  const trashed = parseNote(serializeNote({ ...n, trashedAt: T0 + 9 }), 'abc');
  eq(trashed.trashedAt, T0 + 9, 'trashed timestamp survives');
});

describe('serialize edge cases', () => {
  const tricky = mkNote('x', 'Has: colons --- and ---', 'Line one\n---\nnot a delimiter\n\n  trailing  ');
  const back = parseNote(serializeNote(tricky), 'x');
  eq(back.title, 'Has: colons --- and ---', 'title with delimiters and colons');
  eq(back.body, tricky.body, 'body containing --- is not truncated');

  const empty = parseNote(serializeNote(mkNote('e', '', '')), 'e');
  eq(empty.body, '', 'empty body');
  eq(empty.title, '', 'empty title');

  const multiline = parseNote(serializeNote(mkNote('m', 'a\nb', 'body')), 'm');
  eq(multiline.title, 'a b', 'newlines in a title are flattened, not fatal');

  const unicode = mkNote('u', 'Café 日本語 🎉', 'Ünïcōde body 🎉\n日本語');
  eq(parseNote(serializeNote(unicode), 'u').body, unicode.body, 'unicode body preserved');
  eq(parseNote(serializeNote(unicode), 'u').title, 'Café 日本語 🎉', 'unicode title preserved');
});

describe('damaged files never lose text', () => {
  eq(parseNote('just some text with no header', 'id1').body, 'just some text with no header', 'headerless file');
  eq(parseNote('---\nnot closed\nstill text', 'id2').body, '---\nnot closed\nstill text', 'unterminated header');
  const garbled = parseNote('---\nid: keep\nrev: banana\npinned: maybe\n---\nthe words', 'fallback');
  eq(garbled.body, 'the words', 'body survives a garbled header');
  eq(garbled.rev, 1, 'bad number falls back');
  eq(garbled.pinned, false, 'bad boolean falls back');
  eq(parseNote('---\ntitle: t\n---\nbody', 'fromfile').id, 'fromfile', 'missing id falls back to the filename');
});

describe('version log survives truncation', () => {
  const good = '{"rev":1,"at":1,"title":"a","body":"one"}\n{"rev":2,"at":2,"title":"a","body":"two"}\n';
  eq(decodeVersions(good).length, 2, 'reads complete lines');
  // A crash mid-append leaves a partial final line.
  const truncated = good + '{"rev":3,"at":3,"title":"a","bod';
  eq(decodeVersions(truncated).length, 2, 'drops the torn line');
  eq(decodeVersions(truncated)[1].body, 'two', 'earlier history is untouched');
  eq(decodeVersions('').length, 0, 'empty log');
  eq(decodeVersions('\n\n').length, 0, 'blank lines');
  eq(decodeVersions('total garbage').length, 0, 'garbage yields nothing rather than throwing');
});

await describe('save and load', async () => {
  const fs = new FakeFS();
  const store = new NoteStore(fs, '/root');
  await store.init();

  const a = mkNote('a1', 'First', 'Alpha #work');
  const b = mkNote('b2', 'Second', 'Beta', { updatedAt: T0 + 1000 });
  await store.save(a);
  await store.save(b);

  const loaded = await store.load(T0 + 2000);
  eq(loaded.notes.length, 2, 'both notes load');
  eq(loaded.notes[0].id, 'b2', 'sorted newest first');
  eq(loaded.unreadable.length, 0, 'nothing unreadable');
  eq(loaded.recovered.length, 0, 'nothing needed recovery');
  eq(loaded.notes.find((n) => n.id === 'a1').tags, ['work'], 'tags survive the round trip');
});

await describe('atomic write', async () => {
  const fs = new FakeFS();
  const store = new NoteStore(fs, '/root');
  await store.save(mkNote('n1', 'T', 'v1'));
  // No temp file may be left behind after a successful save.
  ok(![...fs.files.keys()].some((k) => k.endsWith('.tmp')), 'no temp file survives a save');
  eq(fs.files.get('/root/notes/n1.md').includes('v1'), true, 'content is in place');

  // A filesystem without rename must still save.
  fs.renameWorks = false;
  await store.save(mkNote('n1', 'T', 'v2'));
  ok(fs.files.get('/root/notes/n1.md').includes('v2'), 'falls back to a direct write');
  ok(![...fs.files.keys()].some((k) => k.endsWith('.tmp')), 'and cleans up after itself');
});

await describe('recovery from history', async () => {
  const fs = new FakeFS();
  const store = new NoteStore(fs, '/root');
  const n = mkNote('r1', 'Important', 'Work that must not be lost');
  await store.save(n);
  await store.save({ ...n, body: 'Second revision, even more important', rev: 2, updatedAt: T0 + 10 });

  // Simulate the note file being destroyed while history survives.
  fs.files.set('/root/notes/r1.md', '');
  const loaded = await store.load(T0 + 100);
  eq(loaded.recovered, ['r1'], 'reported as recovered');
  eq(loaded.notes.length, 1, 'the note is back');
  eq(loaded.notes[0].body, 'Second revision, even more important', 'newest revision recovered');
  eq(loaded.notes[0].rev, 2, 'revision preserved');

  // A note with neither file nor history is reported rather than silently dropped.
  fs.files.set('/root/notes/ghost.md', '');
  const second = await store.load(T0 + 100);
  eq(second.unreadable, ['ghost'], 'unrecoverable note is reported');
});

await describe('history ordering and compaction', async () => {
  const fs = new FakeFS();
  const store = new NoteStore(fs, '/root');
  let n = mkNote('h1', 'Doc', 'v0');
  for (let i = 1; i <= 60; i++) {
    n = { ...n, body: 'v' + i, rev: i, updatedAt: T0 + i };
    await store.save(n);
  }
  const versions = await store.versions('h1');
  eq(versions.length, 60, 'all revisions kept before compaction');
  eq(versions[0].body, 'v1', 'oldest first');
  eq(versions[versions.length - 1].body, 'v60', 'newest last');

  await store.compactHistory('h1');
  const after = await store.versions('h1');
  eq(after.length, 50, 'compacted to the cap');
  eq(after[after.length - 1].body, 'v60', 'newest survives compaction');
  eq(after[0].body, 'v11', 'oldest dropped');
});

await describe('trash lifecycle', async () => {
  const fs = new FakeFS();
  const store = new NoteStore(fs, '/root');
  const n = mkNote('t1', 'Doomed', 'text');
  await store.save(n);

  const trashed = await store.trash(n, T0 + 5);
  eq(trashed.trashedAt, T0 + 5, 'timestamped');
  eq((await store.load(T0 + 6)).notes[0].trashedAt, T0 + 5, 'still on disk while in the trash');

  const back = await store.restore(trashed, T0 + 7);
  eq(back.trashedAt, null, 'restore clears it');
  eq((await store.load(T0 + 8)).notes[0].trashedAt, null, 'and persists');

  // Past the retention window it is purged on load.
  await store.trash(back, T0 + 9);
  const later = await store.load(T0 + 9 + 31 * 864e5);
  eq(later.purged, 1, 'purged after 30 days');
  eq(later.notes.length, 0, 'and gone');
  eq(await fs.readFile('/root/versions/t1.jsonl'), null, 'history purged too');

  // Just inside the window it survives.
  const fs2 = new FakeFS();
  const store2 = new NoteStore(fs2, '/root');
  const m = mkNote('t2', 'Recent', 'text');
  await store2.save(m);
  await store2.trash(m, T0);
  eq((await store2.load(T0 + 29 * 864e5)).notes.length, 1, 'survives at 29 days');
});

describe('applyEdit', () => {
  const base = mkNote('e1', 'Title', 'Body #old', { rev: 3 });
  base.tags = ['old'];

  const edited = applyEdit(base, { body: 'Body #new and [[Link]]' }, T0 + 100);
  eq(edited.rev, 4, 'content change bumps the revision');
  eq(edited.updatedAt, T0 + 100, 'and the timestamp');
  eq(edited.tags, ['new'], 'tags recomputed');
  eq(edited.links, ['link'], 'links recomputed');

  const pinned = applyEdit(base, { pinned: true }, T0 + 200);
  eq(pinned.rev, 3, 'pinning is not an edit');
  eq(pinned.updatedAt, base.updatedAt, 'and does not disturb the sort order');

  const same = applyEdit(base, { body: base.body }, T0 + 300);
  eq(same.rev, 3, 'writing identical text is not an edit');
});

describe('export', () => {
  const n = mkNote('x1', 'My Note', 'Some body');
  eq(exportNote(n), '# My Note\n\nSome body', 'adds the title as a heading');
  eq(exportNote(mkNote('x', 'Dup', '# Dup\n\nbody')), '# Dup\n\nbody', 'does not double an existing title');
  eq(exportNote(mkNote('x', '', 'just body')), 'just body', 'untitled exports bare');

  const taken = new Set();
  eq(exportFilename(mkNote('a', 'Trip: Kyoto/2026', ''), taken), 'Trip Kyoto 2026.md', 'unsafe characters become spaces');
  eq(exportFilename(mkNote('b', 'Trip: Kyoto/2026', ''), taken), 'Trip Kyoto 2026 2.md', 'deduplicates');
  eq(exportFilename(mkNote('d', 'a'.repeat(200), ''), new Set()).length, 63, 'long titles are truncated');
  eq(exportFilename(mkNote('c', '', ''), taken), 'Untitled.md', 'untitled fallback');
});

await describe('a full realistic session', async () => {
  const fs = new FakeFS();
  const store = new NoteStore(fs, '/root');
  let note = await store.create(T0);
  note = applyEdit(note, { title: 'Groceries', body: '- [ ] milk' }, T0);
  await store.save(note);

  for (let i = 0; i < 12; i++) {
    note = applyEdit(note, { body: note.body + `\n- [ ] item ${i}` }, T0 + i * 1000);
    await store.save(note);
  }
  note = applyEdit(note, { pinned: true }, T0 + 99999);
  await store.save(note);

  const loaded = await store.load(T0 + 1e6);
  eq(loaded.notes.length, 1, 'one note');
  eq(loaded.notes[0].pinned, true, 'pinned state persisted');
  eq(loaded.notes[0].body.split('\n').length, 13, 'all edits present');
  // 13 content revisions (2 through 14). The final pin toggle re-saves at the
  // same revision, and history is keyed by revision, so it does not add a
  // duplicate entry — non-edits must not inflate a note's history.
  eq((await store.versions(note.id)).length, 13, 'every content revision recorded, once each');
  const revs = (await store.versions(note.id)).map((v) => v.rev);
  eq(revs, [...new Set(revs)], 'no duplicate revisions in history');
  eq(loaded.unreadable.length + loaded.recovered.length, 0, 'clean load');
});

report('store');

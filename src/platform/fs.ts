// Filesystem adapters.
//
// The core store talks to the `FileSystem` interface and knows nothing about
// Expo. On device that is backed by real files in the app's document directory,
// which is what makes "your notes are Markdown files you own" literally true.
// On web it is backed by localStorage so the same code can be exercised in a
// browser during development.

import { Platform } from 'react-native';
import type { FileSystem } from '../core/store/store.ts';

/** Web adapter: a flat path -> contents map persisted in localStorage. */
class WebFileSystem implements FileSystem {
  private key = 'sift.fs.v1';
  private cache: Record<string, string> | null = null;

  private read(): Record<string, string> {
    if (this.cache) return this.cache;
    try {
      const raw = globalThis.localStorage?.getItem(this.key);
      this.cache = raw ? JSON.parse(raw) : {};
    } catch {
      this.cache = {};
    }
    return this.cache!;
  }

  private flush(): void {
    try {
      globalThis.localStorage?.setItem(this.key, JSON.stringify(this.cache ?? {}));
    } catch {
      // Private browsing or a full quota. Notes stay in memory for this session.
    }
  }

  async readFile(path: string): Promise<string | null> {
    const files = this.read();
    return Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null;
  }

  async writeFile(path: string, data: string): Promise<void> {
    this.read()[path] = data;
    this.flush();
  }

  async appendFile(path: string, data: string): Promise<void> {
    const files = this.read();
    files[path] = (files[path] ?? '') + data;
    this.flush();
  }

  async deleteFile(path: string): Promise<void> {
    delete this.read()[path];
    this.flush();
  }

  async rename(from: string, to: string): Promise<void> {
    const files = this.read();
    if (!(from in files)) throw new Error('missing ' + from);
    files[to] = files[from];
    delete files[from];
    this.flush();
  }

  async listDir(path: string): Promise<string[]> {
    const prefix = path.endsWith('/') ? path : path + '/';
    return Object.keys(this.read())
      .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map((k) => k.slice(prefix.length));
  }

  async mkdirp(): Promise<void> {
    // Paths are flat keys on web; there is nothing to create.
  }
}

/** Native adapter over expo-file-system's File/Directory API. */
class ExpoFileSystem implements FileSystem {
  private mod: typeof import('expo-file-system');

  constructor(mod: typeof import('expo-file-system')) {
    this.mod = mod;
  }

  async readFile(path: string): Promise<string | null> {
    const file = new this.mod.File(path);
    if (!file.exists) return null;
    return await file.text();
  }

  async writeFile(path: string, data: string): Promise<void> {
    const file = new this.mod.File(path);
    if (!file.exists) file.create({ intermediates: true, overwrite: true });
    file.write(data);
  }

  async appendFile(path: string, data: string): Promise<void> {
    const file = new this.mod.File(path);
    if (!file.exists) file.create({ intermediates: true, overwrite: true });
    file.write(data, { append: true });
  }

  async deleteFile(path: string): Promise<void> {
    const file = new this.mod.File(path);
    if (file.exists) file.delete();
  }

  async rename(from: string, to: string): Promise<void> {
    const src = new this.mod.File(from);
    if (!src.exists) throw new Error('missing ' + from);
    const dest = new this.mod.File(to);
    // move() will not clobber, so clear the destination first. The window this
    // opens is why save() writes history before touching the note file.
    if (dest.exists) dest.delete();
    await src.move(dest);
  }

  async listDir(path: string): Promise<string[]> {
    const dir = new this.mod.Directory(path);
    if (!dir.exists) return [];
    return dir.list().map((entry) => entry.name);
  }

  async mkdirp(path: string): Promise<void> {
    const dir = new this.mod.Directory(path);
    if (!dir.exists) dir.create({ intermediates: true });
  }
}

let cached: { fs: FileSystem; root: string } | null = null;

/** The filesystem and root directory for this platform. */
export function getFileSystem(): { fs: FileSystem; root: string } {
  if (cached) return cached;
  if (Platform.OS === 'web') {
    cached = { fs: new WebFileSystem(), root: '/sift' };
  } else {
    // Required lazily: importing expo-file-system at module scope pulls a
    // native module that does not exist in a browser bundle.
    const mod = require('expo-file-system') as typeof import('expo-file-system');
    const root = mod.Paths.document.uri.replace(/\/$/, '') + '/sift';
    cached = { fs: new ExpoFileSystem(mod), root };
  }
  return cached;
}

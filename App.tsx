// Sift — a note app whose whole argument is that you can find what you wrote.
//
// Screen routing is a small state machine rather than a navigation library. The
// app has four places you can be, and a stack of note ids for following links
// between notes; that is not worth 400KB of dependency.

import React from 'react';
import {
  Alert, Platform, SafeAreaView, StatusBar, StyleSheet, useColorScheme, useWindowDimensions, View,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { exportNote } from './src/core/store/serialize.ts';
import type { StoredVersion } from './src/core/store/serialize.ts';
import { NoteStore } from './src/core/store/store.ts';
import { deriveTitle } from './src/core/markdown.ts';
import type { Note } from './src/core/types.ts';
import { getFileSystem } from './src/platform/fs.ts';
import { sortNotes, useLibrary } from './src/state/useLibrary.ts';
import { Editor } from './src/ui/Editor.tsx';
import { Graph } from './src/ui/Graph.tsx';
import { Library, type Scope } from './src/ui/Library.tsx';
import { HistorySheet, SettingsSheet } from './src/ui/Sheets.tsx';
import { ACCENTS, palette } from './src/ui/theme.ts';

type Screen = 'library' | 'editor' | 'graph';

export default function App() {
  const scheme = useColorScheme();
  const { width, height } = useWindowDimensions();
  const lib = useLibrary();

  const [screen, setScreen] = React.useState<Screen>('library');
  /** Stack of note ids, so following a link and coming back works. */
  const [stack, setStack] = React.useState<string[]>([]);
  const [query, setQuery] = React.useState('');
  const [scope, setScope] = React.useState<Scope>('active');
  const [activeTag, setActiveTag] = React.useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [versions, setVersions] = React.useState<StoredVersion[]>([]);
  const [suggestQuery, setSuggestQuery] = React.useState<string | null>(null);
  const [unlocked, setUnlocked] = React.useState<Set<string>>(() => new Set());

  const openId = stack[stack.length - 1] ?? null;
  const note = openId ? lib.notes.get(openId) : undefined;

  const effectiveScheme: 'light' | 'dark' =
    lib.settings.theme === 'auto' ? (scheme === 'dark' ? 'dark' : 'light') : lib.settings.theme;
  const p = React.useMemo(() => {
    const base = palette(effectiveScheme);
    const accent = ACCENTS.find((a) => a.name === lib.settings.accent);
    if (!accent) return base;
    const value = effectiveScheme === 'dark' ? accent.dark : accent.light;
    return {
      ...base,
      accent: value,
      // Keep label text legible on the accent in both themes.
      accentText: effectiveScheme === 'dark' ? base.bg : '#FFFFFF',
    };
  }, [effectiveScheme, lib.settings.accent]);

  // Open a blank note at launch when that preference is on.
  const launched = React.useRef(false);
  React.useEffect(() => {
    if (!lib.ready || launched.current) return;
    launched.current = true;
    if (lib.settings.launchIntoNewNote) {
      const fresh = lib.create();
      setStack([fresh.id]);
      setScreen('editor');
    }
  }, [lib.ready, lib.settings.launchIntoNewNote, lib]);

  // The query the search engine actually runs, with the tag filter folded in.
  const effectiveQuery = React.useMemo(() => {
    const parts: string[] = [];
    if (activeTag) parts.push(`tag:${activeTag}`);
    if (query.trim()) parts.push(query.trim());
    return parts.join(' ');
  }, [query, activeTag]);

  const results = React.useMemo(() => {
    const raw = lib.search(effectiveQuery, { scope, limit: 400 });
    // With no search text this is a listing, so apply the user's sort order.
    // With a query, relevance order is the whole point and must not be resorted.
    if (query.trim() === '') {
      const notes = raw
        .map((r) => lib.notes.get(r.id))
        .filter((n): n is Note => n !== undefined);
      const sorted = sortNotes(notes, lib.settings.sortKey, lib.settings.sortAsc);
      const byId = new Map(raw.map((r) => [r.id, r]));
      return sorted.map((n) => byId.get(n.id)!).filter(Boolean);
    }
    return raw;
  }, [lib, effectiveQuery, scope, query, lib.settings.sortKey, lib.settings.sortAsc]);

  const openNote = React.useCallback(
    (id: string, push = false) => {
      setStack((prev) => (push ? [...prev, id] : [id]));
      setScreen('editor');
    },
    [],
  );

  const goBack = React.useCallback(() => {
    setStack((prev) => {
      if (prev.length > 1) return prev.slice(0, -1);
      setScreen('library');
      return [];
    });
    void lib.flush();
  }, [lib]);

  const newNote = React.useCallback(
    (seed?: Partial<Note>) => {
      const fresh = lib.create(seed);
      setStack([fresh.id]);
      setScreen('editor');
    },
    [lib],
  );

  /** Follow a [[wikilink]], creating the note if it does not exist yet. */
  const followLink = React.useCallback(
    (key: string, target: string) => {
      const existing = lib.resolveLink(key);
      if (existing) {
        openNote(existing.id, true);
        return;
      }
      const fresh = lib.create({ title: target, body: `# ${target}\n\n` });
      setStack((prev) => [...prev, fresh.id]);
      setScreen('editor');
    },
    [lib, openNote],
  );

  const showTag = React.useCallback((tag: string) => {
    setActiveTag(tag);
    setQuery('');
    setScope('active');
    setScreen('library');
    setStack([]);
  }, []);

  const openHistory = React.useCallback(async () => {
    if (!openId) return;
    await lib.flush();
    const { fs, root } = getFileSystem();
    const store = new NoteStore(fs, root);
    setVersions(await store.versions(openId));
    setHistoryOpen(true);
  }, [openId, lib]);

  const share = React.useCallback(async (target: Note) => {
    const text = exportNote(target);
    try {
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      const FS = require('expo-file-system') as typeof import('expo-file-system');
      if (Platform.OS !== 'web' && (await Sharing.isAvailableAsync())) {
        const name = (target.title.trim() || 'Note').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 50);
        const file = new FS.File(FS.Paths.cache, `${name || 'Note'}.md`);
        if (file.exists) file.delete();
        file.create({ intermediates: true, overwrite: true });
        file.write(text);
        await Sharing.shareAsync(file.uri, { mimeType: 'text/markdown', UTI: 'net.daringfireball.markdown' });
        return;
      }
    } catch {
      // Fall through to the clipboard, which always works.
    }
    try {
      const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
      await Clipboard.setStringAsync(text);
      notify('Copied', 'The note is on your clipboard as Markdown.');
    } catch {
      notify('Could not share', 'Sharing is unavailable on this device.');
    }
  }, []);

  const exportAll = React.useCallback(async () => {
    const live = [...lib.notes.values()].filter((n) => n.trashedAt === null);
    if (live.length === 0) {
      notify('Nothing to export', 'Write a note first.');
      return;
    }
    const combined = live
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((n) => exportNote(n))
      .join('\n\n---\n\n');
    try {
      const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
      await Clipboard.setStringAsync(combined);
      notify('Copied', `${live.length} notes copied as Markdown.`);
    } catch {
      notify('Could not export', 'Copying is unavailable on this device.');
    }
  }, [lib.notes]);

  /** Face ID / passcode gate for locked notes. */
  const authenticate = React.useCallback(async (reason: string): Promise<boolean> => {
    if (Platform.OS === 'web') return true;
    try {
      const LA = require('expo-local-authentication') as typeof import('expo-local-authentication');
      const has = await LA.hasHardwareAsync();
      const enrolled = await LA.isEnrolledAsync();
      if (!has || !enrolled) return true;
      const res = await LA.authenticateAsync({ promptMessage: reason });
      return res.success;
    } catch {
      // Without a working biometric module, refusing would lock people out of
      // their own notes permanently. Fail open.
      return true;
    }
  }, []);

  const openMaybeLocked = React.useCallback(
    async (id: string) => {
      const target = lib.notes.get(id);
      if (target?.locked && !unlocked.has(id)) {
        const ok = await authenticate('Unlock this note');
        if (!ok) return;
        setUnlocked((prev) => new Set(prev).add(id));
      }
      openNote(id);
    },
    [lib.notes, unlocked, authenticate, openNote],
  );

  const backlinks = React.useMemo(() => {
    if (!openId) return [];
    return (lib.graph.incoming.get(openId) ?? [])
      .map((id) => lib.notes.get(id))
      .filter((n): n is Note => n !== undefined);
  }, [openId, lib.graph, lib.notes]);

  const unresolvedKeys = React.useMemo(() => new Set(lib.graph.unresolved.keys()), [lib.graph]);

  const suggestions = React.useMemo(
    () => (suggestQuery === null ? [] : lib.titleSuggestions(suggestQuery)),
    [suggestQuery, lib],
  );

  const storageNote = Platform.OS === 'web'
    ? 'Running in a browser, so notes are stored in this browser only.'
    : 'Stored in this app’s Documents folder on your device.';

  return (
    <SafeAreaProvider>
      <ExpoStatusBar style={effectiveScheme === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView style={[styles.root, { backgroundColor: p.bg }]}>
        <View style={styles.root}>
          {screen === 'library' ? (
            <Library
              palette={p}
              ready={lib.ready}
              query={query}
              onQueryChange={setQuery}
              results={results}
              notes={lib.notes}
              scope={scope}
              onScopeChange={setScope}
              activeTag={activeTag}
              onTagChange={setActiveTag}
              tags={lib.tags}
              counts={lib.counts}
              recoveredCount={lib.recovered.length}
              onOpen={(id) => void openMaybeLocked(id)}
              onLongPress={(id) => {
                const target = lib.notes.get(id);
                if (!target) return;
                confirmAction(
                  target.pinned ? 'Unpin note' : 'Pin note',
                  target.title.trim() || 'Untitled',
                  () => lib.update(id, { pinned: !target.pinned }),
                );
              }}
              onNew={() => newNote()}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenGraph={() => setScreen('graph')}
              onEmptyTrash={() =>
                confirmAction(
                  'Empty trash',
                  `Permanently delete ${lib.counts.trashed} ${lib.counts.trashed === 1 ? 'note' : 'notes'}? This cannot be undone.`,
                  lib.emptyTrash,
                  true,
                )
              }
            />
          ) : screen === 'graph' ? (
            <Graph
              palette={p}
              notes={lib.notes}
              graph={lib.graph}
              width={width}
              height={height}
              onOpen={(id) => openNote(id)}
              onBack={() => setScreen('library')}
              onCreate={(title) => newNote({ title, body: `# ${title}\n\n` })}
            />
          ) : note ? (
            <Editor
              note={note}
              palette={p}
              fontScale={lib.settings.fontScale}
              editorFont={lib.settings.editorFont}
              backlinks={backlinks}
              unresolved={unresolvedKeys}
              suggestions={suggestions}
              onChangeBody={(body) => lib.update(note.id, { body, title: deriveTitle(body) })}
              onBack={goBack}
              onTogglePin={() => lib.update(note.id, { pinned: !note.pinned })}
              onToggleArchive={() => {
                lib.update(note.id, { archived: !note.archived });
                goBack();
              }}
              onToggleLock={() => {
                void (async () => {
                  const ok = await authenticate(note.locked ? 'Remove the lock' : 'Lock this note');
                  if (ok) lib.update(note.id, { locked: !note.locked });
                })();
              }}
              onTrash={() => {
                lib.trash(note.id);
                goBack();
              }}
              onRestore={() => lib.restore(note.id)}
              onDestroy={() =>
                confirmAction('Delete forever', 'This note and its history will be gone.', () => {
                  lib.destroy(note.id);
                  goBack();
                }, true)
              }
              onShare={() => void share(note)}
              onOpenHistory={() => void openHistory()}
              onOpenWiki={(key, target) => followLink(key, target)}
              onOpenTag={showTag}
              onRequestSuggestions={setSuggestQuery}
            />
          ) : null}
        </View>
      </SafeAreaView>

      <HistorySheet
        visible={historyOpen}
        onClose={() => setHistoryOpen(false)}
        palette={p}
        versions={versions}
        currentBody={note?.body ?? ''}
        onRestore={(v) => {
          if (note) lib.update(note.id, { body: v.body, title: deriveTitle(v.body) });
        }}
      />

      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        palette={p}
        settings={lib.settings}
        onChange={lib.setSettings}
        counts={lib.counts}
        onExportAll={() => void exportAll()}
        storageNote={storageNote}
      />
      {Platform.OS === 'android' ? <StatusBar backgroundColor={p.bg} /> : null}
    </SafeAreaProvider>
  );
}

function notify(title: string, message: string): void {
  if (Platform.OS === 'web') {
    // Alert.alert is a no-op on react-native-web.
    globalThis.alert?.(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function confirmAction(title: string, message: string, onConfirm: () => void, destructive = false): void {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: title, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

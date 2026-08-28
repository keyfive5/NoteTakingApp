// Modal sheets: version history and settings.

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
// Aliased: `preview` is already the name of this sheet's selected-version state.
import { preview as excerpt } from '../core/search/engine.ts';
import type { StoredVersion } from '../core/store/serialize.ts';
import type { Settings, SortKey } from '../core/types.ts';
import { wordCount } from '../core/types.ts';
import { Icon } from './Icon.tsx';
import { ACCENTS, fullTime, radius, space, type Palette } from './theme.ts';

function Sheet({
  visible,
  onClose,
  title,
  palette: p,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  palette: Palette;
  children: React.ReactNode;
}) {
  const s = React.useMemo(() => sheet(p), [p]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={s.backdropTap} onPress={onClose} accessibilityLabel="Close" />
        <View style={s.sheet}>
          <View style={s.grabber} />
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <Icon name="close" size={20} color={p.textDim} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/**
 * Version history.
 *
 * This is the visible half of the promise that nothing is lost. Every save is a
 * revision, and any revision can be brought back — which also means a restore is
 * itself just another revision, so restoring can never destroy anything either.
 */
export function HistorySheet({
  visible,
  onClose,
  palette: p,
  versions,
  currentBody,
  onRestore,
}: {
  visible: boolean;
  onClose: () => void;
  palette: Palette;
  versions: StoredVersion[];
  currentBody: string;
  onRestore: (v: StoredVersion) => void;
}) {
  const s = React.useMemo(() => sheet(p), [p]);
  const [preview, setPreview] = React.useState<StoredVersion | null>(null);
  const ordered = React.useMemo(() => [...versions].reverse(), [versions]);

  React.useEffect(() => {
    if (!visible) setPreview(null);
  }, [visible]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Version history" palette={p}>
      {preview ? (
        <View style={s.previewWrap}>
          <View style={s.previewBar}>
            <Pressable onPress={() => setPreview(null)} hitSlop={10} style={s.rowBtn}>
              <Icon name="back" size={18} color={p.textDim} />
              <Text style={s.rowBtnText}>All versions</Text>
            </Pressable>
            <Text style={s.previewTime}>{fullTime(preview.at)}</Text>
          </View>
          <ScrollView style={s.previewBody} contentContainerStyle={s.previewContent}>
            <Text style={s.previewText}>{preview.body || '(empty)'}</Text>
          </ScrollView>
          <Pressable
            onPress={() => {
              onRestore(preview);
              setPreview(null);
              onClose();
            }}
            style={s.primaryBtn}
          >
            <Icon name="restore" size={17} color={p.accentText} />
            <Text style={s.primaryBtnText}>Restore this version</Text>
          </Pressable>
        </View>
      ) : ordered.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyText}>No earlier versions yet. Every edit you make from now is kept here.</Text>
        </View>
      ) : (
        <ScrollView style={s.list} contentContainerStyle={s.listContent}>
          {ordered.map((v, i) => {
            const isCurrent = v.body === currentBody && i === 0;
            const delta = i < ordered.length - 1 ? wordCount(v.body) - wordCount(ordered[i + 1].body) : null;
            return (
              <Pressable key={`${v.rev}-${v.at}`} onPress={() => setPreview(v)} style={s.versionRow}>
                <View style={s.versionDot} />
                <View style={s.versionMain}>
                  <Text style={s.versionTime}>
                    {fullTime(v.at)}
                    {isCurrent ? ' · current' : ''}
                  </Text>
                  <Text style={s.versionMeta}>
                    Revision {v.rev} · {wordCount(v.body)} words
                    {delta !== null && delta !== 0 ? ` · ${delta > 0 ? '+' : ''}${delta}` : ''}
                  </Text>
                  <Text style={s.versionPreview} numberOfLines={1}>
                    {/* Strip the markup: a history row is for recognising a
                        version at a glance, not for reading its source. */}
                    {excerpt(v.body) || v.title || '(empty)'}
                  </Text>
                </View>
                <Icon name="chevron" size={16} color={p.textFaint} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </Sheet>
  );
}

export function SettingsSheet({
  visible,
  onClose,
  palette: p,
  settings,
  onChange,
  counts,
  onExportAll,
  storageNote,
}: {
  visible: boolean;
  onClose: () => void;
  palette: Palette;
  settings: Settings;
  onChange: (next: Partial<Settings>) => void;
  counts: { active: number; archived: number; trashed: number };
  onExportAll: () => void;
  storageNote: string;
}) {
  const s = React.useMemo(() => sheet(p), [p]);
  const sorts: { key: SortKey; label: string }[] = [
    { key: 'updated', label: 'Edited' },
    { key: 'created', label: 'Created' },
    { key: 'title', label: 'Title' },
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title="Settings" palette={p}>
      <ScrollView style={s.list} contentContainerStyle={s.listContent}>
        <Text style={s.groupTitle}>Appearance</Text>
        <View style={s.segment}>
          {(['auto', 'light', 'dark'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => onChange({ theme: t })}
              style={[s.segmentItem, settings.theme === t && s.segmentItemOn]}
            >
              <Text style={[s.segmentText, settings.theme === t && s.segmentTextOn]}>
                {t === 'auto' ? 'Automatic' : t === 'light' ? 'Light' : 'Dark'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>Accent</Text>
        <View style={s.swatches}>
          {ACCENTS.map((a) => {
            const value = p.dark ? a.dark : a.light;
            return (
              <Pressable
                key={a.name}
                onPress={() => onChange({ accent: a.name })}
                style={[s.swatch, { backgroundColor: value }, settings.accent === a.name && s.swatchOn]}
                accessibilityLabel={a.name}
              >
                {settings.accent === a.name ? <Icon name="check" size={15} color={p.accentText} strokeWidth={2.6} /> : null}
              </Pressable>
            );
          })}
        </View>

        <Text style={s.label}>Text size</Text>
        <View style={s.segment}>
          {[0.9, 1, 1.15, 1.3].map((scale) => (
            <Pressable
              key={scale}
              onPress={() => onChange({ fontScale: scale })}
              style={[s.segmentItem, settings.fontScale === scale && s.segmentItemOn]}
            >
              <Text
                style={[
                  s.segmentText,
                  settings.fontScale === scale && s.segmentTextOn,
                  { fontSize: 12 + (scale - 0.9) * 12 },
                ]}
              >
                Aa
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>Writing font</Text>
        <View style={s.segment}>
          {(['sans', 'serif', 'mono'] as const).map((f) => (
            <Pressable
              key={f}
              onPress={() => onChange({ editorFont: f })}
              style={[s.segmentItem, settings.editorFont === f && s.segmentItemOn]}
            >
              <Text
                style={[
                  s.segmentText,
                  settings.editorFont === f && s.segmentTextOn,
                  f === 'serif' && { fontFamily: 'Georgia' },
                  f === 'mono' && { fontFamily: 'Menlo' },
                ]}
              >
                {f === 'sans' ? 'Sans' : f === 'serif' ? 'Serif' : 'Mono'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.groupTitle}>Notes</Text>
        <Text style={s.label}>Sort by</Text>
        <View style={s.segment}>
          {sorts.map((so) => (
            <Pressable
              key={so.key}
              onPress={() => onChange({ sortKey: so.key })}
              style={[s.segmentItem, settings.sortKey === so.key && s.segmentItemOn]}
            >
              <Text style={[s.segmentText, settings.sortKey === so.key && s.segmentTextOn]}>{so.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.switchRow}>
          <View style={s.switchText}>
            <Text style={s.switchLabel}>Open straight into a new note</Text>
            <Text style={s.switchHint}>Skips the list so a thought never waits on a tap.</Text>
          </View>
          <Switch
            value={settings.launchIntoNewNote}
            onValueChange={(v) => onChange({ launchIntoNewNote: v })}
            trackColor={{ true: p.accent, false: p.borderStrong }}
          />
        </View>

        <Text style={s.groupTitle}>Your data</Text>
        <View style={s.infoBox}>
          <Text style={s.infoText}>
            {counts.active} notes, {counts.archived} archived, {counts.trashed} in trash.
          </Text>
          <Text style={s.infoText}>{storageNote}</Text>
          <Text style={s.infoDim}>
            Every note is a Markdown file on this device with its own version history. There is no account,
            no server, and nothing to subscribe to.
          </Text>
        </View>

        <Pressable onPress={onExportAll} style={s.secondaryBtn}>
          <Icon name="share" size={17} color={p.text} />
          <Text style={s.secondaryBtnText}>Export all notes as Markdown</Text>
        </Pressable>

        <Text style={s.groupTitle}>Search tips</Text>
        <View style={s.infoBox}>
          {[
            ['tag:work/clients', 'notes under a tag, including nested ones'],
            ['is:todo', 'notes with an unfinished checkbox'],
            ['"exact phrase"', 'words in that order'],
            ['-word', 'exclude anything containing it'],
            ['updated:>2026-01-01', 'edited since a date'],
          ].map(([code, meaning]) => (
            <View key={code} style={s.tipRow}>
              <Text style={s.tipCode}>{code}</Text>
              <Text style={s.tipMeaning}>{meaning}</Text>
            </View>
          ))}
          <Text style={s.infoDim}>
            Spelling does not have to be exact. Sift also matches close spellings, other endings of the same
            word, and compounds written either as one word or two.
          </Text>
        </View>

        <Text style={s.version}>Sift 1.0</Text>
      </ScrollView>
    </Sheet>
  );
}

function sheet(p: Palette) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
    backdropTap: { flex: 1 },
    sheet: {
      maxHeight: '88%',
      backgroundColor: p.bg,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingBottom: space(6),
    },
    grabber: {
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: p.borderStrong,
      alignSelf: 'center',
      marginTop: space(2.5),
    },
    sheetHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space(5),
      paddingTop: space(3),
      paddingBottom: space(2),
    },
    sheetTitle: { fontSize: 20, fontWeight: '700', color: p.text, letterSpacing: -0.3 },

    list: { flexGrow: 0 },
    listContent: { paddingHorizontal: space(5), paddingBottom: space(6) },

    emptyBox: { padding: space(6) },
    emptyText: { fontSize: 14.5, color: p.textDim, lineHeight: 21, textAlign: 'center' },

    versionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space(3),
      paddingVertical: space(3),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
    },
    versionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: p.accent },
    versionMain: { flex: 1, gap: 2 },
    versionTime: { fontSize: 14.5, fontWeight: '600', color: p.text },
    versionMeta: { fontSize: 12, color: p.textFaint },
    versionPreview: { fontSize: 13, color: p.textDim, marginTop: 2 },

    previewWrap: { paddingHorizontal: space(5), gap: space(3) },
    previewBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowBtn: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
    rowBtnText: { fontSize: 14, color: p.textDim, fontWeight: '600' },
    previewTime: { fontSize: 12.5, color: p.textFaint },
    previewBody: {
      maxHeight: 320,
      backgroundColor: p.surfaceAlt,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: p.border,
    },
    previewContent: { padding: space(4) },
    previewText: { fontSize: 14.5, color: p.text, lineHeight: 21 },

    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space(2),
      backgroundColor: p.accent,
      paddingVertical: space(3.5),
      borderRadius: radius.md,
    },
    primaryBtnText: { color: p.accentText, fontWeight: '700', fontSize: 15 },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space(2),
      paddingVertical: space(3.5),
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: p.borderStrong,
      marginTop: space(3),
    },
    secondaryBtnText: { color: p.text, fontWeight: '600', fontSize: 15 },

    groupTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: p.textFaint,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginTop: space(6),
      marginBottom: space(2),
    },
    label: { fontSize: 13.5, color: p.textDim, marginTop: space(4), marginBottom: space(2), fontWeight: '600' },
    segment: {
      flexDirection: 'row',
      backgroundColor: p.surfaceAlt,
      borderRadius: radius.sm,
      padding: 3,
      borderWidth: 1,
      borderColor: p.border,
    },
    segmentItem: { flex: 1, alignItems: 'center', paddingVertical: space(2.5), borderRadius: radius.sm - 2 },
    segmentItemOn: { backgroundColor: p.surface },
    segmentText: { fontSize: 14, color: p.textDim, fontWeight: '600' },
    segmentTextOn: { color: p.text },

    swatches: { flexDirection: 'row', gap: space(2.5), flexWrap: 'wrap' },
    swatch: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
    swatchOn: { borderWidth: 2.5, borderColor: p.text },

    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space(3),
      marginTop: space(4),
      paddingVertical: space(1),
    },
    switchText: { flex: 1 },
    switchLabel: { fontSize: 15, color: p.text, fontWeight: '500' },
    switchHint: { fontSize: 12.5, color: p.textFaint, marginTop: 2, lineHeight: 17 },

    infoBox: {
      padding: space(4),
      borderRadius: radius.md,
      backgroundColor: p.surfaceAlt,
      borderWidth: 1,
      borderColor: p.border,
      gap: space(1.5),
    },
    infoText: { fontSize: 14, color: p.text },
    infoDim: { fontSize: 12.5, color: p.textDim, lineHeight: 18, marginTop: space(1) },
    tipRow: { flexDirection: 'row', alignItems: 'baseline', gap: space(2), flexWrap: 'wrap' },
    tipCode: { fontFamily: 'Menlo', fontSize: 12.5, color: p.accent },
    tipMeaning: { flex: 1, fontSize: 12.5, color: p.textDim },

    version: { fontSize: 12, color: p.textFaint, textAlign: 'center', marginTop: space(8) },
  });
}

import React from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, ScrollView, Image, ActivityIndicator, Platform, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { X, ExternalLink, Share2, Download } from '../icons';
import type { Email } from '../../api/types';
import { spacing, radius, typography, componentSizes, type ThemePalette } from '../../theme/tokens';
import { useColors } from '../../theme/colors';
import { useLocaleStore } from '../../stores/locale-store';
import EmailBodyView from '../EmailBodyView';
import { needsNativeImageDecoder, needsWebImageViewer, type PreviewKind } from '../../lib/file-preview';
import type { EmlPreview } from './use-body-override';
import { MODAL_ORIENTATIONS } from '../../lib/modal-orientations';

export interface PreviewItem {
  kind: PreviewKind;
  name: string;
  mimeType: string;
  /** Local file:// URI of the downloaded copy (images, PDFs, media). */
  fileUri?: string;
  /** The viewer page next to the file (images, video, audio); see preview-viewer-html. */
  viewerUri?: string;
  /** Decoded text for text-like parts. */
  text?: string;
  /** The document for HTML and Markdown files, shown through the mail sanitiser. */
  html?: string;
  /** Parsed embedded message for .eml previews. */
  eml?: EmlPreview;
  /** Replaces "No preview for this file type." on the fallback screen (e.g. the file is too large). */
  notice?: string;
}

interface Props {
  item: PreviewItem | null;
  loading: boolean;
  /** Header title while the item is still loading. */
  title?: string;
  onClose: () => void;
  /** Hand the file to another app (types without a preview, the header's Open button). */
  onOpenExternal: () => void;
  onShare: () => void;
  /** Save a copy; adds a Download button to the header. */
  onDownload?: () => void;
  /** Render in place (a split view's side pane) instead of a full-screen modal. */
  docked?: boolean;
}

/**
 * A local page in a WebView that may read only its own folder: the image
 * and media viewers. It posts 'error' when the file doesn't decode.
 */
function ViewerWebView({ uri, background, onFailed }: { uri: string; background: string; onFailed: () => void }) {
  const folder = uri.slice(0, uri.lastIndexOf('/') + 1);
  return (
    <WebView
      source={{ uri }}
      originWhitelist={['file://*']}
      allowFileAccess
      allowingReadAccessToURL={folder}
      javaScriptEnabled
      domStorageEnabled={false}
      cacheEnabled={false}
      incognito
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowsFullscreenVideo
      allowsPictureInPictureMediaPlayback
      allowsAirPlayForMediaPlayback
      setSupportMultipleWindows={false}
      setBuiltInZoomControls
      setDisplayZoomControls={false}
      overScrollMode="never"
      bounces={false}
      onShouldStartLoadWithRequest={(req) => req.url === uri}
      onMessage={(e) => { if (e.nativeEvent.data === 'error') onFailed(); }}
      onError={onFailed}
      style={[viewerStyles.fill, { backgroundColor: background }]}
      containerStyle={{ backgroundColor: background }}
    />
  );
}

/**
 * In-app preview for images, PDFs (iOS renders them in the WebView), video
 * and audio (the WebView's player), text, Markdown and HTML documents and
 * embedded messages. Files that don't decode, and types without a preview,
 * offer another app instead. Used by every place that opens a file.
 */
export function AttachmentPreviewModal({
  item, loading, title, onClose, onOpenExternal, onShare, onDownload, docked = false,
}: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const t = useLocaleStore((s) => s.t);
  const { width } = useWindowDimensions();
  // Which viewers failed for the open file, keyed by its URI so the next one
  // starts clean: React Native's Image falls back to the WebView viewer, and
  // a WebView that can't decode the file falls back to another app.
  const [failed, setFailed] = React.useState<{ uri: string; native?: boolean; web?: boolean } | null>(null);
  const markFailed = React.useCallback((uri: string | undefined, which: 'native' | 'web') => {
    if (!uri) return;
    setFailed((prev) => ({ ...(prev?.uri === uri ? prev : {}), uri, [which]: true }));
  }, []);
  // The image fits the area it is shown in (a pane, a landscape window),
  // not a box derived from the window width that ran past the screen.
  const [imageArea, setImageArea] = React.useState<{ width: number; height: number } | null>(null);

  const docEmail = React.useMemo<Email | null>(() => {
    if (!item || (!item.eml && item.html == null)) return null;
    return {
      id: `file-preview-${item.kind}-${item.fileUri ?? item.name}`,
      threadId: '',
      mailboxIds: {},
      keywords: {},
      size: 0,
      receivedAt: item.eml?.date ?? new Date().toISOString(),
      hasAttachment: false,
      subject: item.eml?.subject ?? item.name,
    };
  }, [item]);

  const failure = item?.fileUri && failed?.uri === item.fileUri ? failed : null;
  // Android's WebView zooms; React Native's Image there doesn't. iOS zooms
  // the native image in its ScrollView. Each side's gaps go to the other.
  const imageInWeb = item?.kind === 'image' && !!item.viewerUri && !failure?.web && (
    failure?.native
    || (Platform.OS === 'android' ? !needsNativeImageDecoder(item) : needsWebImageViewer(item))
  );
  const imageFailed = item?.kind === 'image' && (
    !!failure?.web && (!!failure.native || !item.viewerUri || needsWebImageViewer(item))
    || (!!failure?.native && !item.viewerUri)
  );
  const mediaFailed = (item?.kind === 'video' || item?.kind === 'audio') && !!failure?.web;
  const pdfInline = item?.kind === 'pdf' && Platform.OS === 'ios' && !!item.fileUri;
  // The fallback screen has its own Open button; the header adds one elsewhere.
  const showsFallback = !!item && (
    item.kind === 'none' || (item.kind === 'pdf' && !pdfInline) || imageFailed || mediaFailed
  );

  const renderFallback = (message: string) => (
    <View style={styles.centered}>
      <Text style={styles.hint}>{message}</Text>
      <Pressable style={styles.button} onPress={onOpenExternal}>
        <ExternalLink size={16} color={c.primaryForeground} />
        <Text style={styles.buttonText}>{t('email_viewer.preview.open_external', 'Open in app')}</Text>
      </Pressable>
    </View>
  );

  const renderDocument = (header?: React.ReactNode) => (
    <ScrollView style={styles.flex}>
      {header}
      {docEmail && <EmailBodyView email={docEmail} bodyOverride={{ html: item?.html ?? item?.eml?.html, text: item?.eml?.text }} />}
    </ScrollView>
  );

  const renderBody = () => {
    if (loading || !item) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={c.primary} />
        </View>
      );
    }
    switch (item.kind) {
      case 'image':
        if (imageFailed) {
          return renderFallback(t('email_viewer.preview.unsupported', 'No preview for this file type.'));
        }
        if (imageInWeb && item.viewerUri) {
          return (
            <ViewerWebView
              key={item.viewerUri}
              uri={item.viewerUri}
              background={c.background}
              onFailed={() => markFailed(item.fileUri, 'web')}
            />
          );
        }
        return (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.imageScroll}
            onLayout={(e) => {
              const { width: w, height: h } = e.nativeEvent.layout;
              setImageArea((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
            }}
            maximumZoomScale={4}
            minimumZoomScale={1}
            bouncesZoom
          >
            <Image
              source={{ uri: item.fileUri }}
              style={imageArea
                ? { width: imageArea.width - spacing.lg * 2, height: imageArea.height - spacing.lg * 2 }
                : { width: width - spacing.lg * 2, height: width * 1.2 }}
              resizeMode="contain"
              accessibilityLabel={item.name}
              onError={() => markFailed(item.fileUri, 'native')}
            />
          </ScrollView>
        );
      case 'video':
      case 'audio':
        if (mediaFailed || !item.viewerUri) {
          return renderFallback(t('email_viewer.preview.media_unsupported', "This file can't be played here."));
        }
        return (
          <ViewerWebView
            key={item.viewerUri}
            uri={item.viewerUri}
            background={item.kind === 'video' ? '#000' : c.background}
            onFailed={() => markFailed(item.fileUri, 'web')}
          />
        );
      case 'pdf':
        if (pdfInline && item.fileUri) {
          return (
            <WebView
              source={{ uri: item.fileUri }}
              originWhitelist={['file://*']}
              allowFileAccess
              allowingReadAccessToURL={item.fileUri}
              style={styles.flex}
              javaScriptEnabled={false}
              setSupportMultipleWindows={false}
              onShouldStartLoadWithRequest={(req) => req.url === item.fileUri}
            />
          );
        }
        return renderFallback(t('email_viewer.preview.pdf_external', 'PDFs open in your PDF viewer on this device.'));
      case 'text':
        return (
          <ScrollView style={styles.flex} contentContainerStyle={styles.textScroll}>
            <Text selectable style={styles.text}>{item.text ?? ''}</Text>
          </ScrollView>
        );
      case 'html':
      case 'markdown':
        return renderDocument();
      case 'eml':
        return renderDocument(
          <View style={styles.emlHeader}>
            <Text style={styles.emlSubject}>{item.eml?.subject || t('email_viewer.no_subject', '(No Subject)')}</Text>
            {item.eml?.from ? <Text style={styles.emlMeta}>{item.eml.from}</Text> : null}
            {item.eml?.date ? <Text style={styles.emlMeta}>{item.eml.date}</Text> : null}
          </View>,
        );
      default:
        return renderFallback(item.notice ?? t('email_viewer.preview.unsupported', 'No preview for this file type.'));
    }
  };

  const content = (
      <SafeAreaView style={styles.container} edges={docked ? ['top', 'right'] : ['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            style={styles.headerBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.close', 'Close')}
          >
            <X size={22} color={c.text} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{item?.name ?? title ?? ''}</Text>
          {item && !showsFallback ? (
            <Pressable
              onPress={onOpenExternal}
              style={styles.headerBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('email_viewer.preview.open_external', 'Open in app')}
            >
              <ExternalLink size={20} color={c.text} />
            </Pressable>
          ) : null}
          {onDownload ? (
            <Pressable
              onPress={onDownload}
              style={styles.headerBtn}
              hitSlop={8}
              disabled={!item}
              accessibilityRole="button"
              accessibilityLabel={t('files.download', 'Download')}
            >
              <Download size={20} color={item ? c.text : c.textMuted} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={onShare}
            style={styles.headerBtn}
            hitSlop={8}
            disabled={!item}
            accessibilityRole="button"
            accessibilityLabel={t('email_viewer.attachment_actions.share', 'Share')}
          >
            <Share2 size={20} color={item ? c.text : c.textMuted} />
          </Pressable>
        </View>
        {renderBody()}
      </SafeAreaView>
  );
  if (docked) return item || loading ? content : null;
  return (
    <Modal supportedOrientations={MODAL_ORIENTATIONS} visible={!!item || loading} animationType="slide" onRequestClose={onClose}>
      {content}
    </Modal>
  );
}

const viewerStyles = StyleSheet.create({ fill: { flex: 1 } });

function makeStyles(c: ThemePalette) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      height: componentSizes.headerHeight,
      paddingHorizontal: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      gap: spacing.sm,
    },
    headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
    title: { ...typography.h3, color: c.text, flex: 1 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
    hint: { ...typography.body, color: c.textMuted, textAlign: 'center' },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: c.primary,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
    },
    buttonText: { ...typography.bodySemibold, color: c.primaryForeground },
    imageScroll: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg, flexGrow: 1 },
    textScroll: { padding: spacing.lg },
    text: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18, color: c.text },
    emlHeader: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border, gap: 2 },
    emlSubject: { ...typography.bodySemibold, color: c.text },
    emlMeta: { ...typography.caption, color: c.textSecondary },
  });
}

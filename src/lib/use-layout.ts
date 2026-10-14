import { useWindowDimensions } from 'react-native';

/**
 * Window size classes for the adaptive layouts (docs/ux-audit-2026-10.md,
 * "Adaptive layout plan"). They come from the window, not the device, so
 * split-screen, freeform windows and foldables get the layout that fits.
 */
export type WidthClass = 'compact' | 'medium' | 'expanded';

export const MEDIUM_MIN_WIDTH = 600;
export const EXPANDED_MIN_WIDTH = 840;
/** Below this a window is "short": a phone in landscape. */
export const SHORT_MAX_HEIGHT = 480;

export interface Layout {
  widthClass: WidthClass;
  /** A phone in landscape: compress chrome, keep the single-pane layout. */
  shortHeight: boolean;
  /** List and detail side by side (medium or expanded, and not short). */
  isSplit: boolean;
  /** A persistent sidebar next to the list (expanded and not short). */
  hasSidebar: boolean;
}

export function layoutFor(width: number, height: number): Layout {
  const widthClass: WidthClass =
    width >= EXPANDED_MIN_WIDTH ? 'expanded' : width >= MEDIUM_MIN_WIDTH ? 'medium' : 'compact';
  const shortHeight = height < SHORT_MAX_HEIGHT;
  const isSplit = widthClass !== 'compact' && !shortHeight;
  return { widthClass, shortHeight, isSplit, hasSidebar: isSplit && widthClass === 'expanded' };
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return layoutFor(width, height);
}

/**
 * Width of the list pane next to a detail pane: a third of the window,
 * between 320 and 420 dp (the webmail's list column is about 400).
 */
export function listPaneWidth(windowWidth: number): number {
  return Math.round(Math.max(320, Math.min(420, windowWidth * 0.34)));
}

/** Width for sheets, dialogs and floating cards that would span a wide window. */
export const SHEET_MAX_WIDTH = 560;

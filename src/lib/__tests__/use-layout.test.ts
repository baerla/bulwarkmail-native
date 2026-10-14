import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({ useWindowDimensions: () => ({ width: 411, height: 914 }) }));

import { layoutFor, listPaneWidth } from '../use-layout';

describe('layoutFor', () => {
  it('keeps a phone in portrait on the single-pane layout', () => {
    expect(layoutFor(411, 914)).toEqual({
      widthClass: 'compact', shortHeight: false, isSplit: false, hasSidebar: false,
    });
  });

  it('keeps a phone in landscape single-pane although it is wide', () => {
    const l = layoutFor(914, 411);
    expect(l.widthClass).toBe('expanded');
    expect(l.shortHeight).toBe(true);
    expect(l.isSplit).toBe(false);
    expect(l.hasSidebar).toBe(false);
  });

  it('splits a tablet in portrait without a sidebar', () => {
    expect(layoutFor(800, 1280)).toEqual({
      widthClass: 'medium', shortHeight: false, isSplit: true, hasSidebar: false,
    });
  });

  it('splits a tablet in landscape and adds the sidebar', () => {
    expect(layoutFor(1280, 800)).toEqual({
      widthClass: 'expanded', shortHeight: false, isSplit: true, hasSidebar: true,
    });
  });

  it('uses the window, so a narrow split-screen window is compact', () => {
    expect(layoutFor(500, 800).isSplit).toBe(false);
  });

  it('puts the breakpoints at 600 and 840', () => {
    expect(layoutFor(599, 900).widthClass).toBe('compact');
    expect(layoutFor(600, 900).widthClass).toBe('medium');
    expect(layoutFor(839, 900).widthClass).toBe('medium');
    expect(layoutFor(840, 900).widthClass).toBe('expanded');
  });
});

describe('listPaneWidth', () => {
  it('stays between 320 and 420 dp', () => {
    expect(listPaneWidth(600)).toBe(320);
    expect(listPaneWidth(1000)).toBe(340);
    expect(listPaneWidth(2000)).toBe(420);
  });
});

import { studioTheme } from 'ag-studio';

// Every value points at a design token in styles/tokens.css, so Studio's widgets, grids and charts
// follow the app: change a token there and the command center follows.
const token = (name: string) => `var(--${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });

export const quartermasterStudioTheme = studioTheme.withParams({
  fontFamily: token('font-sans'),
  fontSize: 14,
  textColor: token('color-text'),
  foregroundColor: token('color-text'),
  subtleTextColor: token('color-muted'),
  backgroundColor: token('color-surface'),
  borderColor: token('color-border'),
  accentColor: token('color-accent'),

  // No frame: the canvas is the page background.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token('color-bg'),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token('color-bg'),
  studioCanvasPadding: 12,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: token('font-sans'),

  // Widgets are cards: surface fill, 1px border, 8px radius.
  studioWidgetBackgroundColor: token('color-surface'),
  studioWidgetBorder: line('color-border'),
  studioWidgetBorderRadius: 8,
  studioWidgetPadding: 10,
  studioWidgetTitleFontFamily: token('font-sans'),
  studioWidgetTitleFontSize: 16,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: token('color-text'),
  studioWidgetSubtitleTextColor: token('color-muted'),
  studioWidgetCaptionTextColor: token('color-muted'),

  gridFontFamily: token('font-sans'),
  gridCellTextColor: token('color-text'),
  gridHeaderBackgroundColor: token('color-surface'),
  gridHeaderTextColor: token('color-muted'),
  gridHeaderFontWeight: 600,
  gridRowHeight: 40,
  gridRowBorder: line('color-border'),
  gridWrapperBorder: false,

  chartFontFamily: token('font-sans'),
  chartTextColor: token('color-text'),
  chartSubtleTextColor: token('color-muted'),
  chartAxisLineColor: token('color-border'),
  chartGridLineColor: token('color-border'),
});

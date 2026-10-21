export const colors = {
  gradient: ['#93A9A5', '#6F8B86', '#44655F', '#6D8883'] as const,
  gradientLocations: [0, 0.35, 0.7, 1] as const,
  dark: '#0B3B3A',
  ink: '#16302E',
  muted: '#5B7570',
  white: '#FFFFFF',
  onGradient: '#FFFFFF',
  onGradientMuted: 'rgba(255,255,255,0.78)',
  glass: 'rgba(255,255,255,0.45)',
  glassStrong: 'rgba(255,255,255,0.62)',
  glassBorder: 'rgba(255,255,255,0.7)',
  tile: '#C9D5D2',
  tileDark: '#B4C3BF',
  barIdle: '#D3D9D8',
  accent: '#F28C28',
  accentSoft: 'rgba(242,140,40,0.18)',
  danger: '#B3261E',
};

export const radius = { sm: 14, md: 20, lg: 28, pill: 999 };

export const shadow = {
  shadowColor: '#0B2523',
  shadowOpacity: 0.12,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
} as const;

export const NAV_HEIGHT = 76;

/**
 * Absolute "end" offset resolved from the app's own direction. RN's `end` inset follows the
 * platform RTL flag, which the app does not toggle (direction is set on the root view instead).
 */
export const endInset = (isRTL: boolean, value: number) => (isRTL ? { left: value } : { right: value });

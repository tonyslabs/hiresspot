import React from 'react';

const Svg: React.FC<{ d: string; size?: number; fill?: boolean; label?: string }> = ({ d, size = 20, fill = true, label }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill ? 'currentColor' : 'none'}
    stroke={fill ? 'none' : 'currentColor'}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={label ? undefined : true}
    aria-label={label}
    role={label ? 'img' : undefined}
  >
    <path d={d} />
  </svg>
);

type P = { size?: number };
export const IconPlay = (p: P) => <Svg {...p} d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />;
export const IconPause = (p: P) => <Svg {...p} d="M7 4h3v16H7zM14 4h3v16h-3z" />;
export const IconPrev = (p: P) => <Svg {...p} d="M6 5h2v14H6zM20 5.5v13a.5.5 0 0 1-.8.4L10 12.4a.5.5 0 0 1 0-.8l9.2-6.5a.5.5 0 0 1 .8.4z" />;
export const IconNext = (p: P) => <Svg {...p} d="M16 5h2v14h-2zM4 5.5v13a.5.5 0 0 0 .8.4l9.2-6.5a.5.5 0 0 0 0-.8L4.8 5.1a.5.5 0 0 0-.8.4z" />;
export const IconShuffle = (p: P) => <Svg {...p} fill={false} d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />;
export const IconRepeat = (p: P) => <Svg {...p} fill={false} d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />;
export const IconVolume = (p: P) => <Svg {...p} fill={false} d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />;
export const IconMute = (p: P) => <Svg {...p} fill={false} d="M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6" />;
export const IconHeart = (p: P) => <Svg {...p} fill={false} d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />;
export const IconHeartFill = (p: P) => <Svg {...p} d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />;
export const IconQueue = (p: P) => <Svg {...p} fill={false} d="M3 6h13M3 12h13M3 18h9M18 14v7l4-3.5z" />;
export const IconChevronDown = (p: P) => <Svg {...p} fill={false} d="m6 9 6 6 6-6" />;
export const IconBack = (p: P) => <Svg {...p} fill={false} d="m15 18-6-6 6-6" />;
export const IconSun = (p: P) => <Svg {...p} fill={false} d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />;
export const IconMoon = (p: P) => <Svg {...p} fill={false} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />;
export const IconClose = (p: P) => <Svg {...p} fill={false} d="M18 6 6 18M6 6l12 12" />;
export const IconHome = (p: P) => <Svg {...p} fill={false} d="M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10" />;
export const IconSearch = (p: P) => <Svg {...p} fill={false} d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3" />;
export const IconFolder = (p: P) => <Svg {...p} fill={false} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />;
export const IconServer = (p: P) => <Svg {...p} fill={false} d="M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01" />;
export const IconWaves = (p: P) => <Svg {...p} fill={false} d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />;
export const IconCompare = (p: P) => <Svg {...p} fill={false} d="M9 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 6a6 6 0 1 1 0 12 6 6 0 0 1 0-12z" />;
export const IconSettings = (p: P) => <Svg {...p} fill={false} d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4" />;
export const IconForward = (p: P) => <Svg {...p} fill={false} d="m9 18 6-6-6-6" />;
export const IconLyrics = (p: P) => <Svg {...p} fill={false} d="M4 6h16M4 12h10M4 18h13" />;

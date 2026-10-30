/*
 * icons.ts —— 线性图标（24×24，stroke 风格）。
 * 与设计稿同源；只保留网页端实际用到的图标，避免打包无关路径。
 */

const ICONS: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  plusCircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  minus: '<path d="M5 12h14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.6" cy="6" r="1"/><circle cx="3.6" cy="12" r="1"/><circle cx="3.6" cy="18" r="1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.2"/><path d="M16 3v4M8 3v4M3 10.5h18"/><path d="m9 15.5 2 2 4-4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  sliders: '<path d="M4 7h9M18 7h2M4 12h3M12 12h8M4 17h11M20 17h0"/><circle cx="15.5" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17.5" cy="17" r="2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.08A1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.08A1.7 1.7 0 0 0 20.95 10H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flame: '<path d="M12 22c4 0 7-2.8 7-6.5 0-3-1.8-5.2-3.5-7C14.3 7.2 13 5.2 13 3c-2.4 1.2-4 3.4-4 5.5 0 1.2.4 2.2 1 3-1.6-.4-2.8-1.5-3.5-3C5.5 10 5 11.7 5 13.5 5 19.2 8 22 12 22z"/>',
  dumbbell: '<path d="M6.5 6.5 17.5 17.5M4 9l-1 1M9 4l-1 1M16 20l-1-1M20 15l-1-1"/><rect x="8" y="8" width="8" height="8" rx="2" transform="rotate(45 12 12)"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-13.7-5.7L3 8M3 3v5h5M4 13a8 8 0 0 0 13.7 5.7L21 16M21 21v-5h-5"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4 2v-8L4 5z"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 9v5M12 17h.01"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a2.5 2.5 0 1 1-2.5 2.5M3 16h8a2 2 0 1 1-2 2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};

export type IconName = keyof typeof ICONS;

export function icon(name: string, cls = ''): string {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}

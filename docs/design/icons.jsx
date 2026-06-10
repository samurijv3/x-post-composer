// icons.jsx — minimal line-icon set (stroke currentColor). UI glyphs only.
const Svg = ({ children, w = 24, ...p }) => (
  <svg viewBox={`0 0 24 24`} fill="none" stroke="currentColor" strokeWidth="1.7"
       strokeLinecap="round" strokeLinejoin="round" {...p}>{children}</svg>
);

const IcPost   = (p) => <Svg {...p}><path d="M12 5v14M5 12h14"/></Svg>;
const IcReply  = (p) => <Svg {...p}><path d="M9 14 4 9l5-5"/><path d="M4 9h9a7 7 0 0 1 7 7v3"/></Svg>;
const IcCompose= (p) => <Svg {...p}><path d="M4 20h16"/><path d="M14.5 4.5 19 9 8 20l-4.5.9L4.5 16z"/></Svg>;
const IcVoice  = (p) => <Svg {...p}><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></Svg>;
const IcSettings=(p) => <Svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></Svg>;
const IcCopy   = (p) => <Svg {...p}><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></Svg>;
const IcCheck  = (p) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7"/></Svg>;
const IcRefresh= (p) => <Svg {...p}><path d="M3.5 12a8.5 8.5 0 0 1 14.5-6M20.5 12A8.5 8.5 0 0 1 6 18"/><path d="M18 2.5V6h-3.5M6 21.5V18h3.5"/></Svg>;
const IcUndo   = (p) => <Svg {...p}><path d="M4 9h11a5 5 0 0 1 0 10H9"/><path d="M4 9l4-4M4 9l4 4"/></Svg>;
const IcChevR  = (p) => <Svg {...p}><path d="m9 6 6 6-6 6"/></Svg>;
const IcChevL  = (p) => <Svg {...p}><path d="m15 6-6 6 6 6"/></Svg>;
const IcChevDown=(p) => <Svg {...p}><path d="m6 9 6 6 6-6"/></Svg>;
const IcPlus   = (p) => <Svg {...p}><path d="M12 5v14M5 12h14"/></Svg>;
const IcMore   = (p) => <Svg {...p}><path d="M5 12h7"/><path d="m9 8 4 4-4 4"/></Svg>;
const IcLess   = (p) => <Svg {...p}><path d="M19 12h-7"/><path d="m15 8-4 4 4 4"/></Svg>;
const IcKey    = (p) => <Svg {...p}><circle cx="8" cy="8" r="4.5"/><path d="m11.2 11.2 8 8M16 16l2.5-2.5M18.5 18.5 21 16"/></Svg>;
const IcShield = (p) => <Svg {...p}><path d="M12 3 5 5.5V11c0 4.5 3 7.6 7 9 4-1.4 7-4.5 7-9V5.5z"/></Svg>;
const IcSliders= (p) => <Svg {...p}><path d="M5 21V13M5 9V3M12 21v-9M12 8V3M19 21v-5M19 12V3M2.5 13h5M9.5 8h5M16.5 16h5"/></Svg>;
const IcPrompt = (p) => <Svg {...p}><path d="m4 7 4 4-4 4M11 17h8"/><rect x="2.5" y="3" width="19" height="18" rx="3" opacity="0"/></Svg>;
const IcData   = (p) => <Svg {...p}><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></Svg>;
const IcWarn   = (p) => <Svg {...p}><path d="M12 9v4.5M12 17h.01"/><path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></Svg>;
const IcInfo   = (p) => <Svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></Svg>;
const IcSun    = (p) => <Svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4"/></Svg>;
const IcMoon   = (p) => <Svg {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z"/></Svg>;
const IcEdit   = (p) => <Svg {...p}><path d="M14.5 4.5 19 9 8 20l-4.5.9L4.5 16z"/></Svg>;
const IcTrash  = (p) => <Svg {...p}><path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/></Svg>;
const IcX      = (p) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18"/></Svg>;
const IcCapture= (p) => <Svg {...p}><path d="M6 7V4.5a1.5 1.5 0 0 1 1.5-1.5H10M14 3h2.5A1.5 1.5 0 0 1 18 4.5V7M18 17v2.5a1.5 1.5 0 0 1-1.5 1.5H14M10 21H7.5A1.5 1.5 0 0 1 6 19.5V17"/><circle cx="12" cy="12" r="2.5"/></Svg>;
const IcExport = (p) => <Svg {...p}><path d="M12 15V3M12 3 8 7M12 3l4 4"/><path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></Svg>;
const IcSearch = (p) => <Svg {...p}><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></Svg>;
const IcSparkle= (p) => <Svg {...p}><path d="M12 3.5 13.6 9 19 10.6 13.6 12.2 12 17.7 10.4 12.2 5 10.6 10.4 9z"/><path d="M18 4v3M19.5 5.5h-3" opacity="0.7"/></Svg>;

Object.assign(window, {
  IcPost, IcReply, IcCompose, IcVoice, IcSettings, IcCopy, IcCheck, IcRefresh, IcUndo,
  IcChevR, IcChevL, IcChevDown, IcPlus, IcMore, IcLess, IcKey, IcShield, IcSliders,
  IcPrompt, IcData, IcWarn, IcInfo, IcSun, IcMoon, IcEdit, IcTrash, IcX, IcCapture,
  IcExport, IcSearch, IcSparkle,
});

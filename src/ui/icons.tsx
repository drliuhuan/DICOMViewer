/**
 * 内联 SVG 图标组件库（M11 任务 4）。
 *
 * 设计取舍：
 * - 不引入第三方图标依赖（体积可控，NFR 体积约束），全部手绘 24×24 viewBox、
 *   stroke=currentColor 的轻量路径；
 * - 图标默认 16px，可用 size 覆盖；aria-hidden（语义由按钮的
 *   title/aria-label 承担）；
 * - 配合 CSS：`.tool-button` 变为 inline-flex 图标按钮；所有尺寸均隐藏
 *   `.tool-button-label` 仅显示图标（M11-F1），文案由 title/aria-label 承担。
 */
import type { ReactNode } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
}

function Svg({
  children,
  size = 16,
  className,
}: IconProps & { children: ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* ── 文件 / 文件夹 ─────────────────────────────── */
export function IconFile(size?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(size)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </Svg>
  );
}

export function IconFolderOpen(p?: number | IconProps): JSX.Element {
  const v = norm(p);
  return (
    <Svg {...v}>
      <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v2" />
      <path d="M3 7h16l2 9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  );
}

/* ── 布局 ──────────────────────────────────────── */
export function IconLayout1(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
    </Svg>
  );
}

export function IconLayout2(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M12 4v16" />
    </Svg>
  );
}

export function IconLayout4(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M12 4v16M3 12h18" />
    </Svg>
  );
}

/* ── 视图工具 ──────────────────────────────────── */
export function IconWindowLevel(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconZoom(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

export function IconZoomIn(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M8 11h6M11 8v6" />
    </Svg>
  );
}

export function IconZoomOut(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M8 11h6" />
    </Svg>
  );
}

export function IconPan(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M12 3v18M3 12h18" />
      <path d="m12 3-2 2m2-2 2 2M12 21l-2-2m2 2 2-2M3 12l2-2m-2 2 2 2M21 12l-2-2m2 2-2 2" />
    </Svg>
  );
}

export function IconStackScroll(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M12 3 3 8l9 5 9-5z" />
      <path d="m3 13 9 5 9-5" opacity={0.55} />
    </Svg>
  );
}

export function IconInvert(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" transform="rotate(90 12 12)" />
    </Svg>
  );
}

export function IconFit(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M4 9V6a2 2 0 0 1 2-2h3M20 9V6a2 2 0 0 0-2-2h-3M4 15v3a2 2 0 0 0 2 2h3M20 15v3a2 2 0 0 1-2 2h-3" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" />
    </Svg>
  );
}

export function IconOneToOne(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 16V8l-2 1.5M12 16V8M16 8h2v8h-2z" strokeWidth={1.6} />
    </Svg>
  );
}

export function IconRotateCcw(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M3 8a9 9 0 1 1-1 6" />
      <path d="M3 3v5h5" />
    </Svg>
  );
}

export function IconRotateCw(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M21 8a9 9 0 1 0 1 6" />
      <path d="M21 3v5h-5" />
    </Svg>
  );
}

export function IconReset(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4h-4" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconSliders(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </Svg>
  );
}

export function IconChevronLeft(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="m14 6-6 6 6 6" />
    </Svg>
  );
}

export function IconChevronRight(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="m10 6 6 6-6 6" />
    </Svg>
  );
}

export function IconChevronDown(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="m6 10 6 6 6-6" />
    </Svg>
  );
}

export function IconChevronUp(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="m6 14 6-6 6 6" />
    </Svg>
  );
}

/* ── 测量 ──────────────────────────────────────── */
export function IconRuler(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="m3 17 14-14 4 4L7 21z" />
      <path d="m8 12 2 2m2-6 2 2m-2 2 2 2" strokeWidth={1.6} />
    </Svg>
  );
}

export function IconAngle(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M19 19H5L15 5" />
      <path d="M13.5 19a9.5 9.5 0 0 0-2.2-6.1" strokeWidth={1.5} />
    </Svg>
  );
}

export function IconCobb(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M4 18 12 4M10 18l10-6" />
      <path d="M9 18a9 9 0 0 0 4.5-2" strokeWidth={1.5} />
    </Svg>
  );
}

export function IconRectRoi(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <rect x="4" y="6" width="16" height="12" rx="1" strokeDasharray="3 2.5" />
    </Svg>
  );
}

export function IconEllipseRoi(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <ellipse cx="12" cy="12" rx="9" ry="6" strokeDasharray="3 2.5" />
    </Svg>
  );
}

export function IconProbe(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M12 3v8m0 0-4 10m4-10 4 10" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconCalibrate(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M6 20V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12" />
      <path d="M10 10h4M10 14h4M6 20h12" strokeWidth={1.6} />
    </Svg>
  );
}

/* ── Cine ──────────────────────────────────────── */
export function IconPlay(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconPause(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <rect x="6.5" y="5" width="4" height="14" rx="0.8" fill="currentColor" stroke="none" />
      <rect x="13.5" y="5" width="4" height="14" rx="0.8" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconStop(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/* ── 入口与功能 ────────────────────────────────── */
export function IconMpr(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12 4 7.5M12 12v9" />
    </Svg>
  );
}

export function IconVolume3d(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12 4 7.5M12 12v9" />
      <path d="M12 21l8-4.5-8-4.5z" fill="currentColor" stroke="none" opacity={0.35} />
    </Svg>
  );
}

/** M11-F3：MPR 定位线（十字交点） */
export function IconCrosshair(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
    </Svg>
  );
}

export function IconInfo(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" strokeWidth={1.8} />
      <circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconAnnotation(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M4 6h10M4 12h7M4 18h10" />
      <path d="m16 15 2 2 4-4" />
    </Svg>
  );
}

export function IconHelp(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5A2.6 2.6 0 0 1 12 7.6c1.4 0 2.5 1 2.5 2.3 0 1.6-2.5 2-2.5 3.6" strokeWidth={1.7} />
      <circle cx="12" cy="16.6" r="0.7" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconSettings(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
    </Svg>
  );
}

export function IconPacs(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 8.6 4 4 0 0 1 17.5 18z" />
      <path d="M12 21v-6m0 0-2 2m2-2 2 2" strokeWidth={1.7} />
    </Svg>
  );
}

export function IconMenu(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Svg>
  );
}

export function IconTrash(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13" />
      <path d="M10 11v6M14 11v6" strokeWidth={1.6} />
    </Svg>
  );
}

export function IconClose(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconCheck(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="m5 13 4 4L19 7" />
    </Svg>
  );
}

export function IconPlus(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconMinus(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function IconStar(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />
    </Svg>
  );
}

export function IconSave(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M8 3v5h7V3M7 21v-7h10v7" />
    </Svg>
  );
}

export function IconBolt(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
    </Svg>
  );
}

export function IconMagnifier(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
    </Svg>
  );
}

export function IconCloudDown(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M6.5 17a4 4 0 0 1-.5-8A6 6 0 0 1 17.6 8 4.2 4.2 0 0 1 18 17" />
      <path d="M12 12v9m0-9-3 3m3-3 3 3" />
    </Svg>
  );
}

export function IconFileDown(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M12 10v7m0 0-3-3m3 3 3-3" />
    </Svg>
  );
}

export function IconFileUp(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M12 17v-7m0 0-3 3m3-3 3 3" />
    </Svg>
  );
}

export function IconFileSr(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 12h4a1.5 1.5 0 0 1 0 3H9v3m4-3c2 0 2 3 4 3" strokeWidth={1.5} />
    </Svg>
  );
}

export function IconEye(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </Svg>
  );
}

export function IconEyeOff(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M10 6.6A9.8 9.8 0 0 1 12 6.5c6.5 0 10 5.5 10 5.5a17.5 17.5 0 0 1-2.8 3.5M6.6 7.2A17.4 17.4 0 0 0 2 12s3.5 6.5 10 6.5a10 10 0 0 0 4-.8" />
      <path d="M4 4l16 16" />
    </Svg>
  );
}

export function IconTarget(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" strokeWidth={1.7} />
    </Svg>
  );
}

export function IconCamera(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M4 8h3l1.6-2.5h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.4" />
    </Svg>
  );
}

export function IconExit(p?: number | IconProps): JSX.Element {
  return (
    <Svg {...norm(p)}>
      <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
      <path d="M11 8l4 4-4 4M15 12H3" />
    </Svg>
  );
}

/** 参数归一：允许 `size?: number | IconProps` 快捷用法 */
function norm(input?: number | IconProps): IconProps & { children?: ReactNode } {
  if (typeof input === 'number') {
    return { size: input };
  }
  return input ?? {};
}

/**
 * 2D 视口 MPR 参考线叠加层（FR-6.10，M10-E）。
 *
 * 切回 2D 后显示 MPR 三平面与当前切片的交线。segments 为切片像素坐标内的
 * 线段（computeReferenceLineSegments 输出）；本组件负责把像素坐标线段经过
 * 世界坐标投影（viewport.worldToCanvas）转成画布坐标，再用 CSS 绘制。
 *
 * 纯展示组件：toWorld / project 由宿主注入（依赖 viewport 当前相机），
 * 平移/缩放/旋转相机后端点在宿主重投影回调中更新，本组件无需感知。
 */
import type { MprPlaneKey, Point2, Point3 } from './referenceLines';
import { referenceLineColor } from './referenceLines';

export interface OverlaySegment {
  plane: MprPlaneKey;
  p1: Point2;
  p2: Point2;
}

interface ReferenceLinesOverlayProps {
  /** 当前切片上要绘制的线段（切片像素坐标） */
  segments: OverlaySegment[];
  /** 切片像素坐标 p → 世界坐标（用当前 imageData 的 origin/spacing/direction） */
  toWorld: (p: Point2) => Point3;
  /** 世界坐标 → 画布坐标（viewport.worldToCanvas），返回 undefined 表示投影失败 */
  project: (world: Point3) => { x: number; y: number } | undefined;
}

function LineDiv({
  a,
  b,
  color,
}: {
  a: { x: number; y: number };
  b: { x: number; y: number };
  color: string;
}) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.5) {
    // 退化线段：不渲染
    return null;
  }
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const left = (a.x + b.x) / 2;
  const top = (a.y + b.y) / 2;
  return (
    <div
      className="reference-line"
      style={{
        left,
        top,
        width: length,
        transform: `translate(-50%, -50%) rotate(${angle}deg)`,
        background: color,
        boxShadow: `0 0 0 1px rgba(0,0,0,0.6)`,
      }}
    />
  );
}

export function ReferenceLinesOverlay({
  segments,
  toWorld,
  project,
}: ReferenceLinesOverlayProps) {
  return (
    <div className="reference-lines-overlay" aria-hidden="true">
      {segments.map((segment, index) => {
        const a = project(toWorld(segment.p1));
        const b = project(toWorld(segment.p2));
        if (a === undefined || b === undefined) {
          return null;
        }
        return (
          <LineDiv key={`${segment.plane}-${index}`} a={a} b={b} color={referenceLineColor(segment.plane)} />
        );
      })}
    </div>
  );
}

export default ReferenceLinesOverlay;
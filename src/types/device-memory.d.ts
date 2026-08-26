/**
 * navigator.deviceMemory 类型补充（FR-14.4，M9）。
 *
 * deviceMemory 为 Chromium 专属 API（GB，向下取整到 0.25/0.5/1/2/4/8/16），
 * iOS Safari/Firefox 不提供（读取为 undefined）；lib.dom（TS 5.9）未收录，
 * 此处按 MDN 签名补齐为可选属性。
 */
interface Navigator {
  /** 设备内存（GB）；不支持的浏览器为 undefined */
  deviceMemory?: number;
}

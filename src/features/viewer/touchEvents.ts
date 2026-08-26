/**
 * 触控事件名（M9，FR-14.1）。
 *
 * 与 @cornerstonejs/tools 的 Enums.Events 常量保持一致（库内
 * Events["TOUCH_TAP"] = "CORNERSTONE_TOOLS_TAP"）；独立成模块的原因：
 * 既有单测以 vi.mock 整体替换 toolSetup，vi 对 mock 缺失的 named export
 * 直接抛错，故事件名不挂在 toolSetup 上；
 * m9.touchGestures.test.ts 用真实库断言本常量与库枚举相等（防漂移）。
 */
export const TOUCH_TAP_EVENT = 'CORNERSTONE_TOOLS_TAP';

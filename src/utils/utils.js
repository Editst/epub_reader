/**
 * src/utils/utils.js
 * 共享工具函数 — 跨页面通用的纯函数集合
 *
 * v1.7.0: 从 home.js / popup.js / reader.js 提取，消除三处重复定义。
 * 依赖：无（纯函数，不依赖任何 DOM 或扩展 API）
 */
const Utils = {

  /**
   * HTML 实体转义，防止将用户内容插入 innerHTML 时产生 XSS。
   * 实现使用 DOM textContent 赋值再读取 innerHTML，由浏览器完成转义。
   *
   * @param {*} text
   * @returns {string}
   */
  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  },

  /**
   * 将 Unix 时间戳格式化为相对时间字符串（中文）。
   * 7 天内显示相对时间，否则显示本地日期。
   *
   * @param {number} timestamp  - Unix ms 时间戳
   * @param {string} [fallback] - 时间戳为空时的返回值，默认 '未知时间'
   * @returns {string}
   */
  formatDate(timestamp, fallback = '未知时间') {
    if (!timestamp) return fallback;
    const diff = Date.now() - timestamp;
    if (diff < 60_000)       return '刚刚';
    if (diff < 3_600_000)    return Math.floor(diff / 60_000)    + ' 分钟前';
    if (diff < 86_400_000)   return Math.floor(diff / 3_600_000) + ' 小时前';
    if (diff < 604_800_000)  return Math.floor(diff / 86_400_000) + ' 天前';
    return new Date(timestamp).toLocaleDateString('zh-CN');
  },

  /**
   * 将秒数格式化为可读时长字符串（中文）。
   * 不足 1 分钟显示秒，不足 1 小时显示分钟，否则显示小时+分钟。
   *
   * @param {number} seconds
   * @returns {string}
   */
  formatDuration(seconds) {
    if (seconds === undefined || seconds === null || isNaN(seconds)) return '0秒';
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60)   return `${s}秒`;
    const mins = Math.floor(s / 60);
    if (mins < 60) return `${mins}分钟`;
    const hrs = Math.floor(mins / 60);
    const m   = mins % 60;
    return m > 0 ? `${hrs}小时${m}分` : `${hrs}小时`;
  },

  /**
   * 将分钟数格式化为可读时长字符串（中文）。
   * 供 ETA 估算使用。
   *
   * @param {number} minutes
   * @returns {string}
   */
  formatMinutes(minutes) {
    if (!minutes || minutes <= 0) return '0分钟';
    const m = Math.round(minutes);
    if (m < 60) return `${m}分钟`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}小时${rem}分钟` : `${h}小时`;
  }
};

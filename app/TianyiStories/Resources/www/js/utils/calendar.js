/**
 * 简单日历工具：日期推进、农历显示等
 */
const Calendar = {
    DAY_MS: 24 * 60 * 60 * 1000,

    dayString(ts = Date.now()) {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    timeString(ts = Date.now()) {
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },

    daysBetween(a, b) {
        return Math.floor((b - a) / this.DAY_MS);
    },

    formatRelative(ts) {
        const diff = Date.now() - ts;
        if (diff < 60_000) return '刚刚';
        if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
        if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
        return `${Math.floor(diff / 86_400_000)} 天前`;
    }
};

window.Calendar = Calendar;

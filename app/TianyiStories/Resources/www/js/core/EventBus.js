/**
 * 全局事件总线
 * 用于各系统间解耦通信
 */
class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        const set = this.listeners.get(event);
        if (set) set.delete(callback);
    }

    emit(event, ...args) {
        const set = this.listeners.get(event);
        if (!set) return;
        for (const cb of set) {
            try { cb(...args); } catch (e) { console.error('EventBus handler error:', e); }
        }
    }

    once(event, callback) {
        const wrapped = (...args) => {
            this.off(event, wrapped);
            callback(...args);
        };
        return this.on(event, wrapped);
    }

    clear(event) {
        if (event) this.listeners.delete(event);
        else this.listeners.clear();
    }
}

window.EventBus = EventBus;
window.globalEventBus = new EventBus();

/**
 * 事件系统：剧情事件触发 / 完成记录
 */
class EventSystem {
    constructor() {
        this.events = new Map();
        this.completed = new Set();
        this.callbacks = { onEventComplete: [] };
    }

    init() {}

    register(id, definition) {
        this.events.set(id, { id, triggered: false, ...definition });
    }

    on(event, cb) { if (this.callbacks[event]) this.callbacks[event].push(cb); }

    triggerEvent(id, force = false) {
        const evt = this.events.get(id);
        if (!evt) {
            // 即使未注册也允许外部监听
            if (force) this.callbacks.onEventComplete.forEach(cb => cb({ id }));
            return;
        }
        if (!force && this.completed.has(id)) return;
        evt.triggered = true;
        this.completed.add(id);
        console.log(`[EventSystem] 触发事件: ${id}`);
        this.callbacks.onEventComplete.forEach(cb => cb({ id, ...evt }));
    }

    isEventCompleted(id) { return this.completed.has(id); }

    loadData(d) {
        if (d?.completed) this.completed = new Set(d.completed);
    }
    getSaveData() { return { completed: [...this.completed] }; }
}

window.EventSystem = EventSystem;

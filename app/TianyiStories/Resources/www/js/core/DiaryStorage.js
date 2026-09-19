/**
 * 日记存储：本地按槽位保存
 */
class DiaryStorage {
    constructor() {
        this.slotId = 1;
    }

    setSlot(slotId) { this.slotId = slotId; }
    _key() { return `tianyi_diary_slot_${this.slotId}`; }

    async addEntry(entry) {
        const list = await this.listAll();
        const newEntry = {
            id: 'diary_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            ts: Date.now(),
            ...entry
        };
        list.unshift(newEntry);
        try { localStorage.setItem(this._key(), JSON.stringify(list.slice(0, 200))); } catch (_) {}
        return newEntry;
    }

    async listAll() {
        try {
            const raw = localStorage.getItem(this._key());
            return raw ? JSON.parse(raw) : [];
        } catch (_) { return []; }
    }

    async clearAll() {
        localStorage.removeItem(this._key());
        return { success: true };
    }

    async deleteEntry(id) {
        const list = await this.listAll();
        const filtered = list.filter(e => e.id !== id);
        localStorage.setItem(this._key(), JSON.stringify(filtered));
        return { success: true };
    }
}

window.DiaryStorage = DiaryStorage;
window.diaryStorage = new DiaryStorage();

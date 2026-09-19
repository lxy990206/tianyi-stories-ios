/**
 * 人设（提示词）存储：按槽位保存
 * 默认为 tianyi-base.json，可在游戏中通过提示词调整界面修改。
 */
class PromptStorage {
    constructor() {
        this.slotId = 1;
        this.cache = null;
    }

    setSlot(slotId) { this.slotId = slotId; this.cache = null; }
    _key() { return `tianyi_prompts_slot_${this.slotId}`; }

    async initializeDefaultPrompts(isNewGame = true) {
        if (!isNewGame) return;
        try {
            const resp = await fetch('js/AI/prompts/tianyi-base.json');
            if (resp.ok) {
                const data = await resp.json();
                this.cache = data;
                localStorage.setItem(this._key(), JSON.stringify(data));
            }
        } catch (_) {}
    }

    async getPrompt(key = 'base') {
        if (!this.cache) {
            try {
                const raw = localStorage.getItem(this._key());
                if (raw) this.cache = JSON.parse(raw);
            } catch (_) {}
        }
        if (!this.cache) {
            try {
                const resp = await fetch('js/AI/prompts/tianyi-base.json');
                if (resp.ok) this.cache = await resp.json();
            } catch (_) {}
        }
        return this.cache;
    }

    async savePrompt(prompt) {
        this.cache = prompt;
        localStorage.setItem(this._key(), JSON.stringify(prompt));
        return { success: true };
    }
}

window.PromptStorage = PromptStorage;
window.promptStorage = new PromptStorage();

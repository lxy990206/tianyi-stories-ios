/**
 * 存档位管理：支持多存档位（最多 3 个）
 */
class SaveSlotManager {
    constructor(maxSlots = 3) {
        this.maxSlots = maxSlots;
        this.activeSlotId = 1;
    }

    setActiveSlot(slotId) {
        this.activeSlotId = slotId;
        return this;
    }

    getActiveSlotId() { return this.activeSlotId; }

    async getSlotMetadata() {
        const result = { maxSlots: this.maxSlots, activeSlotId: this.activeSlotId, slots: {} };
        for (let i = 1; i <= this.maxSlots; i++) {
            const raw = localStorage.getItem(`tianyi_save_slot_${i}`);
            if (raw) {
                try {
                    const data = JSON.parse(raw);
                    const stats = data.characterSystemData?.stats || {};
                    const info = data.playerInfo || {};
                    result.slots[i] = {
                        exists: true,
                        playerName: info.name || '',
                        gender: data.gender || 'brother',
                        day: data.timeSystem?.currentDay || 1,
                        affection: stats.affection ?? 0,
                        trust: stats.trust ?? 50,
                        lastPlayed: data._meta?.savedAt || 0
                    };
                } catch (_) {
                    result.slots[i] = { exists: false };
                }
            } else {
                result.slots[i] = { exists: false };
            }
        }
        return result;
    }

    async deleteSlot(slotId) {
        localStorage.removeItem(`tianyi_save_slot_${slotId}`);
        return { success: true };
    }
}

window.SaveSlotManager = SaveSlotManager;

/**
 * 商店系统：服装 + 礼物
 * 服装与换装系统联动（购买服装 → 解锁换装 → 切换人格）
 * 购买限制：礼物每日限购 3 次（本地时间 0:00 重置）；服装永久限购 1 次
 */
class ShopSystem {
    constructor() {
        this.gifts = [
            { id: 'chocolate', name: '巧克力', price: 50, effects: { affection: 3 }, icon: '🍫' },
            { id: 'book', name: '小说', price: 80, effects: { trust: 3 }, icon: '📖' },
            { id: 'flower', name: '鲜花', price: 100, effects: { affection: 5 }, icon: '💐' },
            { id: 'accessory', name: '小饰品', price: 150, effects: { affection: 5 }, icon: '💎' },
            { id: 'cake', name: '蛋糕', price: 200, effects: { affection: 7 }, icon: '🎂' },
            { id: 'ring', name: '戒指', price: 1500, effects: { affection: 20, trust: 5 }, icon: '💍' }
        ];
        // 服装商品（与 WardrobeSystem 联动）
        this.outfits = [
            { id: 'sailor', name: '水手服', price: 800, icon: '⚓', desc: '元气校园歌姬人格', tag: '元气校园' },
            { id: 'maid', name: '女仆装', price: 1200, icon: '🫖', desc: '温柔家政少女人格', tag: '温柔家政' },
            { id: 'qipao', name: '旗袍', price: 1500, icon: '🏮', desc: '典雅东方淑女人格', tag: '典雅淑女' },
            { id: 'winter', name: '冬日毛衣', price: 600, icon: '🧣', desc: '软糯治愈少女人格', tag: '治愈暖冬' },
            { id: 'sports', name: '运动服', price: 500, icon: '🏃‍♀️', desc: '活力运动少女人格', tag: '活力运动' },
            { id: 'pajamas', name: '睡衣', price: 400, icon: '🌙', desc: '慵懒撒娇少女人格', tag: '慵懒撒娇' },
            { id: 'wedding', name: '婚纱', price: 9999, icon: '💍', desc: '深情温柔新娘人格', tag: '深情新娘' },
            { id: 'stage', name: '舞台装', price: 2000, icon: '🎤', desc: '闪耀偶像歌姬人格', tag: '闪耀偶像' },
            { id: 'school', name: 'JK 校服', price: 700, icon: '📚', desc: '青涩同班同学人格', tag: '青涩同学' }
        ];
        this.purchases = {};      // 服装永久购买记录 { outfitId: true }
        this.dailyGifts = {};     // 礼物每日购买计数 { giftId: count }
        this.dailyDate = null;    // 每日限购基准日期（本地时间）
        this.inventory = {};      // 礼物背包 { giftId: count }（购买入包，聊天中赠送）
        this.DAILY_GIFT_LIMIT = 3;
    }

    init() {}

    /** 本地日期键（0:00 自然切换） */
    _todayKey() {
        const n = new Date();
        return `${n.getFullYear()}-${n.getMonth() + 1}-${n.getDate()}`;
    }

    /** 跨天时重置礼物限购计数（购买/查询前调用） */
    _checkDailyReset() {
        const today = this._todayKey();
        if (this.dailyDate !== today) {
            this.dailyDate = today;
            this.dailyGifts = {};
        }
    }

    /** 礼物今日已购次数（UI 展示用） */
    getDailyGiftCount(itemId) {
        this._checkDailyReset();
        return this.dailyGifts[itemId] || 0;
    }

    purchase(itemId, type = 'gift') {
        const item = this[type === 'gift' ? 'gifts' : 'outfits']?.find(x => x.id === itemId);
        if (!item) return { success: false, message: '未找到商品' };

        // 限购检查必须在扣费之前
        if (type === 'gift') {
            this._checkDailyReset();
            const bought = this.dailyGifts[itemId] || 0;
            if (bought >= this.DAILY_GIFT_LIMIT) {
                return { success: false, message: `每个礼物每天限购 ${this.DAILY_GIFT_LIMIT} 次，明天再来吧` };
            }
        } else if (this.purchases[itemId]) {
            return { success: false, message: '已拥有该服装' };
        }

        const coins = window.gameEngine?.getModule('CoinSystem');
        if (!coins || !coins.spend(item.price)) {
            return { success: false, message: '金币不足' };
        }

        if (type === 'gift') {
            this.dailyGifts[itemId] = (this.dailyGifts[itemId] || 0) + 1;
            this.inventory[itemId] = (this.inventory[itemId] || 0) + 1;  // 入背包，聊天中赠送
            return { success: true, item, remaining: this.DAILY_GIFT_LIMIT - this.dailyGifts[itemId] };
        }

        // 服装：永久限购 1 次
        this.purchases[itemId] = true;
        const ws = window.gameEngine?.getModule('WardrobeSystem');
        if (ws) ws.unlock(itemId);
        return { success: true, item };
    }

    giveGift(giftId) {
        const gift = this.gifts.find(g => g.id === giftId);
        if (!gift) return { success: false };
        const charSys = window.gameEngine?.getModule('CharacterSystem');
        if (charSys) charSys.applyEffects(gift.effects);
        return { success: true, gift, effects: gift.effects };
    }

    /** 背包礼物列表（聊天送礼面板用） */
    getInventory() {
        return this.gifts
            .filter(g => (this.inventory[g.id] || 0) > 0)
            .map(g => ({ ...g, count: this.inventory[g.id] }));
    }

    /** 聊天中消耗背包礼物：成功返回礼物数据并扣减库存 */
    consumeGift(giftId) {
        const count = this.inventory[giftId] || 0;
        if (count <= 0) return { success: false, message: '背包里没有这个礼物' };
        const gift = this.gifts.find(g => g.id === giftId);
        if (!gift) return { success: false };
        this.inventory[giftId] = count - 1;
        if (this.inventory[giftId] === 0) delete this.inventory[giftId];
        return { success: true, gift };
    }

    loadData(d) {
        if (d?.purchases) this.purchases = d.purchases;
        if (d?.dailyGifts) this.dailyGifts = d.dailyGifts;
        if (d?.inventory) this.inventory = d.inventory;
        this.dailyDate = d?.dailyDate || null;
        this._checkDailyReset();
    }
    getSaveData() {
        this._checkDailyReset();
        return { purchases: this.purchases, dailyGifts: this.dailyGifts, dailyDate: this.dailyDate, inventory: this.inventory };
    }
}

window.ShopSystem = ShopSystem;

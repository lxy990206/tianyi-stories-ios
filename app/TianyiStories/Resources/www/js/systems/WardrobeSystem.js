/**
 * 换装系统：10+ 套服装，每套绑定人格
 * 换装时自动切换 PersonaManager 人格（多重人格）
 */
class WardrobeSystem {
    constructor() {
        this.outfits = [
            { id: 'default', name: '默认 · 白色连衣裙', price: 0, unlocked: true, icon: '👗', persona: 'default', tag: '本真歌姬', tint: 'none', image: 'images/characters/default.jpg', background: 'linear-gradient(135deg, #1a3a4a 0%, #0d1f2d 40%, #1a2a3a 100%)' },
            { id: 'sailor', name: '水手服', price: 800, unlocked: false, icon: '⚓', persona: 'sailor', tag: '元气校园', tint: 'none', image: 'images/characters/sailor.jpg', background: 'linear-gradient(135deg, #1a3a5a 0%, #0d1f3d 40%, #1a2a4a 100%)' },
            { id: 'maid', name: '女仆装', price: 1200, unlocked: false, icon: '🫖', persona: 'maid', tag: '温柔家政', tint: 'none', image: 'images/characters/maid.jpg', background: 'linear-gradient(135deg, #3a1a2a 0%, #2d1a1f 40%, #3a2a2a 100%)' },
            { id: 'qipao', name: '旗袍', price: 1500, unlocked: false, icon: '🏮', persona: 'qipao', tag: '典雅淑女', tint: 'none', image: 'images/characters/qipao.jpg', background: 'url(images/characters/qipao.jpg) center/cover no-repeat' },
            { id: 'winter', name: '冬日毛衣', price: 600, unlocked: false, icon: '🧣', persona: 'winter', tag: '治愈暖冬', tint: 'none', image: 'images/characters/winter.jpg', background: 'linear-gradient(135deg, #2a3a4a 0%, #1a2a3a 40%, #2a3a4a 100%)' },
            { id: 'sports', name: '运动服', price: 500, unlocked: false, icon: '🏃‍♀️', persona: 'sports', tag: '活力运动', tint: 'none', image: 'images/characters/sports.jpg', background: 'linear-gradient(135deg, #1a3a2a 0%, #0d1f1a 40%, #1a3a2a 100%)' },
            { id: 'pajamas', name: '睡衣', price: 400, unlocked: false, icon: '🌙', persona: 'pajamas', tag: '慵懒撒娇', tint: 'none', image: 'images/characters/pajamas.jpg', background: 'linear-gradient(135deg, #1a1a3a 0%, #0d0d1f 40%, #1a1a2a 100%)' },
            { id: 'wedding', name: '婚纱', price: 9999, unlocked: false, icon: '💍', persona: 'wedding', tag: '深情新娘', tint: 'none', image: 'images/characters/wedding.jpg', background: 'url(images/characters/wedding.jpg) center/cover no-repeat' },
            { id: 'stage', name: '舞台装', price: 2000, unlocked: false, icon: '🎤', persona: 'stage', tag: '闪耀偶像', tint: 'none', image: 'images/characters/stage.jpg', background: 'url(images/characters/stage.jpg) center/cover no-repeat' },
            { id: 'school', name: 'JK 校服', price: 700, unlocked: false, icon: '📚', persona: 'school', tag: '青涩同学', tint: 'none', image: 'images/characters/school.jpg', background: 'linear-gradient(135deg, #3a2a3a 0%, #2d1a2d 40%, #3a2a3a 100%)' }
        ];
        this.currentOutfit = 'default';
        this.owned = new Set(['default']);
    }

    init(engine) {
        this.engine = engine;
    }

    unlock(id) {
        const o = this.outfits.find(o => o.id === id);
        if (o) o.unlocked = true;
        this.owned.add(id);
    }

    own(id) { return this.owned.has(id); }

    getOutfit(id) { return this.outfits.find(o => o.id === id); }

    getCurrentOutfit() { return this.getOutfit(this.currentOutfit); }

    /** 换装：切换服装 + 自动切换人格 */
    async setOutfit(id) {
        if (!this.owned.has(id)) return false;
        this.currentOutfit = id;
        // 切换人格（多重人格核心）
        const o = this.getOutfit(id);
        if (o && window.personaManager) {
            const ok = await window.personaManager.switchPersona(o.persona || 'default');
            if (!ok) console.warn('[Wardrobe] 人格切换失败，回退默认人格');
        }
        // 刷新主场景立绘与服装徽章
        const mainScene = this.engine?.getModule('MainScene');
        if (mainScene) mainScene.updateCharacterImage();
        // 场景气泡提示人格切换
        if (o && mainScene) {
            const term = window.genderManager?.getTerm?.() || '哥哥';
            mainScene.showBubble(`换上${o.name}啦～今天的我是「${o.tag}」的天依哦。`);
        }
        if (window.saveManager) window.saveManager.scheduleSave();
        return true;
    }

    loadFromSave(data) {
        if (data?.owned) this.owned = new Set(data.owned);
        if (data?.currentOutfit) this.currentOutfit = data.currentOutfit;
        // 同步人格
        const o = this.getOutfit(this.currentOutfit);
        if (o && window.personaManager) {
            window.personaManager.activePersonaId = o.persona || 'default';
            window.personaManager._current = null;
        }
    }
    getSaveData() { return { owned: [...this.owned], currentOutfit: this.currentOutfit }; }
}

window.WardrobeSystem = WardrobeSystem;

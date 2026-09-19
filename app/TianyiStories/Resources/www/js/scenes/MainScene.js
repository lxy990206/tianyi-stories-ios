/**
 * 主场景：管理立绘 + 背景 + 文字气泡
 */
class MainScene {
    constructor() {
        this._charLoaded = true;
    }

    init(engine) {
        this.engine = engine;
    }

    _drawBackground() {
        // 背景由 CSS 控制，角色图铺满场景区域
    }

    updateCharacterImage() {
        // 使用 JPG 立绘，SVG 在 WebView 中可能无法渲染
        const imgEl = document.getElementById('character-image');
        if (!imgEl) return;
        const charSys = this.engine?.getModule('CharacterSystem');
        const aff = charSys?.stats?.affection ?? 0;
        // 服装优先：服装有专属立绘则用服装立绘，否则按好感选择
        const ws = this.engine?.getModule('WardrobeSystem');
        const outfit = ws?.getCurrentOutfit?.();
        let src = 'images/characters/tianyi_main.png';
        if (outfit && outfit.image) {
            src = outfit.image;
        } else if (aff >= 60) {
            src = 'images/characters/tianyi_alt.png';
        }
        if (imgEl.src.indexOf(src) === -1) {
            imgEl.src = src;
        }
        // 换装视觉：按服装应用色调滤镜，让立绘明显区分
        if (outfit && outfit.tint && outfit.tint !== 'none') {
            imgEl.style.filter = 'drop-shadow(0 4px 12px rgba(63,169,214,0.3)) drop-shadow(0 12px 40px rgba(0,0,0,0.6)) ' + outfit.tint;
        } else {
            imgEl.style.filter = '';
        }
        // 更新场景背景：随服装切换
        this._updateBackground(outfit);
        // 更新场景服装/人格徽章
        this._updateOutfitBadge(outfit);
        imgEl.classList.add('bounce');
        setTimeout(() => imgEl.classList.remove('bounce'), 600);
    }

    _updateBackground(outfit) {
        // 角色图本身就是背景，铺满场景区域，不需要额外背景
    }

    _updateOutfitBadge(outfit) {
        const badge = document.getElementById('scene-outfit-badge');
        if (!badge) return;
        if (outfit) {
            badge.innerHTML = `${outfit.icon} ${outfit.name} · ${outfit.tag}人格`;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    showBubble(text) {
        const bubble = document.getElementById('scene-bubble');
        const txt = document.getElementById('scene-bubble-text');
        if (!bubble || !txt) return;
        txt.textContent = text;
        bubble.style.display = 'block';
        clearTimeout(this._bubbleTimer);
        this._bubbleTimer = setTimeout(() => { bubble.style.display = 'none'; }, 4000);
    }

    checkAndShowHourlyGreeting() {
        const hour = new Date().getHours();
        let greet = '嗨';
        if (hour < 11) greet = '早上好';
        else if (hour < 14) greet = '中午好';
        else if (hour < 18) greet = '下午好';
        else greet = '晚上好';
        this.showBubble(`${greet}～`);
    }
}

window.MainScene = MainScene;

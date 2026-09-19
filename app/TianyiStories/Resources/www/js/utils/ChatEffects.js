/**
 * 聊天特效：心心、表情包提示
 */
class ChatEffects {
    static spawnHearts(target) {
        if (window.__deviceTier === 0) return; // 极低配(tier0)装饰特效门控,见 DeviceTier.js
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const root = document.body;
        for (let i = 0; i < 6; i++) {
            const el = document.createElement('span');
            el.className = 'heart-fx';
            el.textContent = '♥';
            el.style.left = (rect.left + rect.width / 2 + (Math.random() - 0.5) * 40) + 'px';
            el.style.top = (rect.top + rect.height / 2) + 'px';
            el.style.animationDelay = (i * 80) + 'ms';
            root.appendChild(el);
            setTimeout(() => el.remove(), 1600);
        }
    }

    static flashScreen(color = 'rgba(244, 182, 194, 0.2)', duration = 300) {
        if (window.__deviceTier === 0) return; // 极低配(tier0)全屏闪光门控
        const flash = document.createElement('div');
        flash.style.cssText = `
            position: fixed; inset: 0;
            background: ${color};
            z-index: 999;
            pointer-events: none;
            animation: fadeOut ${duration}ms ease forwards;
        `;
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), duration);
    }

    static bounce(el) {
        if (!el) return;
        el.classList.add('bounce');
        setTimeout(() => el.classList.remove('bounce'), 600);
    }

    static shake(el) {
        if (!el) return;
        el.classList.add('shake');
        setTimeout(() => el.classList.remove('shake'), 400);
    }
}

window.ChatEffects = ChatEffects;

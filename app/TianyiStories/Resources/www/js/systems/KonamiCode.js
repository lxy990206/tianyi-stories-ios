/**
 * Konami Code 彩蛋
 */
class KonamiCode {
    constructor() {
        this.code = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
        this.pos = 0;
        this._bind();
    }

    _bind() {
        document.addEventListener('keydown', e => {
            const key = e.key;
            if (key === this.code[this.pos]) {
                this.pos++;
                if (this.pos === this.code.length) {
                    this._trigger();
                    this.pos = 0;
                }
            } else {
                this.pos = 0;
            }
        });
    }

    _trigger() {
        console.log('🎉 Konami Code 触发！');
        const coins = window.gameEngine?.getModule('CoinSystem');
        if (coins) coins.add(9999);
        if (window.gameEngine?.getModule('UISystem')) {
            window.gameEngine.getModule('UISystem').showMessage('🎉 Konami Code 触发 +9999 金币', 'success');
        }
    }
}

window.KonamiCode = KonamiCode;

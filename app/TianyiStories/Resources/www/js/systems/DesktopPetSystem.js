/**
 * 桌面宠物系统：浮动显示小图标
 */
class DesktopPetSystem {
    constructor() {
        this.active = false;
    }

    init() {}

    startDesktopMode() {
        this.active = true;
        console.log('[DesktopPet] 桌面模式已开启（Web 端暂不实现浮动窗口）');
    }

    stopDesktopMode() { this.active = false; }
}

window.DesktopPetSystem = DesktopPetSystem;

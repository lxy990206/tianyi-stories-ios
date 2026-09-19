/**
 * 提示词系统入口（保持空壳兼容原项目结构）
 */
class PromptSystem {
    init() {}
    getChatBuilder() { return null; }
    getDiaryBuilder() { return null; }
    getTRPGBuilder() { return null; }
}
window.PromptSystem = PromptSystem;
window.promptSystem = new PromptSystem();

/**
 * 故事系统（同 StorySystem 兼容）
 */
class StorySystemAlias extends (window.StorySystem || class {}) {}
if (!window.StorySystem) {
    class StorySystemEmpty { init() {} }
    window.StorySystem = StorySystemEmpty;
    window.StorySystemAlias = StorySystemEmpty;
}

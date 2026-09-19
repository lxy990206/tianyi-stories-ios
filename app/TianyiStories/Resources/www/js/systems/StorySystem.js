/**
 * 故事系统：AI 驱动剧情 / 自动生成
 */
class StorySystem {
    init() {}
    /** 触发剧情钩子（简化版：在 UI 层弹出） */
    async play(eventId) {
        const lines = {
            openingEvent: [
                '「早上好～」',
                '天依从房间走出来，青色长发还带着刚睡醒的微乱。',
                '「今天的天气，很适合一起出门呢。」'
            ],
            affection30Event: [
                '「最近……和哥哥在一起的时光，真的很开心。」',
                '「我想永远这样下去。」',
                '好感度 +30 事件触发'
            ],
            affection70Event: [
                '「我……我喜欢哥哥。」',
                '「不是家人那种，是另一种喜欢。」',
                '好感度 +70 事件触发'
            ],
            yandereEvent: [
                '「……你不许离开我。」',
                '「永远不许。」',
                '信任度归零，触发病娇事件'
            ],
            diaryLeak: [
                '「你看了我的日记？」',
                '「那是……只是随便写写而已！」',
                '日记泄露事件'
            ]
        };
        const list = lines[eventId] || [`事件 ${eventId} 触发`];
        if (window.gameEngine?.getModule('UISystem')) {
            for (const line of list) {
                window.gameEngine.getModule('UISystem').showModal('剧情', line, null);
                await new Promise(r => setTimeout(r, 1500));
            }
        }
    }
}

window.StorySystem = StorySystem;

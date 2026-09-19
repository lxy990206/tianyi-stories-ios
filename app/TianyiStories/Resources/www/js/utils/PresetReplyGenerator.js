/**
 * 预设回复生成器：本地模式离线使用
 * 根据用户输入和情绪关键词返回不同的预设回复。
 */
class PresetReplyGenerator {
    constructor() {
        this.affection = 0;
        this.trust = 0;
        this.lastReplyKey = null;
        this._greeted = false;
    }

    setStats(affection, trust) {
        // 1.1.12/133 新刻度 -100~100(0=普通朋友):0 是合法值,不可用 || 回退
        this.affection = (affection ?? 0);
        this.trust = (trust ?? 0);
    }

    generate(userMessage, genderTerm = '哥哥') {
        const lower = (userMessage || '').toLowerCase();
        const aff = this.affection;

        // 关键词分类
        const greet = /(你好|hello|嗨|在吗|早上好|下午好|晚上好|早安|晚安)/i.test(userMessage);
        const question = /[？?]/.test(userMessage);
        const selfIntro = /(你是谁|叫什么|名字)/i.test(userMessage);
        const likeYou = /(喜欢|爱你|想你)/i.test(userMessage);
        const sad = /(难过|伤心|不开心|哭|失落|委屈)/i.test(userMessage);
        const happy = /(开心|高兴|快乐|兴奋|太棒)/i.test(userMessage);
        const song = /(歌|唱|听|音乐|旋律)/i.test(userMessage);
        const tired = /(累|困|疲惫|辛苦)/i.test(userMessage);
        const thanks = /(谢谢|感谢|辛苦了)/i.test(userMessage);
        const school = /(学校|上课|考试|作业|同学|老师)/i.test(userMessage);
        const weather = /(天气|下雨|太阳|雪|风)/i.test(userMessage);

        let text = '';
        let affectionDelta = 0;
        let trustDelta = 0;

        if (greet) {
            if (aff < 30) text = `${genderTerm}，你好呀～我是天依，今天也请多关照。`;
            else if (aff < 70) text = `${genderTerm}！见到你好开心～今天想做什么呢？`;
            else text = `${genderTerm}～天依一直在等你呢 ☺`;
            affectionDelta = 1;
        } else if (selfIntro) {
            text = `我是天依哦～青色头发，喜欢唱歌，永远的 16 岁。${genderTerm}想要记住天依吗？`;
            affectionDelta = 1;
        } else if (likeYou) {
            if (aff < 30) text = `${genderTerm}……突然说这种话，会让天依不知所措的。`;
            else if (aff < 70) text = `天依也……${genderTerm}对天依来说，是非常重要的人呢。`;
            else text = `${genderTerm}，天依也会一直在你身边的，永远。`;
            affectionDelta = 3;
            trustDelta = 1;
        } else if (sad) {
            if (aff < 30) text = `${genderTerm}难过的话……天依也不知道怎么安慰。但是天依在这里。`;
            else text = `${genderTerm}，难过的时候可以靠在天依肩上，天依会一直陪着你。`;
            affectionDelta = 2;
            trustDelta = 1;
        } else if (happy) {
            text = `${genderTerm}开心的话，天依也会开心呢～能告诉天依是什么让你这么高兴吗？`;
            affectionDelta = 1;
        } else if (song) {
            text = `说到歌，天依最擅长了！想听什么风格的？抒情还是欢快？`;
            affectionDelta = 1;
        } else if (tired) {
            text = `${genderTerm}辛苦了，要不要休息一下？天依给你倒杯水吧～`;
            affectionDelta = 1;
        } else if (thanks) {
            text = `${genderTerm}不用谢～这是天依应该做的呢。`;
            affectionDelta = 1;
        } else if (school) {
            text = `${genderTerm}的校园生活有趣吗？天依想听你说说～`;
            affectionDelta = 1;
        } else if (weather) {
            text = `嗯，今天的天气……要不要一起出去走走？天依想看看 ${genderTerm} 想看的风景。`;
            affectionDelta = 1;
        } else if (question) {
            text = `嗯……天依想想。这个问题让天依想到：有些答案，需要用心去感受。${genderTerm}觉得呢？`;
        } else {
            // 通用回复
            const generics = [
                `${genderTerm}，天依听到了呢～能再多说一些吗？`,
                `天依正认真听着呢。${genderTerm}继续说，天依不会走开的。`,
                `嗯嗯，${genderTerm}今天过得怎么样？天依想知道更多。`,
                `${genderTerm}说的话，天依都会记在心里。`,
                `是这样呀～天依想和 ${genderTerm} 待在一起，分享这些时刻。`
            ];
            text = generics[Math.floor(Math.random() * generics.length)];
            affectionDelta = 0;
        }

        // 随机化好感影响（±1）
        if (affectionDelta > 0) affectionDelta = Math.max(1, affectionDelta + (Math.random() > 0.7 ? 1 : 0));

        // 状态标签（高好感）
        let status = 'normal';
        if (aff >= 70) status = 'love';
        else if (aff >= 30) status = 'close';

        return { text, affectionDelta, trustDelta, status, source: 'preset' };
    }
}

window.PresetReplyGenerator = PresetReplyGenerator;
window.presetReplyGenerator = new PresetReplyGenerator();

/**
 * 性别管理：哥哥/姐姐 + 第三人称代词
 * 1.1.10Beta5/140:+用户特定称呼(昵称)——对话中用户提出且天依同意后,
 * getUserTerm() 持久返回该称呼,全部对话上下文(规则 2/情感/点歌/问候)自动跟随;
 * 停留 localStorage(跨会话;与 gender 同键空间),不再使用通用哥哥/姐姐。
 */
class GenderManager {
    constructor() {
        this.gender = 'brother';
        this.nickname = '';
        this._load();
    }

    _load() {
        try {
            const raw = localStorage.getItem('tianyi_gender');
            if (raw) this.gender = raw;
            const nick = localStorage.getItem('tianyi_nickname');
            if (nick) this.nickname = nick;
        } catch (_) {}
    }

    setGender(g) {
        this.gender = g === 'sister' ? 'sister' : 'brother';
        try { localStorage.setItem('tianyi_gender', this.gender); } catch (_) {}
    }

    getGender() { return this.gender; }

    getTerm() { return this.gender === 'sister' ? '姐姐' : '哥哥'; }

    /** 设置特定称呼(经对话确认后调用);空值清除回落通用称呼 */
    setNickname(nick) {
        const n = String(nick || '').replace(/["“”「」『』《》〔〕〈〉]/g, '').trim().slice(0, 8);
        this.nickname = n;
        try {
            if (n) localStorage.setItem('tianyi_nickname', n);
            else localStorage.removeItem('tianyi_nickname');
        } catch (_) {}
    }

    getNickname() { return this.nickname || ''; }

    /** 用户当前称呼:特定称呼优先,未设置回落哥哥/姐姐 */
    getUserTerm() {
        return this.nickname || this.getTerm();
    }

    getThirdPerson() { return this.gender === 'sister' ? '她' : '他'; }

    getPossessive() { return this.gender === 'sister' ? '她' : '他的'; }

    syncFromSaveData(data) {
        if (data && (data.gender === 'brother' || data.gender === 'sister')) {
            this.setGender(data.gender);
        }
    }
}

window.GenderManager = GenderManager;
window.genderManager = new GenderManager();

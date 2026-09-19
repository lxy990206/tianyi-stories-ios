/**
 * AI 后端配置
 * 提供商模式：
 *  - LOCAL: 内置本地预设回复（无外部依赖）
 *  - OLLAMA: 原生 Ollama API（/api/chat）
 *  - CLAUDE: Anthropic Claude（/v1/messages）
 *  - CUSTOM: 任意 OpenAI 兼容 API
 */
class AIChatConfig {
    constructor() {
        this.config = {
            mode: 'OLLAMA',
            baseURL: 'https://ollama.com',
            apiKey: '',
            modelName: 'deepseek-v4-flash',
            temperature: 0.7,
            maxTokens: 2048,
            customHeaders: '',
            customBody: ''
        };
        this._load();
        this._bindNative();
    }

    _load() {
        try {
            const raw = localStorage.getItem('tianyi_ai_config');
            if (raw) this.config = { ...this.config, ...JSON.parse(raw) };
        } catch (_) {}
    }

    save() {
        try { localStorage.setItem('tianyi_ai_config', JSON.stringify(this.config)); } catch (_) {}
    }

    getMode() { return this.config.mode; }
    setMode(m) { this.config.mode = m; this.save(); }

    setBaseURL(u) { this.config.baseURL = u; this.save(); }
    getBaseURL() { return this.config.baseURL; }

    setApiKey(k) { this.config.apiKey = k; this.save(); }
    getApiKey() { return this.config.apiKey; }

    setModelName(n) { this.config.modelName = n; this.save(); }
    getModelName() { return this.config.modelName; }

    setCustomHeaders(h) { this.config.customHeaders = h; this.save(); }
    setCustomBody(b) { this.config.customBody = b; this.save(); }

    _base() {
        return (this.config.baseURL || '').replace(/\/+$/, '');
    }

    /** 根据提供商拼接正确的聊天端点 */
    getChatURL() {
        const mode = this.config.mode;
        if (mode === 'OLLAMA') return this._base() + '/api/chat';
        if (mode === 'CLAUDE') return this._base() + '/v1/messages';

        // CUSTOM / OpenAI 兼容：智能去重
        let url = this._base();
        if (/\/chat\/completions\/?$/i.test(url)) return url;
        if (/\/v1\/chat\/completions\/?$/i.test(url)) return url;
        if (url.endsWith('/v1')) return url + '/chat/completions';
        if (url.includes('/v1')) {
            const b = url.replace(/\/v1\/v1/g, '/v1');
            return b.endsWith('/v1') ? b + '/chat/completions' : b + '/v1/chat/completions';
        }
        return url + '/v1/chat/completions';
    }

    /** 各提供商对应的请求头 */
    buildHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const mode = this.config.mode;
        if (mode === 'CLAUDE') {
            if (this.config.apiKey) headers['x-api-key'] = this.config.apiKey;
            headers['anthropic-version'] = '2023-06-01';
            headers['anthropic-beta'] = 'messages-2023-12-15';
        } else if (mode === 'BUILTIN') {
            // 内置 API:密钥优先取原生 SecureStore(XOR 存储,不入前端资产);
            // 未设置时回退表单 apiKey(便于用自有 key 临时测试网关)
            let k = '';
            try {
                k = window.SecureStore ? (window.SecureStore.get('builtin_api_key') || '') : '';
            } catch (_) {}
            if (!k && this.config.apiKey) k = this.config.apiKey;
            if (k) headers['Authorization'] = `Bearer ${k}`;
        } else if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }
        if (this.config.customHeaders) {
            try {
                Object.assign(headers, JSON.parse(this.config.customHeaders));
            } catch (_) {}
        }
        return headers;
    }

    /** 各提供商对应的请求体 */
    buildRequestBody(messages) {
        const mode = this.config.mode;
        let body;
        if (mode === 'OLLAMA') {
            body = {
                model: this.config.modelName,
                messages: messages,
                stream: false,
                options: { temperature: this.config.temperature }
            };
        } else if (mode === 'CLAUDE') {
            const sysMsg = messages.find(m => m.role === 'system');
            const chatMsgs = messages
                .filter(m => m.role !== 'system')
                .map(m => ({ role: m.role, content: m.content }));
            body = { model: this.config.modelName, max_tokens: this.config.maxTokens, messages: chatMsgs };
            if (sysMsg) body.system = sysMsg.content;
        } else {
            body = {
                model: this.config.modelName,
                messages: messages,
                temperature: this.config.temperature,
                max_tokens: this.config.maxTokens,
                stream: false
            };
        }
        if (this.config.customBody) {
            try {
                const custom = JSON.parse(this.config.customBody);
                // 自定义字段直接覆盖/合并到最顶层
                body = { ...body, ...custom };
            } catch (_) {}
        }
        return body;
    }

    /** 从响应中提取文本（按提供商解析） */
    parseResponseText(data) {
        if (!data) return '';
        const mode = this.config.mode;
        if (mode === 'OLLAMA') return data.message?.content || '';
        if (mode === 'CLAUDE') return data.content?.[0]?.text || '';
        return data.choices?.[0]?.message?.content || '';
    }

    /** 同步配置到原生（Android）存储 */
    _bindNative() {
        if (window.AndroidAISettings) {
            try {
                window.AndroidAISettings.saveConfig(JSON.stringify({
                    mode: this.config.mode,
                    baseurl: this.config.baseURL,
                    apiKey: this.config.apiKey,
                    modelname: this.config.modelName
                }));
            } catch (_) {}
        }
    }

    async testConnection() {
        if (this.config.mode === 'LOCAL') return { ok: true, mode: 'LOCAL' };
        if (!this.config.baseURL) return { ok: false, error: '未配置 baseURL' };
        try {
            const headers = this.buildHeaders();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            const chatURL = this.getChatURL();
            const body = this.buildRequestBody([{ role: 'user', content: 'hi' }]);
            const resp = await fetch(chatURL, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
            clearTimeout(timeout);
            if (resp.ok || resp.status === 429) return { ok: true, status: resp.status, url: chatURL };
            const errText = await resp.text().catch(() => '');
            return { ok: false, status: resp.status, error: `HTTP ${resp.status}: ${errText.slice(0, 200)}`, url: chatURL };
        } catch (e) {
            if (e.name === 'AbortError') return { ok: false, error: '连接超时（15秒）' };
            return { ok: false, error: e.message || '网络错误' };
        }
    }
}

window.AIChatConfig = AIChatConfig;
window.aiConfig = new AIChatConfig();

/**
 * Live2D 最小渲染系统(1.1.10Beta5/144 新增)
 * 仅依赖 Cubism Core(live2d/core/live2dcubismcore.js,ES5,Chrome 59 可用)+ WebGL1,
 * 自绘渲染(无官方 Framework 依赖):
 *   - 模型:live2d/model/*.model3.json(XHR 加载,file:// 兼容);内置 Hiyori 占位,
 *     用户可整目录替换为自己的洛天依模型(改 live2d/model/ 下文件与 config)
 *   - AI 表情驱动:AIChatManager 回复后广播 ai:mood → setMood(参数目标渐变)
 *   - 口型:原生 TTS 播放电平(onLevel→EventBus tts:level)驱动 ParamMouthOpenY;
 *     无电平(浏览器)时说话期间用振荡模拟
 *   - 动作:程序化(呼吸/头身摆动/眨眼/视线游移);motion3/physics 留待轮 B
 * 限制:tier≤1(极低配)自动禁用回退静态立绘;蒙版仅支持基本联合遮罩
 */
class Live2DSystem {
    constructor() {
        this._inited = false;
        this._enabled = false;
        this._failed = false;
        this._gl = null;
        this._canvas = null;
        this._model = null;
        this._textures = [];
        this._programs = {};
        this._raf = 0;
        this._t0 = 0;
        this._paramIdx = {};        // 参数名→index
        this._mood = 'normal';
        this._moodTargets = {};     // 参数名→目标值
        this._mouthLevel = 0;
        this._talking = false;
        this._blinkAt = 0;
        this._unsubs = [];
    }

    get available() {
        return (window.__deviceTier === undefined || window.__deviceTier >= 2) && !this._failed;
    }

    /** 开机:按持久化开关或显式调用启动 */
    boot() {
        const on = localStorage.getItem('tianyi_live2d') === '1';
        if (on) this.enable().catch(() => {});
    }

    toggle() {
        if (this._enabled) {
            this.disable();
            localStorage.setItem('tianyi_live2d', '0');
            window.showToast && window.showToast('已切换为静态立绘', 'info');
        } else {
            localStorage.setItem('tianyi_live2d', '1');
            this.enable().then(ok => {
                if (ok) window.showToast && window.showToast('Live2D 已启用 🎭', 'success');
            });
        }
    }

    disable() {
        this._enabled = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
        const layer = document.getElementById('live2d-layer');
        if (layer) layer.style.display = 'none';
        const img = document.getElementById('character-layer');
        if (img) img.style.display = '';
    }

    /** 启用:注入 Core → 初始化 GL → 加载模型;失败回退静态立绘 */
    async enable() {
        if (this._enabled) return true;
        if (this._failed || !this.available) {
            window.showToast && window.showToast('当前设备性能不适合 Live2D,已保留静态立绘', 'info');
            return false;
        }
        try {
            await this._injectCore();
            const layer = document.getElementById('live2d-layer');
            this._canvas = document.getElementById('live2d-canvas');
            if (!layer || !this._canvas) throw new Error('容器缺失');
            if (!this._inited) {
                this._initGl();
                await this._loadModel('live2d/model/Hiyori.model3.json');
                this._bindEvents();
                this._inited = true;
            }
            layer.style.display = 'block';
            const img = document.getElementById('character-layer');
            if (img) img.style.display = 'none';
            this._enabled = true;
            this._resize();
            this._loop();
            return true;
        } catch (e) {
            console.warn('[Live2D] 启用失败,回退静态立绘:', e);
            this._failed = true;
            this.disable();
            window.showToast && window.showToast('Live2D 启动失败,已回退静态立绘', 'error');
            return false;
        }
    }

    _injectCore() {
        if (window.Live2DCubismCore) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'live2d/core/live2dcubismcore.js';
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('Core 脚本加载失败'));
            document.head.appendChild(s);
        });
    }

    /** XHR 读取(file:// 下 fetch JSON 可能静默失败,统一用 XHR) */
    _read(path, type) {
        return new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open('GET', path, true);
            if (type) x.responseType = type;
            x.onload = () => {
                if (x.status === 0 || (x.status >= 200 && x.status < 300)) resolve(x.response);
                else reject(new Error('HTTP ' + x.status + ' ' + path));
            };
            x.onerror = () => reject(new Error('XHR 失败 ' + path));
            x.send();
        });
    }

    _initGl() {
        const gl = this._canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true })
            || this._canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: true });
        if (!gl) throw new Error('WebGL 不可用');
        this._gl = gl;
        const vs = 'attribute vec2 aPos;attribute vec2 aUv;uniform vec2 uScale;uniform vec2 uOffset;'
            + 'varying vec2 vUv;void main(){vec2 p=vec2(aPos.x*uScale.x+uOffset.x,aPos.y*uScale.y+uOffset.y);'
            + 'gl_Position=vec4(p,0.0,1.0);vUv=aUv;}';
        const fs = 'precision mediump float;varying vec2 vUv;uniform sampler2D uTex;uniform float uOpacity;'
            + 'void main(){vec4 c=texture2D(uTex,vUv);c.rgb*=c.a;c*=uOpacity;gl_FragColor=c;}';
        this._programs.mesh = this._buildProgram(gl, vs, fs);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
    }

    _buildProgram(gl, vsSrc, fsSrc) {
        const compile = (type, src) => {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh));
            return sh;
        };
        const prog = gl.createProgram();
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
        return {
            prog,
            aPos: gl.getAttribLocation(prog, 'aPos'),
            aUv: gl.getAttribLocation(prog, 'aUv'),
            uScale: gl.getUniformLocation(prog, 'uScale'),
            uOffset: gl.getUniformLocation(prog, 'uOffset'),
            uTex: gl.getUniformLocation(prog, 'uTex'),
            uOpacity: gl.getUniformLocation(prog, 'uOpacity'),
        };
    }

    async _loadModel(jsonPath) {
        const gl = this._gl;
        const m3 = JSON.parse(await this._read(jsonPath, 'text'));
        const base = jsonPath.replace(/[^/]*$/, '');
        const ref = m3.FileReferences || {};
        const mocBuf = await this._read(base + ref.Moc, 'arraybuffer');
        const Moc = window.Live2DCubismCore.Moc.fromArrayBuffer(mocBuf);
        if (!Moc) throw new Error('Moc 解析失败');
        const model = window.Live2DCubismCore.Model.fromMoc(Moc);
        if (!model) throw new Error('Model 创建失败');
        this._model = model;
        // 参数索引
        const ids = model.parameters.ids;
        const want = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamEyeLOpen', 'ParamEyeROpen',
            'ParamBrowLY', 'ParamBrowRY', 'ParamMouthOpenY', 'ParamMouthForm', 'ParamBodyAngleX',
            'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamBreath'];
        want.forEach(n => { this._paramIdx[n] = ids.indexOf(n); });
        // 纹理
        const texs = ref.Textures || [];
        for (const t of texs) {
            const img = await this._readImage(base + t);
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            this._textures.push(tex);
        }
        // 顶点缓冲(positions/uvs 为全模型单一大数组,记录逐 drawable 偏移)
        const d = model.drawables;
        this._vbs = [];
        this._offsets = [];
        let acc = 0;
        for (let i = 0; i < d.count; i++) {
            this._offsets.push(acc);
            acc += d.vertexUvCounts[i] * 2;
            const vb = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vb);
            gl.bufferData(gl.ARRAY_BUFFER, d.vertexUvs.subarray(this._offsets[i], this._offsets[i] + d.vertexUvCounts[i] * 2), gl.STATIC_DRAW);
            this._vbs.push({ pos: gl.createBuffer(), uv: vb, ib: gl.createBuffer() });
        }
        this._uploadPositions();
        // 首帧布局基准(模型逻辑坐标包围盒 → 屏幕适配)
        let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        const pos = d.vertexPositions;
        for (let i = 0; i < pos.length; i += 2) {
            if (pos[i] < minX) minX = pos[i];
            if (pos[i] > maxX) maxX = pos[i];
            if (pos[i + 1] < minY) minY = pos[i + 1];
            if (pos[i + 1] > maxY) maxY = pos[i + 1];
        }
        this._bounds = { minX, maxX, minY, maxY };
    }

    _readImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('贴图加载失败 ' + src));
            img.src = src;
        });
    }

    _uploadPositions() {
        const gl = this._gl;
        const d = this._model.drawables;
        for (let i = 0; i < d.count; i++) {
            const n = d.vertexUvCounts[i] * 2;
            gl.bindBuffer(gl.ARRAY_BUFFER, this._vbs[i].pos);
            gl.bufferData(gl.ARRAY_BUFFER, d.vertexPositions.subarray(this._offsets[i], this._offsets[i] + n), gl.DYNAMIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._vbs[i].ib);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, d.indices[i], gl.STATIC_DRAW);
        }
    }

    /* 事件订阅:口型电平 + 说话状态 + AI 表情 */
    _bindEvents() {
        const bus = window.globalEventBus;
        if (!bus) return;
        this._unsubs.push(bus.on('tts:level', (e) => { this._mouthLevel = Math.max(0, Math.min(1, (e.level || 0) / 60)); }));
        this._unsubs.push(bus.on('tts:start', () => { this._talking = true; }));
        this._unsubs.push(bus.on('tts:done', () => { this._talking = false; this._mouthLevel = 0; }));
        this._unsubs.push(bus.on('ai:mood', (e) => { this.setMood((e && e.mood) || 'normal'); }));
    }

    /** AI 表情(参数目标渐变;仅覆盖模型通用参数,缺参自动跳过) */
    setMood(mood) {
        this._mood = mood;
        const T = this._moodTargets;
        Object.keys(T).forEach(k => delete T[k]);
        if (mood === 'happy' || mood === 'love') {
            T.ParamMouthForm = 0.9; T.ParamEyeLOpen = 0.75; T.ParamEyeROpen = 0.75;
        } else if (mood === 'sad') {
            T.ParamMouthForm = -0.5; T.ParamBrowLY = -0.5; T.ParamBrowRY = -0.5; T.ParamEyeLOpen = 0.6; T.ParamEyeROpen = 0.6;
        } else if (mood === 'angry') {
            T.ParamMouthForm = -0.7; T.ParamBrowLY = -0.8; T.ParamBrowRY = -0.8;
        } else if (mood === 'surprised') {
            T.ParamEyeLOpen = 1.3; T.ParamEyeROpen = 1.3; T.ParamMouthOpenY = 0.5;
        } else if (mood === 'shy') {
            T.ParamMouthForm = 0.4; T.ParamEyeLOpen = 0.6; T.ParamEyeROpen = 0.6;
        }
    }

    _setParam(name, v) {
        const i = this._paramIdx[name];
        if (i === undefined || i < 0) return;
        const p = this._model.parameters;
        p.values[i] = Math.max(p.minimums[i], Math.min(p.maximums[i], v));
    }

    _resize() {
        const c = this._canvas;
        const r = c.parentElement.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        c.width = Math.max(1, Math.round(r.width * dpr));
        c.height = Math.max(1, Math.round(r.height * dpr));
        c.style.width = r.width + 'px';
        c.style.height = r.height + 'px';
        if (this._gl) this._gl.viewport(0, 0, c.width, c.height);
    }

    _loop() {
        if (!this._enabled) return;
        this._raf = requestAnimationFrame(() => this._loop());
        if (document.hidden || !this._model) return;
        this._frame();
    }

    _frame() {
        const gl = this._gl;
        const m = this._model;
        if (!this._t0) this._t0 = performance.now();
        const t = (performance.now() - this._t0) / 1000;

        // —— 程序化动作(呼吸/摆动/眨眼) ——
        this._setParam('ParamBreath', (Math.sin(t * Math.PI * 2 / 3.6) + 1) / 2);
        this._setParam('ParamAngleX', Math.sin(t * 0.55) * 7);
        this._setParam('ParamAngleY', Math.sin(t * 0.4 + 1) * 4);
        this._setParam('ParamAngleZ', Math.sin(t * 0.31 + 2) * 3);
        this._setParam('ParamBodyAngleX', Math.sin(t * 0.42) * 3.5);
        // 眨眼(每 2.8~5.2s)
        if (t > this._blinkAt) {
            this._blinkAt = t + 2.8 + Math.random() * 2.4;
            this._blinkT = t + 0.26;
        }
        let eye = 1;
        if (this._blinkT) {
            const ph = (this._blinkT - t) / 0.26;
            eye = Math.abs(ph - 0.5) * 2; // 快速闭合再睁开
            if (t > this._blinkT) { eye = 1; this._blinkT = 0; }
        }
        const moodEye = this._moodTargets.ParamEyeLOpen;
        this._setParam('ParamEyeLOpen', (moodEye !== undefined ? moodEye : eye));
        this._setParam('ParamEyeROpen', (this._moodTargets.ParamEyeROpen !== undefined ? this._moodTargets.ParamEyeROpen : eye));
        this._setParam('ParamBrowLY', this._moodTargets.ParamBrowLY !== undefined ? this._moodTargets.ParamBrowLY : 0);
        this._setParam('ParamBrowRY', this._moodTargets.ParamBrowRY !== undefined ? this._moodTargets.ParamBrowRY : 0);
        // 口型:优先原生电平;无电平时说话期间振荡模拟
        let mouth = 0;
        if (this._talking) {
            mouth = this._mouthLevel > 0.02 ? this._mouthLevel : 0.25 + 0.45 * Math.abs(Math.sin(t * 11));
        }
        if (this._moodTargets.ParamMouthOpenY !== undefined) mouth = Math.max(mouth, this._moodTargets.ParamMouthOpenY * 0.6);
        this._setParam('ParamMouthOpenY', mouth);
        this._setParam('ParamMouthForm', this._moodTargets.ParamMouthForm !== undefined ? this._moodTargets.ParamMouthForm : 0.3);

        m.update();
        this._uploadPositions(); // 更新后立即上传顶点,避免绘制上一帧位置

        // —— 绘制 ——
        gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        const d = m.drawables;
        const b = this._bounds;
        const mw = Math.max(0.001, b.maxX - b.minX), mh = Math.max(0.001, b.maxY - b.minY);
        const P = this._programs.mesh;
        gl.useProgram(P.prog);
        // 适配:模型坐标 x∈[minX,maxX], y∈[minY,maxY] → NDC
        const nx = 2 / (mw * 1.08), ny = 2 / (mh * 1.08);
        const ox = -((b.minX + b.maxX) / 2) * nx;
        const oy = -((b.minY + b.maxY) / 2) * ny - 0.06; // 略下移让头部靠上
        gl.uniform2f(P.uScale, nx, ny);
        gl.uniform2f(P.uOffset, ox, oy);
        gl.uniform1i(P.uTex, 0);
        gl.activeTexture(gl.TEXTURE0);

        // 按 renderOrder 绘制;带蒙版 drawable 走模板两段
        const order = [];
        for (let i = 0; i < d.count; i++) order.push(i);
        order.sort((a, c) => d.renderOrders[a] - d.renderOrders[c]);
        for (const i of order) {
            if (d.opacities[i] <= 0.01) continue;
            const vc = d.vertexUvCounts[i];
            const masked = d.maskCounts[i] > 0;
            gl.bindBuffer(gl.ARRAY_BUFFER, this._vbs[i].pos);
            gl.enableVertexAttribArray(P.aPos);
            gl.vertexAttribPointer(P.aPos, 2, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, this._vbs[i].uv);
            gl.enableVertexAttribArray(P.aUv);
            gl.vertexAttribPointer(P.aUv, 2, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._vbs[i].ib);
            gl.bindTexture(gl.TEXTURE_2D, this._textures[d.textureIndices[i]] || this._textures[0]);
            gl.uniform1f(P.uOpacity, d.opacities[i]);
            const bm = d.blendModes ? d.blendModes[i] : 0;
            if (bm === 1) gl.blendFunc(gl.ONE, gl.ONE);                      // 加算
            else if (bm === 2) gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA); // 乘算(近似)
            else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);               // 通常(预乘)
            if (masked) {
                // 蒙版两段:先写蒙版形状到 stencil(只写蒙版 drawable),再测试绘制
                gl.enable(gl.STENCIL_TEST);
                gl.clearStencil(0);
                gl.clear(gl.STENCIL_BUFFER_BIT);
                gl.colorMask(false, false, false, false);
                gl.stencilFunc(gl.ALWAYS, 1, 0xFF);
                gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
                for (let mk = 0; mk < d.maskCounts[i]; mk++) {
                    const mi = d.masks[i][mk];
                    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbs[mi].pos);
                    gl.vertexAttribPointer(P.aPos, 2, gl.FLOAT, false, 0, 0);
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._vbs[mi].ib);
                    gl.drawElements(gl.TRIANGLES, d.vertexUvCounts[mi], gl.UNSIGNED_SHORT, 0);
                }
                gl.colorMask(true, true, true, true);
                gl.stencilFunc(gl.GEQUAL, 1, 0xFF);
                gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
            }
            gl.drawElements(gl.TRIANGLES, vc, gl.UNSIGNED_SHORT, 0);
            if (masked) gl.disable(gl.STENCIL_TEST);
        }
    }
}

window.Live2DSystem = Live2DSystem;
window.live2dSystem = new Live2DSystem();

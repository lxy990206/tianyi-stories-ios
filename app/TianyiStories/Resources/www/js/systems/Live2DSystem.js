/**
 * Live2D 渲染系统(1.1.10Beta5/157 按官方文档对照重写;179~183 蒙版/贴图管线根修)
 * 仅依赖 Cubism Core(live2d/core/live2dcubismcore.js)+ WebGL1:
 *  - **API 全部按 Core d.ts 核对**(drawables 每 drawable 独立数组/minimumValues·maximumValues/canvasinfo)
 *  - 官方 CubismRenderer_WebGLES FBO 蒙版管线(182 坐标系统一+帧末回收 pool)
 *  - **入口=Live2D 按钮进入专属全屏页面**;失败原因页面内显示
 *  - 驱动:AI 情绪表情+TTS 频谱口型(开合度+元音口型)+程序化动作(呼吸/摆动/眨眼)
 *
 * 184 五大特性:
 *  ① 贴图全量原图(tex0~5=4096;tex6/7=4096×8192 HQ,GPU MAX_TEXTURE_SIZE<8192 自动回落 lq/2048×4096)
 *  ② 陀螺仪:deviceorientation(beta/gamma,含屏幕旋转轴系补偿)→ ParamAngle/BodyAngle,
 *     物理引擎以 Angle 为输入驱动发梢/衣物随手机摆动(官方 physics 数据流)
 *  ③ 眼动追踪:原生 GazeBridge(前摄 Camera2 硬件人脸检测)→ Live2DGazeHandler.onGaze
 *     → ParamEyeBallX/Y 平滑跟随+头部小幅倾向(眼睛始终看向用户)
 *  ④ 口型:MimoTTSBridge 原生 1024 点 FFT 分频带 → onLevel(pct,form) →
 *     ParamMouthOpenY(RMS 开合,快起慢落包络)+ParamMouthForm(元音口型:低频强=a/o 正,
 *     中频强=i/e 负)——口型与 TTS 语音频谱对应,非固定一张一闭
 *  ⑤ 触摸反馈:点在三角形内命中检测(按 renderOrders 自上而下,官方 HitTest 语义) +
 *     几何分区(头顶/脸/胸/手/身体) → 表情参数组合反应(摸头=眯眼笑/摸脸=害羞脸红/
 *     摸胸=惊愕躲闪/摸手=侧身回应),反应带升-持-落包络
 *  ⑥ 全屏显示:按模型实际包围盒 cover 等比缩放(官方 CubismViewMatrix setup 语义)撑满视口,
 *     横屏超高时顶部锚定 3% 边距保脸;蒙版管线与主绘制共用同一变换
 */
class Live2DSystem {
    constructor() {
        this._inited = false;
        this._inited_ok = false;
        this._enabled = false;
        this._failed = false;
        this._gl = null;
        this._canvas = null;
        this._model = null;
        this._textures = [];
        this._vbs = [];
        this._prog = null;
        this._raf = 0;
        this._t0 = 0;
        this._paramIdx = {};
        this._mood = 'normal';
        this._moodTargets = {};
        this._mouthLevel = 0;
        this._mouthForm = 0;          // 184:元音口型(-1..1,来自原生 FFT)
        this._mouthOpen = 0;          // 184:平滑后开合度(快起慢落)
        this._talking = false;
        this._blinkAt = 0;
        this._blinkT = 0;
        this._handIds = [0, 1];   // 189:双手 drawable(模型 moc3 中恒 opacity=0)
        // 190:手部交互开关(默认关闭——模型默认姿态双手隐藏;逻辑完整保留,置 true 即恢复)
        this._handsVisible = false;      // true=渲染器强制显示双手
        this._handTouchEnabled = false;  // true=hand 触摸区触发反馈(AI 回复+表情)
        // 193:部件语义覆盖表——整体语义明确的部件强制归类(三角形级位置法的跨区修正)
        this._zoneOverride = { 91: 'arm', 146: 'arm', 89: 'arm', 90: 'arm', 94: 'arm', 95: 'arm' };
        this._unsubs = [];
        // 184:陀螺仪(devicemotion 轴系换算后:roll=屏幕平面左右倾,pitch=前后倾,直立=0)
        this._gyro = { roll: 0, pitch: 0, active: false, lastT: 0 };
        // 200:翻转跟随状态——turnTarget 由屏幕方位角累算,turnCur 缓慢趋近(慢慢转身)
        this._gyro.turnTarget = 0;
        this._gyro.turnCur = 0;
        // 184:摄像头凝视(原生回调原始值 + 平滑后状态)
        this._gazeRaw = { x: 0, y: 0, found: false, t: 0 };
        this._gazeS = { x: 0, y: 0, w: 0 };
        this._gazeState = '';
        this._gazeStarted = false;
        this._gazeCal = null;          // 197:Zero Pose 校准状态
        this._gazeLastSeen = 0;
        this.__gazeLogT = 0;
        // 184:触摸反馈(最新反应,带包络;分区冷却)
        this._touchFx = null;         // {zone, t0, dur, side}
        this._touchCd = new Map();    // zone -> 上次触发时间戳(ms)
        // 184:全屏变换 + 模型实际包围盒(单位:模型空间)
        this._tf = null;
        this._mbbox = null;
        // 205:退出后 30s 延迟销毁计时器 / 睡觉状态(非清醒时段进入)
        this._destroyTimer = 0;
        this._sleeping = false;
    }

    /** 打开 Live2D 专属页面(入口);失败在页面内显示原因 */
    async openPage() {
        const page = document.getElementById('live2d-page');
        if (!page) return;
        page.style.display = 'flex';
        // 205:30s 销毁计时器取消(30s 内返回=现场秒恢复);销毁过则 _destroyed 解除,走全新 _init
        if (this._destroyTimer) { clearTimeout(this._destroyTimer); this._destroyTimer = 0; }
        this._destroyed = false;
        // 186:打开后延迟补两次 resize(页面布局/字体加载可能晚于首次调用)
        setTimeout(() => this._resize(), 120);
        setTimeout(() => this._resize(), 600);
        // 209:启动提示页(居中 124×124 无声视频+「正在召唤洛天依。。。」)——
        //     仅实际执行加载时显示;30s 内快速恢复(_inited_ok)不闪现
        const loading = document.getElementById('l2-loading');
        const willLoad = !this._inited_ok;
        if (loading) loading.style.display = willLoad ? 'flex' : 'none';
        try {
            await this._init();
            this._start();
            // 205:非清醒时段进入=睡觉状态(作息口径与主动问候门控一致:8~22 点清醒)——
            //     闭眼+慢呼吸;凝视摄像头不启动(睡觉不追视);发消息 wake() 唤醒,轻触给反应不醒
            const h = new Date().getHours();
            this._sleeping = (h < 8 || h >= 22);
            if (this._sleeping) this.setMood('normal');
            // 210:睡觉不再显示提示语(用户反馈破坏沉浸感)——状态本身(闭眼/慢呼吸)即表达
            this._status('');
            if (!this._sleeping) this._startGaze();
        } catch (e) {
            console.warn('[Live2D] 初始化失败:', e);
            this._status('Live2D 初始化失败:' + (e && e.message ? e.message : '未知原因'));
        } finally {
            if (loading) loading.style.display = 'none';
        }
    }

    closePage() {
        const page = document.getElementById('live2d-page');
        if (page) page.style.display = 'none';
        const loading = document.getElementById('l2-loading');
        if (loading) loading.style.display = 'none';
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
        this._enabled = false;
        this._stopGaze();      // 184:页面关闭即停摄像头(隐私/电量)
        this._touchFx = null;
        this._sleeping = false;
        // 205:退出 30s 内未返回→自动终止 Live2D 相关进程(GL 纹理/缓冲/FBO/模型顶点/
        //     参数表/事件监听全释放,渲染循环已停);下次进入全新加载。30s 内返回=现场恢复。
        if (this._destroyTimer) clearTimeout(this._destroyTimer);
        this._destroyTimer = setTimeout(() => this._teardown(), 30000);
    }

    /** 205:Live2D 相关进程完全终止——GL 资源逐项删除+JS 侧大对象引用清空+事件监听解除 */
    _teardown() {
        // 208:先清计时器再销毁(否则手动/提前触发的 teardown 之后,原 30s 定时器仍会
        //   到点火化,把刚重建的新会话再次销毁——探针实测踩坑)
        if (this._destroyTimer) { clearTimeout(this._destroyTimer); this._destroyTimer = 0; }
        this._destroyTimer = 0;
        if (this._onWinResize) { window.removeEventListener('resize', this._onWinResize); this._onWinResize = null; }
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
        this._enabled = false;
        this._stopGaze();
        this._touchFx = null;
        this._unsubs.forEach((fn) => { try { fn(); } catch (e) { /* 忽略 */ } });
        this._unsubs = [];
        const gl = this._gl;
        if (gl) {
            (this._textures || []).forEach((t) => { if (t) gl.deleteTexture(t); });
            (this._vbs || []).forEach((b) => { if (b) { gl.deleteBuffer(b.pos); gl.deleteBuffer(b.uv); gl.deleteBuffer(b.ib); } });
            (this._maskFboPool || []).forEach((m) => { if (m) { gl.deleteFramebuffer(m.fbo); gl.deleteTexture(m.tex); } });
            if (this._zoneTex) gl.deleteTexture(this._zoneTex);
            const q = this._debugQuad;
            if (q) { gl.deleteBuffer(q.pos); gl.deleteBuffer(q.uv); gl.deleteBuffer(q.ib); }
            // 208:属性数组启用位随缓冲删除而悬空(enabled 无 buffer)——后续任何 draw
            //   直接 INVALID_OPERATION(蒙版首帧全空误判的根因)。全部关闭,下次加载自净。
            for (let a = 0; a < 8; a++) gl.disableVertexAttribArray(a);
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        this._model = null;
        this._textures = [];
        this._vbs = [];
        this._maskFboPool = [];
        this._maskCache = new Map();
        this._maskEmptyState = new Map();
        this._zoneTex = null;
        this._debugQuad = null;
        this.__maskDebugInstalled = false;
        this._tf = null;
        this._mbbox = null;
        this._moodTargets = {};
        this._paramIdx = {};
        this._inited = false;
        this._inited_ok = false;
        this._destroyed = true;
        console.log('[Live2D] 205:退出 30s 未返回,Live2D 进程已完全终止(下次进入全新加载)');
    }

    /** 205:唤醒(用户发消息时调用)——解除睡觉状态 */
    wake() {
        this._sleeping = false;
        this._status('');
    }

    _status(msg) {
        const el = document.getElementById('live2d-status');
        if (el) el.textContent = msg || '';
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

    async _init() {
        if (this._inited_ok) return;
        await this._injectCore();
        if (!window.Live2DCubismCore || !window.Live2DCubismCore.Moc) {
            throw new Error('Core 未加载');
        }
        this._canvas = document.getElementById('live2d-canvas');
        if (!this._canvas) throw new Error('画布缺失');
        this._initGl();
        await this._loadModel('live2d/model/tianyi/tianyi.model3.json');
        this._computeTriangleZones();   // 192:三角形归属预计算(默认姿态标定)
        this._bindEvents();
        this._bindSensors();      // 184:陀螺仪/加速度监听
        this._bindTouch();        // 184:触摸反馈
        this._aiTouchBusy = false; this._lastAiTouch = 0;   // 186:AI 触摸回复节流状态
        this._installMaskDebug();
        // 205:resize 监听存引用——teardown 时解除,重新加载不叠加
        if (this._onWinResize) window.removeEventListener('resize', this._onWinResize);
        this._onWinResize = () => this._resize();
        window.addEventListener('resize', this._onWinResize);
        this._inited_ok = true;
    }

    _initGl() {
        // 180:stencil 必须显式开启(默认 false)——虹膜等部件靠眼白蒙版渲染,无模板缓冲
        // 蒙版全程无效=真机眼睛呈白团+GL_INVALID_OPERATION 1282
        const gl = this._canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, stencil: true, antialias: true })
            || this._canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: true, stencil: true, antialias: true });
        if (!gl) throw new Error('WebGL 不可用');
        this._gl = gl;
        // 181:上下文丢失防护(长时间高频渲染/移动端切后台可能触发)——丢失即停循环,恢复后重建
        this._canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            this._inited_ok = false;
            this._textures = [];
            this._vbs = [];
            // 182:GPU 资源随上下文全部失效——蒙版 FBO 池/空检测缓存一并清空,恢复后重建
            this._maskFboPool = [];
            this._maskCache = new Map();
            this._maskEmptyState = new Map();
            this._mbbox = null;   // 184:重建时重测
            if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
            this._enabled = false;
            console.warn('[Live2D] WebGL 上下文丢失,等待恢复');
        }, false);
        this._canvas.addEventListener('webglcontextrestored', () => {
            console.warn('[Live2D] WebGL 上下文已恢复,重新初始化');
            this._init().then(() => { this._enabled = true; this._loop(); }).catch(() => {});
        }, false);
        // 181:官方 CubismRenderer_WebGLES 蒙版方案(用户要求严格对照官方文档)——
        // 蒙版预渲染到离屏 FBO,本体 shader 采样蒙版纹理(vClipUv 由组包围盒映射),弃用 stencil
        const vs = 'attribute vec2 aPos;attribute vec2 aUv;uniform vec2 uScale;uniform vec2 uOffset;'
            + 'uniform vec4 uClipRect;varying vec2 vUv;varying vec2 vClipUv;'
            + 'void main(){vec2 p=vec2(aPos.x*uScale.x+uOffset.x,aPos.y*uScale.y+uOffset.y);'
            + 'gl_Position=vec4(p,0.0,1.0);vUv=aUv;'
            + 'vClipUv=(p-vec2(uClipRect.x,uClipRect.y))/(vec2(uClipRect.z,uClipRect.w)-vec2(uClipRect.x,uClipRect.y));}';
        const fs = 'precision mediump float;varying vec2 vUv;varying vec2 vClipUv;'
            + 'uniform sampler2D uTex;uniform sampler2D uMask;'
            + 'uniform float uOpacity;uniform vec3 uMultiply;uniform float uUseMask;'
            + 'void main(){vec4 c=texture2D(uTex,vUv);c.rgb*=uMultiply;c.rgb*=c.a;c*=uOpacity;'
            + 'if(uUseMask>0.5){vec4 mc=texture2D(uMask,vClipUv);'
            + 'c*=clamp(mc.r+mc.g+mc.b+mc.a,0.0,1.0);}gl_FragColor=c;}';
        this._prog = this._buildProgram(gl, vs, fs);
        // 蒙版预渲染专用纯色 program(形状完整填充,不采样纹理——官方语义)
        // 182:蒙版坐标系统一——蒙版形状按 clip 包围盒归一化展开到整个 FBO:
        //   c=(NDC-clip.min)/(clip.max-clip.min)∈[0,1] → 映射到 FBO 全屏[-1,1]
        //   与本体 shader vClipUv=(p-clip.min)/(range) 完全同一坐标系,采样不再错位。
        //   此前蒙版用全屏 NDC 变换(形状只占 FBO 一角),本体却在 clip 空间采样
        //   → 采样点恒落空 → 虹膜被乘0=白眼(实验 D 数学证明:蒙版覆盖 u∈[0.53,0.62],
        //   虹膜中心采样点 (0.46,0.50) 在覆盖区外)
        const mvs = 'attribute vec2 aPos;uniform vec2 uScale;uniform vec2 uOffset;'
            + 'uniform vec4 uClipRect;'
            + 'void main(){vec2 p=vec2(aPos.x*uScale.x+uOffset.x,aPos.y*uScale.y+uOffset.y);'
            + 'vec2 c=(p-uClipRect.xy)/(uClipRect.zw-uClipRect.xy);'
            + 'gl_Position=vec4(c*2.0-1.0,0.0,1.0);}';
        const mfs = 'precision mediump float;void main(){gl_FragColor=vec4(1.0,1.0,1.0,1.0);}';
        this._maskProg = this._buildProgram(gl, mvs, mfs);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
        gl.clearStencil(0);
        this._maskFboPool = [];
        this._maskCache = new Map();
        this._maskEmptyState = new Map();   // 182:蒙版空检测结果持久化(key=组key),防每帧回读
        // 188:分区可视化纯色 program(aPos+uColor;变换与主渲染同源 _tf)
        const zvs = 'attribute vec2 aPos;uniform vec2 uScale;uniform vec2 uOffset;'
            + 'void main(){gl_Position=vec4(aPos.x*uScale.x+uOffset.x,aPos.y*uScale.y+uOffset.y,0.0,1.0);}';
        const zfs = 'precision mediump float;uniform vec4 uColor;'
            + 'void main(){gl_FragColor=vec4(uColor.rgb*uColor.a,uColor.a);}';
        this._zoneProg = this._buildProgram(gl, zvs, zfs);
    }

    /** 蒙版离屏缓冲(256×256 官方默认分辨率;每组一张,首次分配后随组持久复用) */
    _acquireMaskFbo() {
        const gl = this._gl;
        if (this._maskFboPool.length) return this._maskFboPool.pop();
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        // 182:真机兼容诊断——部分 Android GPU 上 FBO 可能不完整(蒙版采样为空=虹膜/腮红消失)
        const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        const ok = st === gl.FRAMEBUFFER_COMPLETE;
        if (!ok) console.warn('[Live2D] 蒙版 FBO 不完整 status=' + st);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { tex, fbo, ok };
    }

    /** 182:蒙版诊断开关(连点 Live2D 画布触发)——把各组蒙版 FBO 纹理轮流全屏显示:
     *  真机一眼判定「蒙版缓冲为空(设备级 FBO 问题)」vs「有形状(采样/映射代码问题)」
     *  197:连点触发已彻底移除(快速连点=正常触摸交互,4 击阈值仍会误入蒙版模式) */
    _installMaskDebug() {
        if (this.__maskDebugInstalled) return;
        this.__maskDebugInstalled = true;
        // 197:蒙版诊断改为仅控制台触发——此前"连点 4 次画布切换"与触摸反馈冲突,
        //     快速连点(间隔<350ms)累积 4+ 击即误入蒙版模式(真机用户实测踩坑);
        //     触摸交互与诊断彻底解耦。控制台开关:
        //     window.live2dSystem.setMaskDebug(1..N)=逐组显示 / setMaskDebug(0)=关闭
        // 全屏 quad(pos+uv)用于蒙版纹理可视化
        const gl = this._gl;
        const pos = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, pos);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const uv = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, uv);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), gl.STATIC_DRAW);
        const ib = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 3]), gl.STATIC_DRAW);
        this._debugQuad = { pos, uv, ib };
    }

    /** 197:蒙版诊断开关(仅控制台调用,与触摸交互彻底解耦) */
    setMaskDebug(idx) {
        this.__maskDebugIdx = Math.max(0, idx | 0);
        this._status(this.__maskDebugIdx > 0
            ? '蒙版诊断 #' + this.__maskDebugIdx + '/' + (this._maskCache ? this._maskCache.size : 0) + ' 组'
            : '');
    }

    /** 诊断绘制:__maskDebugIdx 指向组的蒙版纹理全屏显示 */
    _drawMaskDebug() {
        const gl = this._gl;
        const gs = Array.from(this._maskCache.values());
        if (!gs.length || !this._debugQuad) return;
        const g = gs[(this.__maskDebugIdx - 1) % gs.length];
        gl.disable(gl.BLEND);
        gl.useProgram(this._prog.prog);
        gl.uniform2f(this._prog.uScale, 1, 1);
        gl.uniform2f(this._prog.uOffset, 0, 0);
        gl.uniform1f(this._prog.uOpacity, 1);
        gl.uniform3f(this._prog.uMultiply, 1, 1, 1);
        gl.uniform1f(this._prog.uUseMask, 0);
        gl.uniform4f(this._prog.uClipRect, -1, -1, 1, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, g.fbo.tex);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._debugQuad.pos);
        gl.enableVertexAttribArray(this._prog.aPos);
        gl.vertexAttribPointer(this._prog.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._debugQuad.uv);
        gl.enableVertexAttribArray(this._prog.aUv);
        gl.vertexAttribPointer(this._prog.aUv, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._debugQuad.ib);
        gl.drawElements(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_SHORT, 0);
        gl.enable(gl.BLEND);
    }

    /** 189b:分区判定热力图(512²覆盖模型实际包围盒 _mbbox;逐像素跑 _classifyZone)——
     *  热力图与触摸判定是同一函数同一坐标系,所见色块=判定本身(不再按部件归属着色,
     *  衣服大件跨臂/身区域按像素位置正确分区) */
    _buildZoneTexture() {
        const gl = this._gl;
        const S = 512;
        const mb = this._mbbox || [-0.5, -0.7, 0.5, 0.5];
        this._zoneBbox = mb.slice();
        const data = new Uint8Array(S * S * 4);
        for (let py = 0; py < S; py++) {
            const my = mb[1] + (py / (S - 1)) * (mb[3] - mb[1]);
            for (let px = 0; px < S; px++) {
                const mx = mb[0] + (px / (S - 1)) * (mb[2] - mb[0]);
                const z = this._classifyZone(mx, my);
                let r = 0, g = 0, b = 0, a = 0;
                if (z === 'head') { r = 255; g = 60; b = 60; a = 190; }
                else if (z === 'face') { r = 60; g = 235; b = 90; a = 190; }
                else if (z === 'hand') { r = 255; g = 225; b = 40; a = 190; }
                else if (z === 'chest') { r = 70; g = 140; b = 255; a = 190; }
                else if (z === 'belly') { r = 255; g = 130; b = 10; a = 190; }
                else if (z === 'arm') { r = 205; g = 90; b = 255; a = 190; }
                const o = (py * S + px) * 4;
                data[o] = r; data[o+1] = g; data[o+2] = b; data[o+3] = a;
            }
        }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this._zoneTex = tex;
    }

    /** 189b:分区可视化——_tf 同源热力图(纹理逐像素=classifyZone,quad 角点经 tf 变换)。
     *  与触摸判定(点击点 classifyZone)完全同一函数同一坐标系,所见=判定,零偏移。
     *  _zoneFilter=[区名...] 时仅高亮指定区(高对比色),null=五区全显。 */
    _drawZoneDebug() {
        const gl = this._gl;
        if (!this._prog) return;
        const tf = this._tf;
        if (!tf) return;
        if (!this._zoneTex) this._buildZoneTexture();
        const ZB = this._zoneBbox;
        const nx0 = ZB[0]*tf.sx+tf.ox, nx1 = ZB[2]*tf.sx+tf.ox;
        const ny0 = ZB[1]*tf.sy+tf.oy, ny1 = ZB[3]*tf.sy+tf.oy;
        gl.useProgram(this._prog.prog);
        gl.uniform2f(this._prog.uScale, 1, 1);
        gl.uniform2f(this._prog.uOffset, 0, 0);
        gl.uniform1f(this._prog.uOpacity, 1);
        gl.uniform3f(this._prog.uMultiply, 1, 1, 1);
        gl.uniform1f(this._prog.uUseMask, 0);
        gl.uniform4f(this._prog.uClipRect, -1, -1, 1, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._zoneTex);
        if (!this._zoneQuadPos) {
            this._zoneQuadPos = gl.createBuffer();
            this._zoneQuadUv = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this._zoneQuadUv);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this._zoneQuadPos);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([nx0, ny0, nx1, ny0, nx0, ny1, nx1, ny1]), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this._prog.aPos);
        gl.vertexAttribPointer(this._prog.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._zoneQuadUv);
        gl.enableVertexAttribArray(this._prog.aUv);
        gl.vertexAttribPointer(this._prog.aUv, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /** 收集本帧蒙版组:按 mask 集合分组(key=排序后的 mask id 列表) */
    _collectMaskGroups() {
        const d = this._model.drawables;
        const map = new Map();
        for (let i = 0; i < d.count; i++) {
            if (d.maskCounts[i] <= 0) continue;
            if (d.opacities[i] <= 0.01 || d.vertexCounts[i] <= 0) continue;
            const arr = Array.from(d.masks[i].slice(0, d.maskCounts[i])).sort((a, b) => a - b);
            const key = arr.join(',');
            if (!map.has(key)) map.set(key, { key, masks: arr, members: [], fbo: null, clip: null });
            map.get(key).members.push(i);
        }
        return Array.from(map.values());
    }

    /** 预渲染全部蒙版组到各自 FBO(纯色填充+组包围盒;每帧重算因顶点随动画变化)
     *  184:变换改用 this._tf(与主绘制同一 cover 变换,此前两处独立计算易失同步) */
    _renderMaskGroups(groups) {
        const gl = this._gl, d = this._model.drawables;
        const tf = this._tf;
        const sx = tf.sx, sy = tf.sy, ox = tf.ox, oy = tf.oy;
        const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const prevVp = gl.getParameter(gl.VIEWPORT);
        gl.disable(gl.BLEND);
        gl.useProgram(this._maskProg.prog);
        // 208:蒙版阶段属性状态自洽(二次重启蒙版全失效根修)——teardown 删除顶点缓冲后,
        //   主程序 aUv 等遗留 enabled 数组位悬空(enabled 无 buffer),drawElements 抛
        //   INVALID_OPERATION → 形状未画入 FBO → 首帧空检测全部误判「空」并永久缓存
        //   → masked 眼部件裸画(眼睛贴图错位到鼻梁)。maskProg 只用 aPos,先关掉其余位。
        gl.disableVertexAttribArray(this._prog.aUv);
        gl.uniform2f(this._maskProg.uScale, sx, sy);
        gl.uniform2f(this._maskProg.uOffset, ox, oy);
        const aP = this._maskProg.aPos;
        for (const g of groups) {
            if (!g.fbo) g.fbo = this._acquireMaskFbo();
            gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo.fbo);
            gl.viewport(0, 0, 256, 256);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
            for (const mi of g.masks) {
                const pos = d.vertexPositions[mi];
                for (let v = 0; v < d.vertexCounts[mi]; v++) {
                    const nx = pos[v * 2] * sx + ox, ny = pos[v * 2 + 1] * sy + oy;
                    if (nx < x0) x0 = nx; if (nx > x1) x1 = nx;
                    if (ny < y0) y0 = ny; if (ny > y1) y1 = ny;
                }
            }
            const pad = 0.02;
            g.clip = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
            // 182:绘制前设置 clip 包围盒——蒙版形状展开到 FBO 全屏(与本体系数对齐,见 vs 注释)
            gl.uniform4f(this._maskProg.uClipRect, g.clip[0], g.clip[1], g.clip[2], g.clip[3]);
            for (const mi of g.masks) {
                gl.bindBuffer(gl.ARRAY_BUFFER, this._vbs[mi].pos);
                gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._vbs[mi].ib);
                gl.drawElements(gl.TRIANGLES, this._vbs[mi].ic, gl.UNSIGNED_SHORT, 0);
            }
            // 182:真机空检测(每组仅首帧,结果持久化到 _maskEmptyState)——部分设备 FBO
            // 渲染后内容为空,蒙版采样恒 0 → 虹膜/腮红等被乘 0 消失(真机 Bata11 实测症状)
            // 182:组对象每帧重建,checked 不能挂在组上(否则每帧每组 readPixels 256²,
            //   17组×60fps 的 GPU→CPU 回读会强制同步管线,真机严重掉帧)
            if (!this._maskEmptyState.has(g.key)) {
                const mp = new Uint8Array(256 * 256 * 4);
                gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, mp);
                let any = 0;
                for (let k = 3; k < mp.length; k += 16) any += mp[k];
                this._maskEmptyState.set(g.key, any === 0);
                if (any === 0) console.warn('[Live2D] 蒙版组渲染为空(设备不兼容),自动降级为无蒙版');
            }
            // 182:修 FBO 完整性引用(_acquireMaskFbo 返回 {tex,fbo,ok};
            //   此前误写裸变量 ok——类体严格模式每帧抛 ReferenceError: ok is not defined,
            //   渲染在蒙版阶段即中断(Bata12 构建后从未跑通一帧,实验A实锤)
            g.fboOk = g.fbo.ok && !this._maskEmptyState.get(g.key);
            this._maskCache.set(g.key, g);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
        gl.viewport(prevVp[0], prevVp[1], prevVp[2], prevVp[3]);
        gl.enable(gl.BLEND);
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
            uMultiply: gl.getUniformLocation(prog, 'uMultiply'),
            uClipRect: gl.getUniformLocation(prog, 'uClipRect'),
            uMask: gl.getUniformLocation(prog, 'uMask'),
            uUseMask: gl.getUniformLocation(prog, 'uUseMask'),
            uColor: gl.getUniformLocation(prog, 'uColor'),
        };
    }

    /** 模型加载(字段按 Core d.ts:每 drawable 独立数组) */
    async _loadModel(jsonPath) {
        const gl = this._gl;
        const m3 = JSON.parse(await this._read(jsonPath, 'text'));
        const base = jsonPath.replace(/[^/]*$/, '');
        const ref = m3.FileReferences || {};
        const mocBuf = await this._read(base + ref.Moc, 'arraybuffer');
        const moc = window.Live2DCubismCore.Moc.fromArrayBuffer(mocBuf);
        if (!moc) throw new Error('Moc 解析失败(文件损坏或 Core 版本不符)');
        const model = window.Live2DCubismCore.Model.fromMoc(moc);
        if (!model) throw new Error('Model 创建失败');
        this._model = model;
        // 参数索引(字段名:d.ts minimumValues/maximumValues)
        const ids = model.parameters.ids;
        const want = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamEyeLOpen', 'ParamEyeROpen',
            'ParamEyeLSmile', 'ParamEyeRSmile', 'ParamEyeBallX', 'ParamEyeBallY',
            'ParamBrowLY', 'ParamBrowRY', 'ParamMouthOpenY', 'ParamMouthForm', 'ParamCheek',
            'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamBreath'];
        want.forEach(n => { this._paramIdx[n] = ids.indexOf(n); });
        // 纹理
        // 184:贴图全量原图——tex0~5=4096 原图,tex6/7=4096×8192 HQ;
        //   GPU MAX_TEXTURE_SIZE<8192 的设备 tex6/7 自动回落 tex/lq/(2048×4096,等比)
        const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if (maxTex < 4096) console.warn('[Live2D] GPU MAX_TEXTURE_SIZE=' + maxTex + ' <4096,贴图上传可能失败');
        for (const t of (ref.Textures || [])) {
            let p = base + t;
            if (maxTex < 8192 && /texture_0[67]\.png$/.test(t)) {
                p = base + t.replace('tex/', 'tex/lq/');
                console.warn('[Live2D] GPU MAX_TEXTURE_SIZE<8192,tex6/7 回落 lq/2048×4096');
            }
            const img = await this._readImage(p);
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            // 179:贴图 Y 翻转(Cubism UV 与 WebGL 纹理方向差)——浏览器 A/B 实测:不翻转贴图部位全部碎裂错位,翻转后完整渲染
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            this._textures.push(tex);
        }
        // 顶点缓冲(每 drawable 独立数组)
        const d = model.drawables;
        this._vbs = [];
        for (let i = 0; i < d.count; i++) {
            const pos = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, pos);
            gl.bufferData(gl.ARRAY_BUFFER, d.vertexPositions[i], gl.DYNAMIC_DRAW);
            const uv = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, uv);
            gl.bufferData(gl.ARRAY_BUFFER, d.vertexUvs[i], gl.STATIC_DRAW);
            const ib = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, d.indices[i], gl.STATIC_DRAW);
            // 179:缓存索引数——drawElements 第二参数是索引数,此前误用顶点数(如 130 vs 537)只画 1/4 三角形
            this._vbs.push({ pos, uv, ib, ic: d.indices[i].length });
        }
        // 158 关键修复:renderOrders 等动态数组在首次 model.update() 前未填充
        // (Node+真模型实测:更新前 renderOrders[122] 即越界)——先 update 再上传
        model.update();
        this._uploadPositions();
        // 184:模型实际包围盒(默认姿态全部可见网格顶点并集+2% 收边)——恒定缩放基准
        // 204:仅在加载完成时标定一次并冻结(修复 201 周期重测导致的 contain 缩放抖动)
        this._computeModelBbox();
        this._resize();
    }

    /** 184:模型实际包围盒(默认姿态全部可见网格顶点并集,替代画布 contain——
     *  模型只占画布约 2/3,画布 contain 导致只占屏高 60%)。仅默认姿态调用一次。 */
    _computeModelBbox() {
        const d = this._model.drawables;
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (let i = 0; i < d.count; i++) {
            if (d.vertexCounts[i] <= 0 || d.opacities[i] <= 0.01) continue;
            const pos = d.vertexPositions[i];
            for (let v = 0; v < d.vertexCounts[i]; v++) {
                const x = pos[v * 2], y = pos[v * 2 + 1];
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
        if (x0 > x1) { this._mbbox = null; return; }
        const px = (x1 - x0) * 0.02, py = (y1 - y0) * 0.02;
        this._mbbox = [x0 + px, y0 + py, x1 - px, y1 - py];
        console.log('[Live2D] 模型包围盒(默认姿态一次标定·恒定缩放基准):', this._mbbox.join(','));
    }

    /** 184:全屏 cover 等比变换(官方 CubismViewMatrix setup 语义手工实现,Core 无 Framework):
     *  以模型包围盒替代画布做 fit——fit=max(pw/bw,ph/bh)(cover)撑满视口,
     *  宽度溢出则左右对称裁切;高度溢出(横屏)顶部锚定留 3% 边距保脸。
     *  等比:sx=sy 同源(同一 fit/PPU),不拉伸变形(180 真机教训)。 */
    /** 196:视口安全区(top=任务栏/挖孔,bottom=导航栏,左右=刘海)——
     *  css px → buffer px(×dpr);模型 fit 在"安全区内矩形"计算,上下顶满安全区,5px CSS 额外呼吸边 */
    _safeInsets() {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cs = getComputedStyle(document.documentElement);
        const px = (v) => (parseFloat(v) || 0) * dpr;
        return {
            top: px(cs.getPropertyValue('--safe-inset-top')),
            bottom: px(cs.getPropertyValue('--safe-inset-bottom')),
            left: px(cs.getPropertyValue('--safe-inset-left')),
            right: px(cs.getPropertyValue('--safe-inset-right')),
            margin: 5 * dpr,                              // 196:5px CSS 额外呼吸边(用户定)
        };
    }

    _calcTransform() {
        const gl = this._gl, ci = this._model.canvasinfo;
        const pw = gl.drawingBufferWidth, ph = gl.drawingBufferHeight;
        const si = this._safeInsets();
        // 196:可用视口=全屏 - 安全区(- 5px 呼吸边);模型 fit 在此矩形内,上下顶满
        const vw = Math.max(1, pw - si.left - si.right - si.margin * 2);
        const vh = Math.max(1, ph - si.top - si.bottom - si.margin * 2);
        const scx = si.left + si.margin + vw / 2;         // 可用区中心(屏幕 buffer px,y 向下)
        const scy = si.top + si.margin + vh / 2;
        const mb = this._mbbox;
        if (!mb) { // 包围盒缺失:退回画布 contain(兜底,不应发生)
            const scale = Math.min(vw / ci.CanvasWidth, vh / ci.CanvasHeight);
            const sx = 2 * ci.PixelsPerUnit * scale / pw, sy = 2 * ci.PixelsPerUnit * scale / ph;
            return { sx, sy, ox: (ci.CanvasOriginX - ci.CanvasWidth / 2) * sx, oy: (ci.CanvasOriginY - ci.CanvasHeight / 2) * sy };
        }
        const bwPx = Math.max(1, (mb[2] - mb[0]) * ci.PixelsPerUnit);
        const bhPx = Math.max(1, (mb[3] - mb[1]) * ci.PixelsPerUnit);
        // 201:contain 恒定(用户修正:模型必须完整显示,任何屏幕形态无裁切区域)——
        //   scale=min(可用宽/模型宽, 可用高/模型高):模型完整放入安全区,短边贴合长边留白居中
        //   ——此前 cover(max)裁切致"不同区域无法显示";触摸/凝视经 _tf 反投影自动跟随
        const scale = Math.min(vw / bwPx, vh / bhPx);          // contain:完整显示,无裁切
        const sx = 2 * ci.PixelsPerUnit * scale / pw, sy = 2 * ci.PixelsPerUnit * scale / ph;
        const cx = (mb[0] + mb[2]) / 2, cy = (mb[1] + mb[3]) / 2;
        const ndcCx = (scx / pw) * 2 - 1;                     // 可用区中心 NDC x
        const ndcCy = 1 - (scy / ph) * 2;                     // 可用区中心 NDC y(翻转)
        return { sx, sy, ox: ndcCx - cx * sx, oy: ndcCy - cy * sy };
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
            gl.bindBuffer(gl.ARRAY_BUFFER, this._vbs[i].pos);
            gl.bufferData(gl.ARRAY_BUFFER, d.vertexPositions[i], gl.DYNAMIC_DRAW);
        }
    }

    _bindEvents() {
        if (this._unsubs.length) return;
        const bus = window.globalEventBus;
        if (!bus) return;
        // 184:onLevel 扩展为 {level, form}——form 为原生 FFT 元音口型估计(-1..1)
        this._unsubs.push(bus.on('tts:level', (e) => {
            this._mouthLevel = Math.max(0, Math.min(1, (e.level || 0) / 60));
            if (typeof e.form === 'number') this._mouthForm = Math.max(-1, Math.min(1, e.form));
        }));
        this._unsubs.push(bus.on('tts:start', () => { this._talking = true; }));
        this._unsubs.push(bus.on('tts:done', () => { this._talking = false; this._mouthLevel = 0; this._mouthForm = 0; }));
        this._unsubs.push(bus.on('ai:mood', (e) => { this.setMood((e && e.mood) || 'normal'); }));
    }

    /** 184:陀螺仪/加速度传感器绑定(deviceorientation 主,devicemotion 兜底)
     *  Android WebView(Chromium)原生支持,无需权限;仅 Live2D 页面开启时生效 */
    _bindSensors() {
        if (this.__sensorsBound) return;
        this.__sensorsBound = true;
        window.addEventListener('deviceorientation', (e) => {
            if (!this._enabled) return;
            if (e.beta === null || e.beta === undefined || e.gamma === null || e.gamma === undefined) return;
            this._onGyroAngles(e.beta, e.gamma);
        }, true);
        window.addEventListener('devicemotion', (e) => {
            if (!this._enabled) return;
            const a = e.accelerationIncludingGravity;
            if (!a || a.x === null) return;
            // orientation 正常供应时跳过(2s 内有事件)
            if (this._gyro.lastT && performance.now() - this._gyro.lastT < 2000) return;
            const norm = Math.hypot(a.x, a.y, a.z) || 9.8;
            const roll = Math.max(-40, Math.min(40, (a.x / norm) * 50));
            const pitch = Math.max(-40, Math.min(40, (a.y / norm - 1) * 50));
            this._gyro.roll += (roll - this._gyro.roll) * 0.1;
            this._gyro.pitch += (pitch - this._gyro.pitch) * 0.1;
            this._gyro.active = true;
        }, true);
    }

    /** 设备轴系→屏幕轴系换算(旋转 90° 倍数时 beta/gamma 对应轴互换)+平滑 */
    _onGyroAngles(beta, gamma) {
        let angle = 0;
        try {
            if (screen.orientation && typeof screen.orientation.angle === 'number') angle = screen.orientation.angle;
            else if (typeof window.orientation === 'number') angle = window.orientation;
        } catch (err) { /* 取不到按 0 处理 */ }
        let sx, sy;
        switch (((Math.round(angle) % 360) + 360) % 360) {
            case 90: sx = beta; sy = -gamma; break;
            case 180: sx = -gamma; sy = -beta; break;
            case 270: sx = -beta; sy = gamma; break;
            default: sx = gamma; sy = beta; break;
        }
        const roll = Math.max(-40, Math.min(40, sx));        // 屏幕平面左右倾(度)
        const pitch = Math.max(-40, Math.min(40, sy - 90));  // 前后倾,直立=0
        this._gyro.roll += (roll - this._gyro.roll) * 0.12;
        this._gyro.pitch += (pitch - this._gyro.pitch) * 0.12;
        // 200:翻转跟随——手机绕视线轴的旋转量(sx,直立系)映射为转身目标角:
        //   直立=0°;左横卧 sx=-90 → 转身 -60°(向左);右横卧 sx=+90 → +60°(向右);
        //   线性插值(±90 内满量程 ±60),turnCur 每帧缓慢趋近(转身有过程感)
        const turnT = Math.max(-60, Math.min(60, sx * (60 / 90)));
        this._gyro.turnTarget = turnT;
        this._gyro.active = true;
        this._gyro.lastT = performance.now();
    }

    /** 184:眼部追踪——原生 GazeBridge(前摄硬件人脸检测)回调入口;页面打开即自动启动。
     *  197:浏览器 fallback——无 Live2DGaze 桥时走 Chromium FaceDetector API + 前摄 getUserMedia,
     *  检测循环 12.5Hz,人脸框中心 → 归一化坐标 → 与原生桥同一 _gazeRaw 通道;
     *  _gazeDebug=true 时显示摄像头预览+识别框(调试);生产仅隐藏 video 跑检测。 */
    _startGaze() {
        if (this._gazeStarted) return;
        const b = window.Live2DGaze;
        if (b && typeof b.startTracking === 'function') {          // Android 原生桥
            this._gazeStarted = true;
            try {
                this._gazeState = String(b.startTracking() || '');
            } catch (e) {
                this._gazeState = 'error';
                console.warn('[Live2D] 眼动追踪启动失败:', e);
            }
            return;
        }
        // 197:浏览器 fallback(Chromium Shape Detection API)——
        //   FaceDetector 为实验性 API,正式版 Chrome 默认禁用(实测 Chrome/146 undefined):
        //   可用时=真检测+识别框;不可用时=降级「中心凝视」(预览窗+中心目标框,凝视恒定指向
        //   摄像头正前方=看向用户,语义正确),状态标 preview-only 如实区分
        this._gazeDetectOK = !!window.FaceDetector;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this._gazeState = 'nocam';
            return;
        }
        this._gazeStarted = true;
        navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
        }).then((stream) => {
            this._gazeStream = stream;
            const v = document.createElement('video');
            v.id = 'gaze-video';
            v.playsInline = true; v.muted = true; v.autoplay = true;
            v.style.cssText = 'position:fixed;right:10px;top:10px;width:192px;height:144px;'
                + 'z-index:500;border:2px solid #0af;border-radius:8px;'
                + 'transform:scaleX(-1);object-fit:cover;background:#000;'
                + (this._gazeDebug ? 'display:block;' : 'display:none;');
            document.body.appendChild(v);
            // 197b:中心目标框(降级模式的凝视目标提示;检测可用时由识别框替代)
            const tgt = document.createElement('div');
            tgt.id = 'gaze-target';
            tgt.style.cssText = 'position:fixed;right:10px;top:10px;width:192px;height:144px;'
                + 'z-index:501;pointer-events:none;display:'
                + (this._gazeDebug ? 'block;' : 'none;');
            tgt.innerHTML = '<div style="position:absolute;left:30%;top:30%;width:40%;height:40%;'
                + 'border:2px dashed #0f0;border-radius:50%;"></div>'
                + '<div style="position:absolute;left:0;top:0;font:10px monospace;color:#0f0;'
                + 'background:rgba(0,0,0,.5);padding:1px 4px;">' + (this._gazeDetectOK ? 'FACE DETECT' : 'CENTER GAZE') + '</div>';
            document.body.appendChild(tgt);
            this._gazeTgtEl = tgt;
            v.srcObject = stream;
            v.play().catch(() => {});
            this._gazeVideo = v;
            // 识别框 overlay(与 video 同区域,内部坐标反向镜像)
            const box = document.createElement('div');
            box.id = 'gaze-box';
            box.style.cssText = 'position:fixed;right:10px;top:10px;width:192px;height:144px;'
                + 'z-index:501;pointer-events:none;display:'
                + (this._gazeDebug ? 'block;' : 'none;');
            const frame = document.createElement('div');
            frame.style.cssText = 'position:absolute;border:2px solid #0f0;border-radius:4px;display:none;';
            box.appendChild(frame);
            document.body.appendChild(box);
            this._gazeBoxEl = frame;
            const det = this._gazeDetectOK
                ? new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 }) : null;
            this._gazeTimer = setInterval(async () => {
                if (!this._enabled || !v.videoWidth) return;
                if (!det) {
                    // 197b:中心凝视降级——凝视恒定指向摄像头正前方(=看向用户)
                    window.Live2DGazeHandler.onGaze(0, 0, true);
                    return;
                }
                try {
                    const faces = await det.detect(v);
                    if (faces.length) {
                        const bb = faces[0].boundingBox;
                        const cx = (bb.x + bb.width / 2) / v.videoWidth;   // 0~1
                        const cy = (bb.y + bb.height / 2) / v.videoHeight;
                        // 前摄镜像(video CSS scaleX(-1)):画面左=真实右 → x 取反保持"右正"语义
                        const nx = (1 - cx) * 2 - 1;
                        const ny = cy * 2 - 1;                             // 下正
                        window.Live2DGazeHandler.onGaze(nx, ny, true);
                        // 识别框(镜像画面内定位:显示 x = 1 - (x+w))
                        if (this._gazeDebug && this._gazeBoxEl) {
                            const fx = (1 - (bb.x + bb.width) / v.videoWidth) * 100;
                            const fy = (bb.y / v.videoHeight) * 100;
                            const fw = (bb.width / v.videoWidth) * 100;
                            const fh = (bb.height / v.videoHeight) * 100;
                            this._gazeBoxEl.style.cssText = 'display:block;left:' + fx + '%;top:' + fy
                                + '%;width:' + fw + '%;height:' + fh + '%;';
                        }
                    } else {
                        window.Live2DGazeHandler.onGaze(0, 0, false);
                        if (this._gazeDebug && this._gazeBoxEl) this._gazeBoxEl.style.display = 'none';
                    }
                } catch (e) { /* 单帧检测失败忽略 */ }
            }, 80);                                                // 12.5Hz 与原生桥一致
        }).catch((e) => {
            this._gazeState = 'denied';
            console.warn('[Live2D] 摄像头授权拒绝:', e);
        });
    }

    _stopGaze() {
        if (!this._gazeStarted) return;
        this._gazeStarted = false;
        this._gazeS.w = 0;
        const b = window.Live2DGaze;
        if (b && typeof b.stopTracking === 'function') {
            try { b.stopTracking(); } catch (e) { /* 忽略 */ }
        }
        // 197:浏览器 fallback 清理(循环/流/视频元素)
        if (this._gazeTimer) { clearInterval(this._gazeTimer); this._gazeTimer = 0; }
        this._gazeCal = null;          // 197:停止时清校准(下次开启重新标定)
        if (this._gazeStream) {
            this._gazeStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
            this._gazeStream = null;
        }
        if (this._gazeVideo) { this._gazeVideo.remove(); this._gazeVideo = null; }
        if (this._gazeBoxEl) { this._gazeBoxEl.parentElement && this._gazeBoxEl.parentElement.remove(); this._gazeBoxEl = null; }
        if (this._gazeTgtEl) { this._gazeTgtEl.remove(); this._gazeTgtEl = null; }
    }

    /** 184:触摸反馈——pointerdown → 命中检测 → 分区 → 反应
     *  命中:点在三角形内测试,按 renderOrders 自上而下(官方 HitTest 语义,取视觉最上层网格) */
    _bindTouch() {
        if (this.__touchBound) return;
        this.__touchBound = true;
        this._canvas.addEventListener('pointerdown', (e) => {
            if (!this._enabled || !this._tf || !this._model) return;
            const rect = this._canvas.getBoundingClientRect();
            const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;   // NDC x∈[-1,1]
            const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1); // NDC y 上正
            const tf = this._tf;
            const mx = (nx - tf.ox) / tf.sx;   // 模型空间坐标
            const my = (ny - tf.oy) / tf.sy;
            this._applyTouch(mx, my);
        }, { passive: true });
    }

    _applyTouch(mx, my) {
        // 命中检测:点在三角形内测试,按 renderOrders 自上而下(官方 HitTest 语义,取视觉最上层网格)
        const hit = this._hitTest(mx, my);
        if (hit === -1) return;                               // 点空(天空/网格间隙)→无反应
        // 192:分区=查被命中三角形的预计算归属(部件级,跟随模型网格)
        const zone = this._zoneOfTri(hit.i, hit.tri);
        const now = performance.now();
        const cd = this._touchCd.get(zone) || 0;
        if (now - cd < 600) return;                          // 同区 600ms 冷却
        this._touchCd.set(zone, now);
        const dur = { head: 1.5, face: 1.7, chest: 1.3, belly: 1.2, arm: 1.4, hand: 1.4, body: 0.9 }[zone] || 1.0;
        this._touchFx = { zone, t0: (performance.now() - this._t0) / 1000, dur, side: Math.sign(hit.wx) || 1 };
        console.log('[Live2D] 触摸:', zone, 'at', hit.wx.toFixed(2), hit.wy.toFixed(2), 'mesh#' + hit.i);
        // 186:AI 根据触摸部位作出反馈回复(表情包络即时反应+AI 语句异步跟进)
        this._aiTouchReply(zone);
    }

    /** 186:触摸→AI 反馈回复:组装部位描述走 aiChatManager 全链路(记忆/人设/情绪),
     *  回复文字显示在 Live2D 浮层气泡+TTS 朗读(口型动画自动驱动)。
     *  节流:全局 10s 冷却+请求中去重——连续抚摸只触发一次 AI,避免刷屏/刷钱。 */
    async _aiTouchReply(zone) {
        const now = Date.now();
        if (now - (this._lastAiTouch || 0) < 10000) return;
        if (this._aiTouchBusy) return;
        const am = window.aiChatManager;
        if (!am || !am.sendMessage) return;
        this._lastAiTouch = now;
        this._aiTouchBusy = true;
        const DESC = {
            head: '（伸出手，轻轻地摸了摸你的头）',
            face: '（伸出手指，轻轻戳了戳你的脸颊）',
            chest: '（手掌轻轻贴上了你的胸口）',
            belly: '（手掌轻轻放在你的腹部）',
            arm: '（轻轻捏了捏你的手臂）',
            hand: '（悄悄伸出手，握住了你的手）',
        };
        const desc = DESC[zone] || '（轻轻碰了碰你）';
        this._bubble('…');
        try {
            const r = await am.sendMessage(desc);
            const text = (r && (r.text || r.content || r.message)) || '';
            if (text && !/⚠/.test(text)) {
                this._bubble(text);
                const tts = window.gameEngine && window.gameEngine.getModule('TTSManager');
                if (tts && tts.enabled) { try { tts.speak(text, 'live2d'); } catch (e) {} }
            } else {
                this._bubble('');
            }
        } catch (e) {
            this._bubble('');
        } finally {
            this._aiTouchBusy = false;
        }
    }

    /** 186:Live2D 浮层气泡(触摸 AI 回复文字) */
    /** 209:气泡统一出口——触摸反馈回复与对话回复共用同一气泡槽(同一位置同一样式,
     *  由 main.js 渲染到 l2-chat-flow);text='…'=思考占位,''=清除。
     *  「仅显示最新一条 AI 回复+10s 无新内容淡出」的计时策略由 main.js 统一管理。 */
    _bubble(text) {
        window.globalEventBus && window.globalEventBus.emit('l2:bubble', { text: text || '' });
    }

    /** 点在三角形内命中检测:按 renderOrders 降序(视觉最上层优先)遍历网格;
     *  tex6=背景大四边形(2 张 4 顶点网格)跳过——否则点天空也会"命中" */
    _hitTest(mx, my) {
        const d = this._model.drawables, m = this._model;
        const ro = m.renderOrders || d.drawOrders;
        const order = [];
        for (let i = 0; i < d.count; i++) order.push(i);
        order.sort((a, c) => ro[c] - ro[a]);   // 高渲染序(最上层)在前
        for (const i of order) {
            if (d.vertexCounts[i] <= 0 || d.opacities[i] <= 0.3) continue;
            if (d.textureIndices[i] === 6) continue;   // 背景大四边形
            const pos = d.vertexPositions[i], idx = d.indices[i];
            for (let t = 0; t + 2 < idx.length; t += 3) {
                const a = idx[t] * 2, b = idx[t + 1] * 2, c = idx[t + 2] * 2;
                if (this._inTri(mx, my, pos[a], pos[a + 1], pos[b], pos[b + 1], pos[c], pos[c + 1])) {
                    // 192:返回命中 drawable + 三角形序号——分区直接查预计算的三角形归属表,
                    //     判定精确到网格三角形(与模型部件一一对应,零矩形近似)
                    return { i, tri: t / 3, wx: (pos[a] + pos[b] + pos[c]) / 3, wy: (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3 };
                }
            }
        }
        return -1;
    }

    /** 分区判定(模型空间几何分区;边界=tests/live2d_zones.js 实测+浏览器实测校准:
     *  双眼中心 y≈0.19,唇本体 y≈0.14~0.22,刘海(tex7)y 0.23~0.48,发顶 y≈0.612;
     *  head/face 分界 0.42(眉上方+上额头+大部分刘海归摸头——0.52 分界经浏览器实测在
     *  cover 全屏下只剩屏顶 5% 条带,几乎点不到,故下调;摸刘海按摸头处理更自然) */
    /** 186 分区重写(用户反馈:点哪都在脖子/胸——旧阈值 |x|>0.30 才算 arm,
     *  而双手 dw0/1 实测 x±0.07~0.21 → 点手全落 chest;脸下缘 -0.01 过高,点下巴也落 chest)。
     *  阈值=顶点实测解剖坐标:眼 0.13~0.22/嘴 -0.06/下巴 -0.08/手 dw0,1(x±0.07~0.21,y-0.23~-0.08)/胸 -0.13~-0.30 */
    _classifyZone(x, y) {
        if (y > 0.28 && Math.abs(x) <= 0.35) return 'head';            // 头顶/发冠(186b:加 x 限制,两侧垂发上部归 arm)
        // 194b:分段定稿(数据断言 13/13 校准)——head 0.28+/face -0.09~0.28/锁骨段无反应/chest -0.35~-0.16/belly -0.50~-0.35/arm 兜底
        if (y > -0.09 && Math.abs(x) <= 0.19) return 'face';           // 脸部(眉毛~下巴,含眼影 y0.27)
        if (this._handTouchEnabled && Math.abs(x) >= 0.05 && Math.abs(x) <= 0.22 && y >= -0.27 && y < -0.16) return 'hand';  // 手部(双手交叠,下半段)
        // 196:胸前向下拓展 1/2(下界 -0.35→-0.445),belly 接管其下全部中轴到底,与 arm 以 |x|=0.26 竖直分界
        if (y > -0.445 && Math.abs(x) <= 0.22) return 'chest';         // 胸前(上段+向下拓展段)
        if (Math.abs(x) <= 0.26) return 'belly';                       // 腹部(腰下~裙摆中轴)
        return 'arm';                                                  // 两侧手臂/袖子/垂发/裙侧
    }

    /** 192:三角形归属预计算——每 drawable 每三角形按其重心跑 _classifyZone,
     *  结果存 Int8Array(0=none 1=head 2=face 3=hand 4=chest 5=arm 6=body)。
     *  用默认姿态顶点标定一次;动画小幅变形不改变三角形归属。
     *  隐藏件(dw0/1 手,op=0)同样标定——_handTouchEnabled 开关关闭时其区域归 chest。 */
    _computeTriangleZones() {
        const d = this._model.drawables;
        this._triZones = [];
        for (let i = 0; i < d.count; i++) {
            const n = Math.floor(d.indices[i].length / 3);
            const tz = new Int8Array(n);
            if (d.vertexCounts[i] > 0) {
                const pos = d.vertexPositions[i], idx = d.indices[i];
                // 193:部件语义覆盖——纯袖子件(91/146/89/90/94/95)整体强制 arm,
                //   其跨胸/腹边界的边缘三角形不再按位置误判 belly/chest
                const override = this._zoneOverride[i];
                for (let t = 0; t < n; t++) {
                    const a = idx[t * 3] * 2, b = idx[t * 3 + 1] * 2, c = idx[t * 3 + 2] * 2;
                    const cx = (pos[a] + pos[b] + pos[c]) / 3, cy = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3;
                    let z = 6;
                    if (d.textureIndices[i] !== 6 && d.opacities[i] > 0.05) {
                        z = this._zoneCode(override || this._classifyZone(cx, cy));
                    }
                    tz[t] = z;
                }
            }
            this._triZones.push(tz);
        }
    }

    _zoneCode(name) {
        return { none: 0, head: 1, face: 2, hand: 3, chest: 4, arm: 5, body: 6, belly: 7 }[name] || 0;
    }

    /** 192:查被命中三角形的分区(命中件无标定时回退重心 classifyZone) */
    _zoneOfTri(i, tri) {
        const tz = this._triZones && this._triZones[i];
        if (!tz || tri >= tz.length) return this._classifyZone(this.__lx || 0, this.__ly || 0);
        const names = ['none', 'head', 'face', 'hand', 'chest', 'arm', 'body', 'belly'];
        return names[tz[tri]] || 'none';
    }

    /** 188:部件级分区判定——按 drawable 顶点包围盒中心(模型空间)归类。
     *  可视化与命中判定共用同一函数,所见色块=部件实际判定结果。
     *  背景(tex6)/透明/空网格返回 null 不着色。 */
    _zoneOfDrawable(i) {
        const d = this._model.drawables;
        if (d.textureIndices[i] === 6) return null;            // 背景大四边形
        if (d.opacities[i] <= 0.05 || d.vertexCounts[i] <= 0) return null;
        const pos = d.vertexPositions[i];
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (let v = 0; v < d.vertexCounts[i]; v++) {
            if (pos[v*2] < x0) x0 = pos[v*2]; if (pos[v*2] > x1) x1 = pos[v*2];
            if (pos[v*2+1] < y0) y0 = pos[v*2+1]; if (pos[v*2+1] > y1) y1 = pos[v*2+1];
        }
        return this._classifyZone((x0 + x1) / 2, (y0 + y1) / 2);
    }

    /** 点在三角形内(重心法);idx 为三角形索引列表 */
    _inTri(px, py, ax, ay, bx, by, cx, cy) {
        const v0x = cx - ax, v0y = cy - ay, v1x = bx - ax, v1y = by - ay, v2x = px - ax, v2y = py - ay;
        const dot00 = v0x * v0x + v0y * v0y, dot01 = v0x * v1x + v0y * v1y, dot02 = v0x * v2x + v0y * v2y;
        const dot11 = v1x * v1x + v1y * v1y, dot12 = v1x * v2x + v1y * v2y;
        const den = dot00 * dot11 - dot01 * dot01;
        if (Math.abs(den) < 1e-12) return false;
        const u = (dot11 * dot02 - dot01 * dot12) / den;
        const v = (dot00 * dot12 - dot01 * dot02) / den;
        return u >= 0 && v >= 0 && u + v <= 1;
    }

    setMood(mood) {
        this._mood = mood;
        const T = this._moodTargets;
        Object.keys(T).forEach(k => delete T[k]);
        // 205:表情增强——眉/眼/口型/眯眼笑/脸颊红晕完整组合,对话回复情绪可读性更高
        if (mood === 'happy' || mood === 'love') {
            T.ParamMouthForm = 0.9; T.ParamEyeLOpen = 0.75; T.ParamEyeROpen = 0.75;
            T.ParamEyeSmile = 0.8; T.ParamCheek = (mood === 'love' ? 0.6 : 0.45);
        } else if (mood === 'sad') {
            T.ParamMouthForm = -0.5; T.ParamBrowLY = -0.5; T.ParamBrowRY = -0.5; T.ParamEyeLOpen = 0.6; T.ParamEyeROpen = 0.6;
        } else if (mood === 'angry') {
            T.ParamMouthForm = -0.7; T.ParamBrowLY = -0.8; T.ParamBrowRY = -0.8;
        } else if (mood === 'surprised') {
            T.ParamEyeLOpen = 1.3; T.ParamEyeROpen = 1.3; T.ParamMouthOpenY = 0.5;
        } else if (mood === 'shy') {
            T.ParamMouthForm = 0.4; T.ParamEyeLOpen = 0.6; T.ParamEyeROpen = 0.6;
            T.ParamEyeSmile = 0.7; T.ParamCheek = 0.8;
        }
    }

    _setParam(name, v) {
        const i = this._paramIdx[name];
        if (i === undefined || i < 0) return;
        const p = this._model.parameters;
        p.values[i] = Math.max(p.minimumValues[i], Math.min(p.maximumValues[i], v));
    }

    _resize() {
        const c = this._canvas;
        if (!c || !this._gl) return;
        const r = c.parentElement.getBoundingClientRect();
        // 186:布局未完成(rect 为 0)时跳过——否则 canvas 固化 1×1,之后无 resize 事件永不恢复
        //   (浏览器诊断页实测踩坑:整幅渲染全黑的元凶)
        if (r.width < 2 || r.height < 2) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        c.width = Math.max(1, Math.round(r.width * dpr));
        c.height = Math.max(1, Math.round(r.height * dpr));
        this._gl.viewport(0, 0, c.width, c.height);
    }

    _start() {
        if (this._enabled || this._destroyed) return;
        this._enabled = true;
        this._resize();
        this._loop();
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

        // —— 204:包围盒一次标定后冻结(修复缩放抖动)——201 曾每 2s 重测 bbox:
        //   呼吸/摆动使顶点边界微变 → contain scale 随之跳变 → 模型忽大忽小。
        //   bbox 固定为 _loadModel 默认姿态标定值(自带 2% 收边余量容呼吸起伏,
        //   转身只收窄轮廓不会超出);scale 仅随视口/安全区变化(resize 重算),帧间恒定。
        //   _zoneTex 为模型空间纹理(与 _tf 解耦),bbox 冻结后无需失效重建。

        // —— 184:全屏 cover 变换(蒙版/主绘制/触摸反投影共用) ——
        this._tf = this._calcTransform();

        // —— 程序化动作(呼吸/游移)+陀螺仪叠加+凝视跟随 ——
        // 205:睡觉状态=呼吸放慢(3.6s→6.5s 深睡节奏)+身体摆动抑制到 1/4
        const S = this._sleeping;
        const swayK = S ? 0.25 : 1;
        this._setParam('ParamBreath', (Math.sin(t * Math.PI * 2 / (S ? 6.5 : 3.6)) + 1) / 2);
        let ax = Math.sin(t * 0.55) * 7 * swayK, ay = Math.sin(t * 0.4 + 1) * 4 * swayK, az = Math.sin(t * 0.31 + 2) * 3 * swayK;
        let bx = Math.sin(t * 0.42) * 3.5 * swayK;
        // 陀螺仪:手机摆动 → 头/身摆动(±范围内叠加,值域交由 _setParam 钳制)
        //   物理引擎(官方 physics3.json)以 ParamAngle* 为输入驱动发梢/衣物自然摆动
        const gy = this._gyro;
        if (gy.active) {
            if (gy.lastT && performance.now() - gy.lastT > 3000) {
                gy.roll *= 0.95; gy.pitch *= 0.95;            // 传感器停报时缓慢回正
                gy.turnTarget *= 0.95;                        // 200:停报时转身目标缓慢回正
            }
            ax += gy.roll * 0.55;
            ay += gy.pitch * 0.5;
            az += gy.roll * 0.2;
            bx += gy.roll * 0.35;
            // 200:①左右摆动——身体+头部同向倾斜加强(手机左右摆=角色左右摆的位移感)
            bx += gy.roll * 0.25;                             // 身体 X 附加倾斜(总量 0.6/度)
            az += gy.roll * 0.1;                              // 头部 Z 附加倾斜
            // 200:②翻转跟随——turnCur 每帧缓慢趋近 turnTarget(2°/帧@60fps≈2s 转 60°)
            gy.turnCur += (gy.turnTarget - gy.turnCur) * 0.03;
            ay += gy.turnCur;                                 // ParamAngleY 转身(模型左右转)
        }
        // 凝视平滑:摄像头人脸位置 → 眼球+头部跟随(w 为可信度权重,快进慢出)
        const gr = this._gazeRaw, gs = this._gazeS;
        const fresh = gr.t && performance.now() - gr.t < 1500;
        const targetW = (fresh && gr.found) ? 1 : 0;
        gs.w += (targetW - gs.w) * (targetW > gs.w ? 0.06 : 0.02);
        if (fresh && gr.found) {
            gs.x += (Math.max(-1, Math.min(1, gr.x)) - gs.x) * 0.18;
            gs.y += (Math.max(-1, Math.min(1, -gr.y)) - gs.y) * 0.18;   // 原生 y 向下 → 模型向上翻转
        }
        if (gs.w > 0.01) {
            ax += gs.x * 9 * gs.w;
            ay += gs.y * 7 * gs.w;
        }
        this._setParam('ParamAngleX', ax);
        this._setParam('ParamAngleY', ay);
        this._setParam('ParamAngleZ', az);
        this._setParam('ParamBodyAngleX', bx);
        this._setParam('ParamBodyAngleY', gy.active ? gy.pitch * 0.25 : 0);
        this._setParam('ParamBodyAngleZ', gy.active ? gy.roll * 0.3 : 0);

        // —— 眼球:凝视优先,无凝视时轻微游移 ——
        let ex, ey;
        if (gs.w > 0.3) { ex = gs.x * gs.w; ey = gs.y * gs.w; }
        else { ex = Math.sin(t * 0.3) * 0.08; ey = Math.sin(t * 0.23 + 1) * 0.05; }
        if (S) { ex = 0; ey = 0; }   // 205:睡觉不追视也不游移

        // —— 眨眼(205:睡觉时不眨,双眼保持闭合) ——
        if (!S && t > this._blinkAt) {
            this._blinkAt = t + 2.8 + Math.random() * 2.4;
            this._blinkT = t + 0.26;
        }
        let eye = 1;
        if (S) { eye = 0; }
        else if (this._blinkT) {
            const ph = (this._blinkT - t) / 0.26;
            eye = Math.abs(ph - 0.5) * 2;
            if (t > this._blinkT) { eye = 1; this._blinkT = 0; }
        }
        const T = S ? {} : this._moodTargets;   // 205:睡觉时 mood 表情挂起
        this._setParam('ParamEyeLOpen', T.ParamEyeLOpen !== undefined ? T.ParamEyeLOpen : eye);
        this._setParam('ParamEyeROpen', T.ParamEyeROpen !== undefined ? T.ParamEyeROpen : eye);
        this._setParam('ParamBrowLY', T.ParamBrowLY !== undefined ? T.ParamBrowLY : 0);
        this._setParam('ParamBrowRY', T.ParamBrowRY !== undefined ? T.ParamBrowRY : 0);

        // —— 184:口型=TTS 频谱驱动(开合度 RMS 快起慢落包络 + 元音口型 form) ——
        let mouth = 0, form;
        if (this._talking) {
            const lvl = this._mouthLevel;
            // 快起(≈2 帧)慢落(≈5 帧):口型随语音节奏开合而非机械一开一闭
            this._mouthOpen += (lvl - this._mouthOpen) * (lvl > this._mouthOpen ? 0.55 : 0.25);
            mouth = this._mouthOpen;
            // 元音口型:低频强(a/o,form 正=开口) vs 中频强(i/e,form 负=扁口);
            // 与 mood 微笑/委屈口型混合(说话时语音主导,205:mood 权重 0.3→0.4 表情更明显)
            const moodF = T.ParamMouthForm !== undefined ? T.ParamMouthForm : 0;
            form = this._mouthForm * 0.6 + moodF * 0.4;
        } else {
            this._mouthOpen += (0 - this._mouthOpen) * 0.3;
            form = T.ParamMouthForm !== undefined ? T.ParamMouthForm : 0.15;
        }
        if (T.ParamMouthOpenY !== undefined) mouth = Math.max(mouth, T.ParamMouthOpenY * 0.6);

        // —— 184:触摸反应包络(升 0.12s-持-落 0.35s),叠加到上述参数 ——
        let smile = 0, cheek = 0, browAdd = 0, bodyZ = 0, mouthFormAdd = 0, mouthAdd = 0, exAdd = 0, azAdd = 0, bxAdd = 0, eyAdd = 0, ayAdd = 0;
        const fx = this._touchFx;
        let fxW = 0;
        if (fx) {
            const dt = t - fx.t0;
            if (dt > fx.dur) { this._touchFx = null; }
            else {
                const rel = dt / fx.dur;
                fxW = rel < 0.1 ? rel / 0.1 : (rel > 0.75 ? (1 - rel) / 0.25 : 1);
                fxW = Math.max(0, Math.min(1, fxW));
                switch (fx.zone) {
                    case 'head':       // 摸头:眯眼笑+开心嘴型+轻微慢速摆动(满足感)
                        smile = fxW;
                        mouthFormAdd = 0.85 * fxW;
                        azAdd = Math.sin(dt * 2.2) * 1.6 * fxW;   // 197:9rad/s±5°→2.2rad/s±1.6°(轻微慢速)
                        break;
                    case 'face':       // 197 摸脸:向下看+嘴唇微张+头部轻微左右转动
                        eyAdd = -0.3 * fxW;                // EyeBallY 向下
                        mouthAdd = 0.1 * fxW;              // 嘴唇微张
                        ayAdd = Math.sin(dt * 6) * 3 * fxW; // 头部轻微左右转动(AngleY 振荡)
                        break;
                    case 'chest':      // 197 摸胸:眉微蹙+脸红+眼神慌乱游移+身体轻微后躲
                        browAdd = -0.2 * fxW;
                        cheek = fxW;
                        exAdd = Math.sin(dt * 13) * 0.25 * fxW;   // EyeBallX 慌乱游移(高频小幅)
                        eyAdd = Math.cos(dt * 11) * 0.2 * fxW;    // EyeBallY 慌乱游移
                        bxAdd = 4 * fxW;                           // 身体轻微向后躲闪
                        break;
                    case 'belly':      // 197 摸腹:眼睛亮起(EyeSmile 近似)+嘴角上扬+身体前倾
                        smile = fxW;
                        mouthFormAdd = 0.6 * fxW;
                        bxAdd = -5 * fxW;                          // 身体前倾(BodyAngleX-5)
                        break;
                    case 'arm':       // 摸手/手臂:侧身靠近+微笑+头倾向触摸侧+眼神看向触摸侧
                        bxAdd = 4 * fxW * fx.side;
                        azAdd = -4 * fxW * fx.side;
                        mouthFormAdd = 0.5 * fxW;
                        exAdd = 0.3 * fxW * fx.side;
                        break;
                    default:         // 其他部位:轻微侧身
                        bxAdd = 3 * fxW * fx.side;
                }
            }
        }
        // 205:mood 表情增强——眯眼笑/脸颊红晕与触摸反应取更深(开心/害羞/恋爱自动带红晕)
        this._setParam('ParamEyeLSmile', Math.max(0, smile, T.ParamEyeSmile || 0));
        this._setParam('ParamEyeRSmile', Math.max(0, smile, T.ParamEyeSmile || 0));
        this._setParam('ParamCheek', Math.max(0, cheek, T.ParamCheek || 0));
        // 眉毛(触摸反应与 mood 取更深)
        const pl = this._model.parameters, pi = this._paramIdx;
        if (pi.ParamBrowLY >= 0) pl.values[pi.ParamBrowLY] = Math.max(-1, Math.min(1, pl.values[pi.ParamBrowLY] + browAdd));
        if (pi.ParamBrowRY >= 0) pl.values[pi.ParamBrowRY] = Math.max(-1, Math.min(1, pl.values[pi.ParamBrowRY] + browAdd));
        if (bodyZ) this._setParam('ParamBodyAngleZ', (pl.values[pi.ParamBodyAngleZ] || 0) + bodyZ);
        if (azAdd) this._setParam('ParamAngleZ', (pl.values[pi.ParamAngleZ] || 0) + azAdd);
        if (ayAdd) this._setParam('ParamAngleY', (pl.values[pi.ParamAngleY] || 0) + ayAdd);
        if (bxAdd) this._setParam('ParamBodyAngleX', (pl.values[pi.ParamBodyAngleX] || 0) + bxAdd);
        mouth = Math.max(mouth, mouthAdd);
        form = Math.max(-1, Math.min(1, form + mouthFormAdd));
        ex = Math.max(-1, Math.min(1, ex + exAdd));
        ey = Math.max(-1, Math.min(1, ey + eyAdd));
        this._setParam('ParamMouthOpenY', mouth);
        this._setParam('ParamMouthForm', form);
        this._setParam('ParamEyeBallX', ex);
        this._setParam('ParamEyeBallY', ey);

        m.update();
        this._uploadPositions();

        // —— 蒙版组预渲染(官方 FBO 方案;每帧重算因顶点随动画变化) ——
        this._maskCache = new Map();
        this._renderMaskGroups(this._collectMaskGroups());

        // —— 绘制 ——
        gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        const d = m.drawables;
        const tf = this._tf;
        const P = this._prog;
        gl.useProgram(P.prog);
        gl.uniform2f(P.uScale, tf.sx, tf.sy);
        gl.uniform2f(P.uOffset, tf.ox, tf.oy);
        gl.uniform1i(P.uTex, 0);
        gl.uniform1i(P.uMask, 1);
        gl.uniform1f(P.uUseMask, 0);
        gl.uniform4f(P.uClipRect, -1, -1, 1, 1);
        gl.activeTexture(gl.TEXTURE0);

        const order = [];
        for (let i = 0; i < d.count; i++) order.push(i);
        // 178 根修:renderOrders 挂在 Model 上(动态渲染序,官方语义),Drawables 上只有静态 drawOrders
        // ——此前 d.renderOrders 恒为 undefined,首帧排序即抛 Cannot read '1'(TimSort 首比较先读下标1),
        // 且异常被 openPage 的 try 捕获误标为「初始化失败」。Core 6.x 实测确认。
        const ro = m.renderOrders || d.drawOrders;
        order.sort((a, c) => ro[a] - ro[c]);
        for (const i of order) {
            const vc = d.vertexCounts[i];
            if (vc <= 0 || d.opacities[i] <= 0.01) continue;
            gl.bindBuffer(gl.ARRAY_BUFFER, this._vbs[i].pos);
            gl.enableVertexAttribArray(P.aPos);
            gl.vertexAttribPointer(P.aPos, 2, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, this._vbs[i].uv);
            gl.enableVertexAttribArray(P.aUv);
            gl.vertexAttribPointer(P.aUv, 2, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._vbs[i].ib);
            // 180:蒙版循环会改 aUv 绑定,主绘制前重绑自身 uv 防漂移
            gl.vertexAttribPointer(P.aUv, 2, gl.FLOAT, false, 0, 0);
            gl.bindTexture(gl.TEXTURE_2D, this._textures[d.textureIndices[i]] || this._textures[0]);
            gl.uniform1f(P.uOpacity, d.opacities[i]);
            if (d.multiplyColors) {
                // 158:RGBA 4 分量步长(实测 536=4×134),取 RGB
                gl.uniform3f(P.uMultiply, d.multiplyColors[i * 4], d.multiplyColors[i * 4 + 1], d.multiplyColors[i * 4 + 2]);
            } else {
                gl.uniform3f(P.uMultiply, 1, 1, 1);
            }
            const bm = d.blendModes ? d.blendModes[i] : 0;
            if (bm === 1) gl.blendFunc(gl.ONE, gl.ONE);
            else if (bm === 2) gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
            else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            // 181:蒙版=FBO 采样(官方方案);无蒙版 drawable 用全屏 ClipRect 防 vs 除零
            if (d.maskCounts[i] > 0) {
                const arr = Array.from(d.masks[i].slice(0, d.maskCounts[i])).sort((a, c) => a - c);
                const g = this._maskCache.get(arr.join(','));
                if (g && g.clip && g.fboOk !== false) {
                    gl.uniform4f(P.uClipRect, g.clip[0], g.clip[1], g.clip[2], g.clip[3]);
                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(gl.TEXTURE_2D, g.fbo.tex);
                    gl.uniform1i(P.uMask, 1);
                    gl.uniform1f(P.uUseMask, 1);
                } else {
                    gl.uniform1f(P.uUseMask, 0);
                }
            } else {
                gl.uniform4f(P.uClipRect, -1, -1, 1, 1);
                gl.uniform1f(P.uUseMask, 0);
            }
            gl.drawElements(gl.TRIANGLES, this._vbs[i].ic, gl.UNSIGNED_SHORT, 0);
            if (d.maskCounts[i] > 0) {
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, null);
                gl.activeTexture(gl.TEXTURE0);
            }
        }
        // 182:蒙版诊断模式开启时覆盖显示蒙版纹理
        if (this.__maskDebugIdx > 0) this._drawMaskDebug();
        // 189:双手强制可见——moc3 内 dw0/1 恒 opacity=0 且无参数可驱动(65 参数全扫描确认),
        //  顶点/UV/贴图实测正常;渲染器层以 opacity=1 叠加绘制
        // 190:默认隐藏(this._handsVisible=false)——模型默认姿态无可见手;置 true 即恢复显示
        if (this._handsVisible) {
            gl.useProgram(P.prog);
            gl.uniform1f(P.uOpacity, 1);
            gl.uniform3f(P.uMultiply, 1, 1, 1);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.activeTexture(gl.TEXTURE0);
            for (const hi of this._handIds) {
                gl.bindBuffer(gl.ARRAY_BUFFER, this._vbs[hi].pos);
                gl.enableVertexAttribArray(P.aPos); gl.vertexAttribPointer(P.aPos, 2, gl.FLOAT, false, 0, 0);
                gl.bindBuffer(gl.ARRAY_BUFFER, this._vbs[hi].uv);
                gl.enableVertexAttribArray(P.aUv); gl.vertexAttribPointer(P.aUv, 2, gl.FLOAT, false, 0, 0);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._vbs[hi].ib);
                gl.bindTexture(gl.TEXTURE_2D, this._textures[d.textureIndices[hi]] || this._textures[0]);
                gl.drawElements(gl.TRIANGLES, this._vbs[hi].ic, gl.UNSIGNED_SHORT, 0);
            }
        }
        // 186:触摸分区可视化(半透明色块叠加,边界=真实判定逻辑)
        if (this._zoneDebug) this._drawZoneDebug();
        // 182:蒙版 FBO 帧末回收(防泄漏)——_collectMaskGroups 每帧新建组对象,fbo 若不回收
        //   则每帧每组 createTexture+createFramebuffer(17组×60fps≈千级FBO/秒),移动端
        //   数分钟 GPU 内存耗尽触发 context lost(真机 Bata10 曾观测 drawingBuffer=0×0);
        //   归还 pool 后各帧循环复用,稳定持有 17 组缓冲
        for (const g of this._maskCache.values()) {
            if (g.fbo) { this._maskFboPool.push(g.fbo); g.fbo = null; }
        }
    }
}

window.Live2DSystem = Live2DSystem;
window.live2dSystem = new Live2DSystem();

/** 184:原生 GazeBridge(Live2DGaze)的 JS 回调入口——
 *  onGaze(x, y, found):人脸归一化屏幕坐标 x∈[-1,1](右正) y∈[-1,1](下正);found=是否检出
 *  onState(state):granted/denied/nocam/unsupported/error */
window.Live2DGazeHandler = {
    /** 197:Zero Pose 校准——检测到人脸的前 2.5s 累积平均=用户正对屏幕的基准姿态;
     *  后续每帧输出(raw - zero)=有符号偏移;人脸丢失 3s 重置校准。
     *  修复"检测到人脸就固定右偏":人脸初始位置不在画面正中时,
     *  无校准的归一化坐标恒偏一侧(真机 [0,2] 域错误+初始偏位双重来源)。 */
    onGaze: function (x, y, found) {
        const s = window.live2dSystem;
        const now = performance.now();
        if (!found) {
            // 人脸丢失 3s → 重置校准(下次检出重新标定)
            if (s._gazeLastSeen && now - s._gazeLastSeen > 3000) s._gazeCal = null;
            s._gazeRaw.found = false; s._gazeRaw.t = now;
            return;
        }
        s._gazeLastSeen = now;
        const c = s._gazeCal || (s._gazeCal = { sumX: 0, sumY: 0, n: 0, zx: 0, zy: 0, done: false, start: now });
        if (!c.done) {
            if (now - c.start < 2500) { c.sumX += x; c.sumY += y; c.n++; return; }   // 校准窗内不输出
            if (c.n > 0) { c.zx = c.sumX / c.n; c.zy = c.sumY / c.n; }
            c.done = true;
            console.log('[Live2D] Zero Pose 校准完成: (' + c.zx.toFixed(3) + ', ' + c.zy.toFixed(3) + ')');
        }
        // Zero Pose 偏移(有符号,[-1,1] 域内相减后 clamp)
        const dx = Math.max(-1, Math.min(1, x - c.zx));
        const dy = Math.max(-1, Math.min(1, y - c.zy));
        s._gazeRaw.x = dx; s._gazeRaw.y = dy;
        s._gazeRaw.found = true; s._gazeRaw.t = now;
        // 197:调试数据链(每 600ms 一条,raw→镜像→归一化→ZeroPose 偏移→最终写入)
        if (s._gazeDebug && now - (s.__gazeLogT || 0) > 600) {
            s.__gazeLogT = now;
            console.log('[Live2D] 凝视链路: raw=(' + x.toFixed(3) + ',' + y.toFixed(3) + ')'
                + ' zero=(' + c.zx.toFixed(3) + ',' + c.zy.toFixed(3) + ')'
                + ' offset=(' + dx.toFixed(3) + ',' + dy.toFixed(3) + ')'
                + ' → EyeBall 目标=(' + dx.toFixed(2) + ',' + (-dy).toFixed(2) + ')');
        }
    },
    onState: function (state) {
        const sys = window.live2dSystem;
        sys._gazeState = String(state);
        if (state === 'denied' && sys._enabled) {
            sys._status('（未授权摄像头，眼动追踪未开启）');
            setTimeout(() => { if (sys._enabled) sys._status(''); }, 2600);
        }
        console.log('[Live2D] 眼动追踪状态:', state);
    }
};

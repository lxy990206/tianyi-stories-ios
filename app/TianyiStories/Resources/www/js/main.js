/**
 * 天依物语 主入口
 * 启动菜单 -> 性别选择 -> 玩家信息 -> 进入游戏
 * 完整游戏循环：时间推进 / 好感 / 信任 / AI 对话 / 记忆
 */
'use strict';

// ============= 全局错误捕获 =============
window.onerror = function (message, source, lineno, colno, error) {
    console.error('[全局错误]', { message, source, line: lineno, column: colno, error, stack: error?.stack });
    return false;
};
window.addEventListener('unhandledrejection', e => console.error('[未处理的 Promise 拒绝]', e.reason));

let gameEngine = null;
let gameData = null;
let isGameInitialized = false;
let gameMode = null;

// ============= 启动菜单 =============
async function showStartMenu() {
    const loading = document.getElementById('loading-screen');
    const startMenu = document.getElementById('start-menu');
    const game = document.getElementById('game-container');
    if (loading) loading.style.display = 'none';
    if (startMenu) startMenu.style.display = 'flex';
    if (game) game.style.display = 'none';
    await checkSaveData();
}

// ============= 存档检查 =============
async function checkSaveData() {
    try {
        const slotMgr = window.saveSlotManager || new SaveSlotManager();
        window.saveSlotManager = slotMgr;
        const metadata = await slotMgr.getSlotMetadata();
        const hasAnySave = Object.values(metadata.slots).some(s => s.exists);
        const continueBtn = document.getElementById('continue-game-btn');
        if (continueBtn) {
            continueBtn.disabled = !hasAnySave;
            continueBtn.textContent = hasAnySave ? '继续游戏' : '无存档';
        }
    } catch (e) {
        console.warn('存档检查失败:', e);
        const continueBtn = document.getElementById('continue-game-btn');
        if (continueBtn) {
            continueBtn.disabled = true;
            continueBtn.textContent = '检查失败';
        }
    }
}

function hideStartMenu() {
    document.getElementById('start-menu').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
}

// ============= 存档位选择 =============
async function showSlotSelectionModal(mode) {
    return new Promise(async resolve => {
        const modal = document.getElementById('save-slot-modal');
        const title = document.getElementById('save-slot-title');
        const list = document.getElementById('save-slot-list');
        const closeBtn = document.getElementById('save-slot-close-btn');
        if (!modal) return resolve(null);
        title.textContent = mode === 'new' ? '选择存档位' : '选择存档';
        list.innerHTML = '';
        const metadata = await window.saveSlotManager.getSlotMetadata();
        const newClose = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newClose, closeBtn);
        newClose.onclick = () => { modal.style.display = 'none'; resolve(null); };
        for (let i = 1; i <= metadata.maxSlots; i++) {
            const slot = metadata.slots[i];
            const card = document.createElement('div');
            card.className = `save-slot-card ${slot.exists ? 'occupied' : 'empty'}`;
            if (slot.exists) {
                const genderIcon = slot.gender === 'sister' ? '♀' : '♂';
                card.innerHTML = `
                    <div class="slot-header">
                        <span class="slot-number">存档 ${i}</span>
                        <button class="slot-delete-btn" data-slot="${i}">&times;</button>
                    </div>
                    <div class="slot-info">
                        <span>${slot.playerName || '未命名'} ${genderIcon}</span>
                        <span>第${slot.day || 1}天</span>
                        <span>好感度: ${Math.round(slot.affection || 0)}</span>
                    </div>
                    <div class="slot-time">最后游玩: ${new Date(slot.lastPlayed).toLocaleString('zh-CN')}</div>
                `;
                card.onclick = (e) => {
                    if (e.target.classList.contains('slot-delete-btn')) return;
                    modal.style.display = 'none';
                    resolve(i);
                };
                card.querySelector('.slot-delete-btn').onclick = async (e) => {
                    e.stopPropagation();
                    if (confirm(`确定删除存档 ${i} 吗？`)) {
                        await window.saveSlotManager.deleteSlot(i);
                        resolve(await showSlotSelectionModal(mode));
                    }
                };
            } else {
                card.innerHTML = `<div class="slot-header"><span class="slot-number">存档 ${i}</span></div><div class="slot-empty">空</div>`;
                if (mode === 'new') card.onclick = () => { modal.style.display = 'none'; resolve(i); };
                else card.classList.add('disabled');
            }
            list.appendChild(card);
        }
        modal.style.display = 'flex';
    });
}

// ============= 性别选择 =============
function showGenderSelectionDialog() {
    return new Promise(resolve => {
        const modal = document.getElementById('gender-selection-modal');
        if (!modal) return resolve('brother');
        modal.style.display = 'flex';
        const b = document.getElementById('select-brother-btn');
        const s = document.getElementById('select-sister-btn');
        const cleanup = () => {
            b.replaceWith(b.cloneNode(true));
            s.replaceWith(s.cloneNode(true));
        };
        document.getElementById('select-brother-btn').onclick = () => { modal.style.display = 'none'; resolve('brother'); cleanup(); };
        document.getElementById('select-sister-btn').onclick = () => { modal.style.display = 'none'; resolve('sister'); cleanup(); };
    });
}

// ============= 玩家信息 =============
function showPlayerInfoDialog() {
    return new Promise(resolve => {
        const modal = document.getElementById('player-info-modal');
        if (!modal) return resolve(null);
        modal.style.display = 'flex';
        const nameInput = document.getElementById('player-name-input');
        const monthSel = document.getElementById('player-birthday-month');
        const daySel = document.getElementById('player-birthday-day');
        const err = document.getElementById('player-info-error');
        let selectedIdentity = null;

        // 填充月份
        for (let m = 1; m <= 12; m++) {
            const opt = document.createElement('option');
            opt.value = String(m).padStart(2, '0');
            opt.textContent = `${m}月`;
            monthSel.appendChild(opt);
        }
        const updateDays = () => {
            const m = parseInt(monthSel.value);
            daySel.innerHTML = '<option value="">日期</option>';
            if (!m) return;
            const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
            for (let d = 1; d <= max; d++) {
                const opt = document.createElement('option');
                opt.value = String(d).padStart(2, '0');
                opt.textContent = `${d}日`;
                daySel.appendChild(opt);
            }
        };
        monthSel.onchange = updateDays;

        const identityBtns = ['student', 'working', 'freelance'].map(id => document.getElementById(`identity-${id}-btn`));
        identityBtns.forEach(btn => btn.onclick = () => {
            identityBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedIdentity = btn.dataset.identity;
            err.style.display = 'none';
        });

        document.getElementById('player-info-confirm-btn').onclick = async () => {
            const name = nameInput.value.trim();
            const data = { name, birthday: monthSel.value && daySel.value ? `${monthSel.value}-${daySel.value}` : '', identity: selectedIdentity };
            const v = window.playerInfoManager.validateAll(data);
            if (!v.valid) { err.textContent = v.error; err.style.display = 'block'; return; }
            const saved = await window.playerInfoManager.savePlayerInfo(data);
            modal.style.display = 'none';
            resolve(saved);
        };
        document.getElementById('player-info-skip-btn').onclick = async () => {
            await window.playerInfoManager.markAsSkipped();
            modal.style.display = 'none';
            resolve(null);
        };
    });
}

// ============= 开始新游戏 =============
async function startNewGame() {
    const slotId = await showSlotSelectionModal('new');
    if (!slotId) return;
    await setAllManagerSlots(slotId, true);
    const gender = await showGenderSelectionDialog();
    if (window.genderManager) window.genderManager.setGender(gender);
    const info = await showPlayerInfoDialog();
    if (window.saveManager) await window.saveManager.clearSave();
    gameMode = 'new';
    window.gameMode = 'new';
    hideStartMenu();
    initGame();
}

async function startContinueGame() {
    const slotId = await showSlotSelectionModal('continue');
    if (!slotId) return;
    await setAllManagerSlots(slotId, false);
    gameMode = 'continue';
    window.gameMode = 'continue';
    hideStartMenu();
    initGame();
}

async function setAllManagerSlots(slotId, isNewGame) {
    await window.saveSlotManager.setActiveSlot(slotId);
    if (window.saveManager) window.saveManager.setSlot(slotId);
    if (window.promptStorage) {
        window.promptStorage.setSlot(slotId);
        await window.promptStorage.initializeDefaultPrompts(isNewGame);
    }
    if (window.diaryStorage) window.diaryStorage.setSlot(slotId);
}

// ============= 性能适配工具(1.1.12/134) =============

/** 聊天 DOM 上限:长会话气泡无限增长会推高低端机内存与 GC 频率;
 *  内存优化档(perfMemoryOn)保留 40 条,常规 300 条,超限裁剪最旧(防抖 300ms) */
(function installChatDomCap() {
    const el = document.getElementById('chat-messages');
    if (!el || typeof MutationObserver === 'undefined') return;
    let timer = null;
    const cap = () => {
        const max = (window.__perfMemoryOn === true) ? 40 : 300;
        while (el.children.length > max) el.removeChild(el.firstElementChild);
    };
    new MutationObserver(() => {
        if (timer) return;
        timer = setTimeout(() => { timer = null; cap(); }, 300);
    }).observe(el, { childList: true });
})();

/** 开场图降采样解码(内存优化档):1600×2848 原图解码约 18MB/张,
 *  canvas 缩到 ≤720 宽(~3.7MB),文件不动,仅降低解码驻留 */
const _storyImgCache = {};
function scaledStoryBg(url) {
    if (window.__perfMemoryOn !== true) return Promise.resolve(url);
    if (_storyImgCache[url]) return Promise.resolve(_storyImgCache[url]);
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            try {
                const scale = Math.min(1, 720 / img.width);
                const c = document.createElement('canvas');
                c.width = Math.round(img.width * scale);
                c.height = Math.round(img.height * scale);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                _storyImgCache[url] = c.toDataURL('image/jpeg', 0.8);
                resolve(_storyImgCache[url]);
            } catch (_) { resolve(url); }
        };
        img.onerror = () => resolve(url);
        img.src = url;
    });
}

// ============= 初始化游戏 =============
async function initGame() {
    try {
        // 设备真实能力分级(智能适配/华强北防伪):内核级数据源计算 tier 并落
        // html.low-perf/.ultra-low,见 DeviceTier.js;浏览器无桥时保持 compat.js 启发式
        if (window.DeviceTier) window.DeviceTier.init();
        showLoadingScreen();
        // 注册多重人格（服装绑定人格）
        if (window.personaManager) {
            const personas = [
                ['default', 'js/AI/personas/tianyi-base.json'],
                ['sailor', 'js/AI/personas/tianyi-sailor.json'],
                ['maid', 'js/AI/personas/tianyi-maid.json'],
                ['qipao', 'js/AI/personas/tianyi-qipao.json'],
                ['winter', 'js/AI/personas/tianyi-winter.json'],
                ['sports', 'js/AI/personas/tianyi-sports.json'],
                ['pajamas', 'js/AI/personas/tianyi-pajamas.json'],
                ['wedding', 'js/AI/personas/tianyi-wedding.json'],
                ['stage', 'js/AI/personas/tianyi-stage.json'],
                ['school', 'js/AI/personas/tianyi-school.json']
            ];
            personas.forEach(([id, path]) => {
                window.personaManager.register(id, path);
            });
        }
        // 初始化 AI
        // 211:桥接初始化浏览器环境可能抛错——try/catch 防御,失败不阻断 boot
        //     (真机桥可用时行为不变;纯浏览器继续完成引擎构建)
        try { if (window.aiChatManager) await window.aiChatManager.init(); }
        catch (e) { console.warn('[启动] AI 初始化跳过(浏览器环境):', e && e.message); }
        // 初始化记忆
        try { if (window.memoryBridge) await window.memoryBridge.init(); }
        catch (e) { console.warn('[启动] 记忆桥初始化跳过(浏览器环境):', e && e.message); }

        // 构建引擎
        gameEngine = new GameEngine();
        window.gameEngine = gameEngine;
        const resourceLoader = new ResourceLoader();
        resourceLoader.loadDefaultResources();
        await new Promise(r => resourceLoader.loadAll(() => {}, r));

        // SaveManager
        let saveManager = window.saveManager || new SaveManager();
        window.saveManager = saveManager;
        // 从 SaveSlotManager 同步当前选中的存档槽
        if (window.saveSlotManager) {
            const activeSlot = window.saveSlotManager.getActiveSlotId?.();
            if (activeSlot) saveManager.setSlot(activeSlot);
        }
        await saveManager.init();
        await saveManager.initializeLongTermMemory();

        // 加载 / 新建游戏数据
        if (gameMode === 'continue') {
            gameData = await saveManager.loadGame();
        }
        if (!gameData) {
            gameData = createDefaultGameData();
        }

        // 初始化所有系统
        const audioManager = new AudioManager();
        const ttsManager = new TTSManager();
        const settingsManager = new SettingsManager();
        settingsManager.init(audioManager, ttsManager);
        await ttsManager.init();

        // 语音识别(ASR):桥仅 Android 注入,浏览器隐藏麦克风按钮
        const asrManager = new AsrManager();
        window.asrManager = asrManager;
        asrManager.init(settingsManager);
        // 205:识别结果落点在点击时绑定本页三件套(聊天页/Live2D 页共用同一识别器,页面互斥)
        document.getElementById('chat-mic-btn')?.addEventListener('click', () => {
            asrManager.setDomTarget('chat-input', 'chat-mic-btn', 'chat-status');
            asrManager.toggleRecord();
        });
        document.getElementById('l2-mic-btn')?.addEventListener('click', () => {
            asrManager.setDomTarget('l2-chat-input', 'l2-mic-btn', 'live2d-status');
            asrManager.toggleRecord();
        });
        // 209:触摸反馈回复接入统一气泡槽——Live2DSystem._bubble 经 l2:bubble 事件到此渲染,
        //     与对话回复同一位置同一样式;'…'=思考占位,''=清除
        window.globalEventBus && window.globalEventBus.on('l2:bubble', (e) => {
            const t = (e && e.text) || '';
            showL2Bubble(t === '…' ? '…' : t, { loading: t === '…' });
        });

        const timeSystem = new TimeSystem();
        const characterSystem = new CharacterSystem();
        const coinSystem = new CoinSystem();
        const questSystem = new QuestSystem();
        const globalLevelSystem = new GlobalLevelSystem();
        const battleSystem = new BattleSystem();
        const eventSystem = new EventSystem();
        const uiSystem = new UISystem();
        const diarySystem = new DiarySystem();
        const dateSystem = new DateSystem();
        const desktopPetSystem = new DesktopPetSystem();
        const petChatBridge = new PetChatBridge();
        const wardrobeSystem = new WardrobeSystem();
        const shopSystem = new ShopSystem();
        const storySystem = new StorySystem();
        const trpgSystem = new TRPGSystem();
        const travelSystem = new TravelSystem();
        const mainScene = new MainScene();
        const checkInSystem = window.checkInSystem || new CheckInSystem();
        const reminderSystem = window.reminderSystem || new ReminderSystem();

        // 注册模块（键名保持类名，值指向实例）
        const moduleMap = {
            ResourceLoader: resourceLoader,
            SaveManager: saveManager,
            AudioManager: audioManager,
            TTSManager: ttsManager,
            SettingsManager: settingsManager,
            TimeSystem: timeSystem,
            CharacterSystem: characterSystem,
            CoinSystem: coinSystem,
            QuestSystem: questSystem,
            GlobalLevelSystem: globalLevelSystem,
            BattleSystem: battleSystem,
            EventSystem: eventSystem,
            UISystem: uiSystem,
            DiarySystem: diarySystem,
            DateSystem: dateSystem,
            DesktopPetSystem: desktopPetSystem,
            PetChatBridge: petChatBridge,
            WardrobeSystem: wardrobeSystem,
            ShopSystem: shopSystem,
            StorySystem: storySystem,
            TRPGSystem: trpgSystem,
            TravelSystem: travelSystem,
            MainScene: mainScene,
            CheckInSystem: checkInSystem,
            ReminderSystem: reminderSystem
        };
        Object.entries(moduleMap).forEach(([name, instance]) => {
            gameEngine.addModule(name, instance);
        });

        const ok = await gameEngine.init();
        if (!ok) throw new Error('引擎初始化失败');
        // 设置已在引擎初始化时装载:重应用用户性能适配覆盖(动画/内存三态)
        window.applyPerformanceSettings && window.applyPerformanceSettings();
        gameEngine.start();

        // 加载数据到系统
        loadDataToSystems();
        setupSystemCallbacks();
        setupChat();
        setupActions();
        setupSettingsUI();
        // 初始化立绘与服装徽章显示
        const mainScene0 = gameEngine.getModule('MainScene');
        if (mainScene0) mainScene0.updateCharacterImage();

        // 启动自动保存
        saveManager.startAutoSave(() => getCurrentGameData());
        // 立即保存一次
        setTimeout(() => saveManager.saveGame(getCurrentGameData()), 500);

        hideLoadingScreen();
        isGameInitialized = true;
        showWelcomeMessage();

        // 主动问候(139):好感≥50 且当日首次登录(清醒时段 8~22 点)→天依主动开口
        setTimeout(() => {
            if (window.aiChatManager && window.aiChatManager.maybeProactiveGreeting) {
                window.aiChatManager.maybeProactiveGreeting((text) => deliverProactiveMessage(text));
            }
        }, 2600);

        // 启动日程提醒（真实时间三餐/睡觉）
        if (window.reminderSystem) {
            window.reminderSystem._loadFired?.();
            window.reminderSystem.init();
        }
        // 三层记忆库初始化（24h 短期 / 每日中期 / 30 天长期+衰减）
        if (window.memoryVault) {
            window.memoryVault.init().then(() => {
                // 跨天事件 → 每日整合 + 30天整合检查
                const ts0 = gameEngine.getModule('TimeSystem');
                ts0?.on?.('onSpecialEvent', (evt) => {
                    if (evt?.event === 'newDay') {
                        window.memoryVault.dailyConsolidation().catch(() => {});
                        window.memoryVault.monthlyConsolidation().catch(() => {});
                    }
                });
            });
        }
        // 真实时间 HUD 刷新
        startRealTimeHUD();
        // 每日签到弹窗（每天一次，得 15000 钻石）
        if (window.checkInSystem) window.checkInSystem.maybeShow();

        // 第一次进入时触发开场事件
        if (gameMode === 'new') {
            setTimeout(() => showOpeningStory(), 800);
        }

        console.log('[Main] 游戏初始化完成');
    } catch (e) {
        console.error('[Main] 游戏初始化失败:', e);
        showErrorMessage('游戏初始化失败，请重启应用。');
    }
}

function createDefaultGameData() {
    return {
        characterStats: { affection: 0, trust: 50 },
        characterSystemData: null,
        playerInfo: null,
        gender: window.genderManager?.getGender() || 'brother',
        playerProgress: { level: 1, experience: 0, coins: 1000 },
        timeSystem: { currentDay: 1, actionsLeft: 3, maxActions: 3, currentTime: 8 * 60 },
        events: { completed: [] },
        settings: { musicVolume: 0.7, sfxVolume: 0.8, autoSave: true },
        wardrobe: { owned: ['default'], currentOutfit: 'default' },
        shop: { purchases: {} },
        chatHistory: []
    };
}

function loadDataToSystems() {
    const ts = gameEngine.getModule('TimeSystem');
    const cs = gameEngine.getModule('CharacterSystem');
    const coins = gameEngine.getModule('CoinSystem');
    const ws = gameEngine.getModule('WardrobeSystem');
    const es = gameEngine.getModule('EventSystem');
    const shop = gameEngine.getModule('ShopSystem');
    if (ts && gameData.timeSystem) ts.loadData(gameData.timeSystem);
    if (cs && gameData.characterSystemData) cs.loadData(gameData.characterSystemData);
    if (coins && gameData.playerProgress?.coins !== undefined) coins.setCoins(gameData.playerProgress.coins);
    if (ws && gameData.wardrobe) {
        ws.loadFromSave(gameData.wardrobe);
        // 同步存档人格（多重人格）
        const o = ws.getCurrentOutfit();
        if (o && window.personaManager) {
            window.personaManager.activePersonaId = o.persona || 'default';
            window.personaManager._current = null;
        }
    }
    if (shop && gameData.shop) shop.loadData(gameData.shop);
    if (es && gameData.events?.completed) es.loadData(gameData.events);
    if (window.genderManager) window.genderManager.syncFromSaveData(gameData);
    if (gameData.chatHistory && window.aiChatManager) {
        window.aiChatManager.history = gameData.chatHistory;
    }
    refreshHUD();
}

function setupSystemCallbacks() {
    const cs = gameEngine.getModule('CharacterSystem');
    const mainScene = gameEngine.getModule('MainScene');
    if (cs && mainScene) {
        cs.on('onStatChange', () => { refreshHUD(); updateProfileStats(); mainScene.updateCharacterImage(); });
        cs.on('onMoodChange', (oldM, newM) => { mainScene.showBubble(`天依的心情：${newM}`); });
    }
}

/** 对话页状态胶囊(145):好感/信任条 + 行动点 + 人格名 */
function updateChatChips() {
    const cs = gameEngine ? gameEngine.getModule('CharacterSystem') : null;
    if (cs) {
        const aff = Math.round(cs.stats.affection || 0);
        const tru = Math.round(cs.stats.trust || 0);
        const affFill = document.getElementById('chip-aff-fill');
        const truFill = document.getElementById('chip-tru-fill');
        const affVal = document.getElementById('chip-aff-value');
        const truVal = document.getElementById('chip-tru-value');
        const ap = (v) => Math.max(0, Math.min(100, v)) + '%';   // 173:0~100→0~100%,负值钳0(原(v+100)/2导致初始0=50%)
        if (affFill) affFill.style.width = ap(aff);
        if (truFill) truFill.style.width = ap(tru);
        if (affVal) affVal.textContent = aff;
        if (truVal) truVal.textContent = tru;
    }
    const ts = gameEngine ? gameEngine.getModule('TimeSystem') : null;
    if (ts) {
        const st = ts.getTimeStatus ? ts.getTimeStatus() : { actionsLeft: 3, maxActions: 3 };
        const max = st.maxActions || 3;
        const left = Math.max(0, Math.min(max, st.actionsLeft || 0));
        const apFill = document.getElementById('chip-ap-fill');
        const apVal = document.getElementById('chip-ap-value');
        if (apFill) apFill.style.width = Math.round(left / max * 100) + '%';
        if (apVal) apVal.textContent = left;
    }
    const ws = gameEngine ? gameEngine.getModule('WardrobeSystem') : null;
    const chip = document.getElementById('chat-persona-chip');
    if (chip && ws && ws.getCurrentOutfit) {
        const outfit = ws.getCurrentOutfit();
        const nm = (outfit && outfit.name) || '默认';
        chip.textContent = nm.indexOf('人格') >= 0 ? nm : nm + '人格';
    }
}

function refreshHUD() {
    const ts = gameEngine.getModule('TimeSystem');
    const cs = gameEngine.getModule('CharacterSystem');
    const coins = gameEngine.getModule('CoinSystem');
    if (ts) {
        // 相处日期：真实时间跨天（0:00）自动+1
        ts.checkRealDateRollover?.();
        const status = ts.getTimeStatus();
        const day = document.getElementById('hud-day');
        const time = document.getElementById('hud-time');
        const actions = document.getElementById('hud-actions');
        if (day) day.textContent = `第 ${status.currentDay} 天`;
        // 显示真实时间与日期
        const now = new Date();
        const realTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (time) time.textContent = realTime;
        if (actions) actions.textContent = `行动点: ${status.actionsLeft}`;
        // HUD 左上角补充真实日期
        updateChatChips();
    // 对话页场景区(157):优先服装专属场景图(__chatScenes),无映射回退当前立绘
    const sceneImg = document.getElementById('chat-scene-img');
    const charImg = document.getElementById('character-image');
    if (sceneImg && charImg) {
        const wsm = gameEngine ? gameEngine.getModule('WardrobeSystem') : null;
        const oid = wsm && wsm.getCurrentOutfit ? (wsm.getCurrentOutfit().id || 'default') : 'default';
        const sceneSrc = (window.__chatScenes && window.__chatScenes[oid]) || charImg.src;
        if (sceneImg.src !== sceneSrc) sceneImg.src = sceneSrc;
    }
    const dateEl = document.getElementById('hud-real-date');
        if (dateEl) dateEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日 星期${['日','一','二','三','四','五','六'][now.getDay()]}`;
    }
    if (cs) cs.updateUI();
    if (coins) document.getElementById('hud-coin-value').textContent = coins.getCoins();
}

// 定时刷新 HUD 真实时间（每分钟）
function startRealTimeHUD() {
    if (window._realTimeTimer) clearInterval(window._realTimeTimer);
    window._realTimeTimer = setInterval(() => { if (isGameInitialized) refreshHUD(); }, 30000);
    refreshHUD();
}

function getCurrentGameData() {
    if (!isGameInitialized) return null;
    const ts = gameEngine.getModule('TimeSystem');
    const cs = gameEngine.getModule('CharacterSystem');
    const coins = gameEngine.getModule('CoinSystem');
    const ws = gameEngine.getModule('WardrobeSystem');
    const es = gameEngine.getModule('EventSystem');
    const shop = gameEngine.getModule('ShopSystem');
    return {
        characterStats: cs?.getStats() || { affection: 0, trust: 50 },
        characterSystemData: cs?.getSaveData() || null,
        playerInfo: window.playerInfoManager?.get() || null,
        gender: window.genderManager?.getGender() || 'brother',
        playerProgress: { level: 1, coins: coins?.getCoins() || 0 },
        timeSystem: ts?.getSaveData() || null,
        events: es?.getSaveData() || { completed: [] },
        wardrobe: ws?.getSaveData() || null,
        shop: shop?.getSaveData() || null,
        chatHistory: window.aiChatManager?.getHistory() || []
    };
}

function showLoadingScreen() {
    document.getElementById('loading-screen').style.display = 'flex';
    document.getElementById('game-container').style.display = 'none';
}
function hideLoadingScreen() {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
}
function updateLoadingProgress(p, t) {
    const bar = document.getElementById('loading-progress');
    const txt = document.getElementById('loading-text');
    if (bar) bar.style.width = (p * 100) + '%';
    if (txt) txt.textContent = t;
}
/** 主动消息投递(1.1.10Beta5/139):AI 气泡渲染+可选 TTS 朗读(心情/梦境/记忆由 AIChatManager 组装) */
function deliverProactiveMessage(text) {
    const messages = document.getElementById('chat-messages');
    if (!messages || !text) return;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ai';
    bubble.textContent = text;
    messages.appendChild(chatWrapRow('ai', bubble));
    messages.scrollTop = messages.scrollHeight;
    const tts = gameEngine ? gameEngine.getModule('TTSManager') : null;
    if (tts && tts.enabled) tts.speak(text);
}

function showWelcomeMessage() {
    const ts = gameEngine.getModule('TimeSystem');
    if (!ts) return;
    const status = ts.getTimeStatus();
    if (gameMode === 'continue') {
        setTimeout(() => {
            window.showToast(`欢迎回来！第 ${status.currentDay} 天`, 'info');
        }, 800);
    } else {
        setTimeout(() => window.showToast('天依已准备好与你共度今天 ☺', 'success', 2500), 800);
    }
}
function showErrorMessage(msg) {
    const txt = document.getElementById('loading-text');
    if (txt) { txt.textContent = msg; txt.style.color = '#E85A6E'; }
}

// ============= 聊天功能 =============
function setupChat() {
    // 164:补回 v162/v163 重写时丢失的三个核心绑定——①发送按钮 click ②输入框 Enter ③礼物按钮 click。
    // 此前症状:发送按钮有 .btn 通用波纹「有点击反馈」但 sendChat 从未被调用(无法与 AI 交互);
    // 礼物按钮无 .btn 类连波纹反馈都没有(点击无反应)。
    const sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) sendBtn.addEventListener('click', sendChat);
    const input = document.getElementById('chat-input');
    if (input) {
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChat();
            }
        });
    }
    const giftBtn = document.getElementById('chat-gift-btn');
    if (giftBtn) giftBtn.addEventListener('click', toggleGiftPanel);
    // 打开聊天入口走 setupActions 的 data-action 委托(handleAction 'talk'→openChat),此处不重复绑定(防双开双扣行动值)
    const closeBtn = document.getElementById('chat-close-chip');
    if (closeBtn) closeBtn.onclick = () => { closeChat(); };
    // 人格胶囊(145):点击打开换装
    const personaChip = document.getElementById('chat-persona-chip');
    if (personaChip) personaChip.onclick = () => { document.getElementById('chat-panel').style.display = 'none'; openWardrobe(); };
    // 表情面板(145):点击表情直接作为消息发送
    const emojiBtn = document.getElementById('chat-emoji-btn');
    const emojiPanel = document.getElementById('emoji-panel');
    if (emojiBtn && emojiPanel) {
        const EMOJIS = ['😊', '😂', '🥰', '😳', '😭', '😤', '🎉', '💔', '👀', '🙏', '💪', '👍', '❤️', '🌸', '🎵', '😴'];
        EMOJIS.forEach(e => {
            const b = document.createElement('button');
            b.className = 'emoji-item';
            b.textContent = e;
            b.onclick = () => {
                emojiPanel.style.display = 'none';
                const input = document.getElementById('chat-input');
                if (input) { input.value = e; sendChat(); }
            };
            emojiPanel.appendChild(b);
        });
        emojiBtn.onclick = () => {
            emojiPanel.style.display = emojiPanel.style.display === 'none' ? 'grid' : 'none';
        };
    }
    installKeyboardReopenFix();
}

/**
 * 键盘弹出/收起的对话页适配(141 引入;166 重写):
 * - 166 移除 v164 的 panel.style.height 硬锁——它是「页面内容逐字输出溢出文字框」根因:
 *   ①键盘弹出动画期 Android 连发多次 resize,中间态 delta 过阈值即把面板锁死在动画
 *   中间高度;②其后小幅 resize(候选栏高度变化/动画尾段)低于 12% 阈值永不重锁,
 *   面板与视口永久错位,逐字输出 scrollTop=scrollHeight 在错位高度上计算即视觉溢出。
 * - v165 壳层补白已正确(窗口收缩补偿+复评),WebView 视口=键盘上沿,普通文档流
 *   chat-panel 100% 天然精确跟随,无需 JS 锁高。
 * - 保留:键盘收起(大幅增高)时把消息滚回底部(容器高度随视口伸缩而 scrollTop 不变,
 *   会视觉跳到历史消息位置)。阈值 12%/120px:排除小抖动,只响应真键盘。
 */
function installKeyboardReopenFix() {
    if (window.__kbReopenFixInstalled) return;
    window.__kbReopenFixInstalled = true;
    let lastH = window.innerHeight;
    window.addEventListener('resize', () => {
        const h = window.innerHeight;
        const delta = h - lastH;
        lastH = h;
        const panel = document.getElementById('chat-panel');
        const chatActive = panel && panel.style.display !== 'none' && document.body.classList.contains('chat-open');
        if (!chatActive) return;
        if (delta > Math.max(120, h * 0.12)) {
            // 175 键盘收起两步修复:
            // ① 复位 WebView 上滚——输入框聚焦时 Android WebView 会自动上滚页面以露出输入框,
            //    收起后不自动回位,页面停留在上滑状态(scrollY>0,顶部露空/内容错位);
            // ② 延迟滚回最新消息——收起瞬间视口/安全区仍在变化,立即 scrollTop 会被
            //    后续布局作废,故 rAF+80ms+250ms 三次滚底(幂等)。
            window.scrollTo(0, 0);
            const box = document.getElementById('chat-messages');
            if (box) {
                requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
                setTimeout(() => { box.scrollTop = box.scrollHeight; }, 80);
                setTimeout(() => { box.scrollTop = box.scrollHeight; }, 250);
            }
        }
    });
}

/** 从后台切回 = 「再次进入」(141):主动问候触发入口之一(清醒时段当日首次必发/其它进入动态概率);
 *  冷启动时页面未初始化完成直接跳过;与 initGame 定时入口的防重入在 maybeProactiveGreeting 内部。 */
window.handleAndroidResume = function () {
    if (!isGameInitialized) return;
    if (window.aiChatManager && window.aiChatManager.maybeProactiveGreeting) {
        window.aiChatManager.maybeProactiveGreeting((text) => deliverProactiveMessage(text));
    }
};

/** 送礼面板开关 */
function toggleGiftPanel() {
    const panel = document.getElementById('gift-panel');
    const btn = document.getElementById('chat-gift-btn');
    if (!panel) return;
    const willShow = panel.style.display === 'none';
    panel.style.display = willShow ? 'block' : 'none';
    btn?.classList.toggle('active', willShow);
    if (willShow) renderGiftPanel();
}

/** 渲染背包礼物（商店购买入包，聊天中送出） */
function renderGiftPanel() {
    const grid = document.getElementById('gift-panel-grid');
    if (!grid) return;
    const shop = gameEngine.getModule('ShopSystem');
    const inv = shop?.getInventory?.() || [];
    if (inv.length === 0) {
        grid.innerHTML = '<div class="gift-panel-empty">背包里还没有礼物，去商店看看吧 🛍</div>';
        return;
    }
    grid.innerHTML = inv.map(g => `
        <div class="gift-item" data-id="${g.id}">
            <span class="gift-icon">${g.icon}</span>
            <span class="gift-name">${g.name}</span>
            <span class="gift-count">×${g.count}</span>
        </div>`).join('');
    grid.querySelectorAll('.gift-item').forEach(el => {
        el.addEventListener('click', () => sendGift(el.dataset.id));
    });
}

/** 按时长均匀逐字显现文本(近似说话/字幕节奏),保持滚动到底 */
function revealProgressively(bubble, text, durationMs, messagesEl) {
    const total = text.length;
    const start = performance.now();
    const step = () => {
        const p = Math.min(1, (performance.now() - start) / durationMs);
        const n = Math.max(1, Math.round(total * p));
        bubble.textContent = text.slice(0, n);
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
        if (p < 1) requestAnimationFrame(step);
        else bubble.textContent = text; // 确保结尾完整
    };
    requestAnimationFrame(step);
}

/**
 * 文字与 TTS 音频同步显现:等原生 onStart(携带真实音频时长)开播后,
 * 按音频时长逐字上屏;若音频先结束(合成失败)或 30s 未开播,则按阅读节奏兜底显现,文字必然完整。
 * 注意:先订阅再 speak,避免错过 onStart。
 */
/** 全屏页面开关(158):打开时隐藏主容器——键盘弹出 WebView 上滚也不会露出主界面 */
function setPageOpen(pageId, open) {
    document.body.classList.toggle('page-open', !!open);
    const page = document.getElementById(pageId);
    if (page) page.style.display = open ? 'flex' : 'none';
    window.scrollTo(0, 0);
}

/** 气泡头像行(1.1.10Beta5/145 对话改版):左侧圆形头像+气泡,双列同构 */
function chatAvatarFor(role) {
    const av = document.createElement('div');
    av.className = 'msg-avatar ' + (role === 'user' ? 'msg-avatar-user' : 'msg-avatar-ai');
    if (role === 'ai') {
        // 153(用户要求):天依头像=固定头像图,随立绘(服装)切换;图片稍后提供,当前留空
        const outfit = window.gameEngine ? window.gameEngine.getModule('WardrobeSystem') : null;
        const oid = outfit && outfit.getCurrentOutfit ? (outfit.getCurrentOutfit().id || 'default') : 'default';
        const avatars = window.__aiAvatars || {};
        const src = avatars[oid] || avatars['default'];
        if (src) { const i = document.createElement('img'); i.src = src; av.appendChild(i); }
    } else {
        const pi = window.playerInfoManager && window.playerInfoManager.get ? window.playerInfoManager.get() : null;
        const nick = (pi && pi.name) || (window.genderManager && window.genderManager.getUserTerm ? window.genderManager.getUserTerm() : '我');
        av.textContent = String(nick).slice(0, 4);
    }
    return av;
}
function chatWrapRow(role, bubble) {
    const row = document.createElement('div');
    row.className = 'msg-row msg-row-' + role;
    row.appendChild(chatAvatarFor(role));
    row.appendChild(bubble);
    return row;
}

function revealBubbleTextSynced(bubble, text, tts) {
    const messagesEl = document.getElementById('chat-messages');
    let settled = false;
    let fallbackTimer = null;
    const unbind = [];
    const cleanup = () => {
        unbind.forEach(fn => fn());
        unbind.length = 0;
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    };

    const onStart = (payload) => {
        if (settled) return;
        settled = true;
        cleanup();
        bubble.classList.remove('loading');
        const duration = (payload && payload.duration) || text.length * 260;
        revealProgressively(bubble, text, Math.max(1200, duration), messagesEl);
    };
    const onDone = () => {
        // 音频已结束仍未开始显现(合成失败/无音频)→ 立即完整显示
        if (settled) return;
        settled = true;
        cleanup();
        bubble.classList.remove('loading');
        bubble.textContent = text;
    };

    if (window.globalEventBus) {
        unbind.push(window.globalEventBus.on('tts:start', onStart));
        unbind.push(window.globalEventBus.on('tts:done', onDone));
    }
    // 兜底:30s 未开播(桥异常/极端慢)→ 按阅读节奏直接显现,不打断体验
    fallbackTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        bubble.classList.remove('loading');
        revealProgressively(bubble, text, Math.max(1200, text.length * 260), messagesEl);
    }, 30000);

    if (tts) tts.speak(text, 'chat');
}

/** 209:Live2D 统一气泡槽——触摸反馈回复与对话回复同一位置同一样式(l2-chat-flow 内);
 *  仅显示最新一条 AI 回复(用户消息不驻留),每次新内容重置 10s 计时,超时淡出移除。
 *  extraMs:TTS 逐字显现等长内容场景的可延长驻留。 */
let _l2BubbleTimer = 0;
function showL2Bubble(text, opts = {}) {
    const flow = document.getElementById('l2-chat-flow');
    if (!flow) return;
    clearTimeout(_l2BubbleTimer);
    flow.innerHTML = '';
    if (!text) return;
    const b = document.createElement('div');
    b.className = 'l2-msg ai' + (opts.loading ? ' loading' : '');
    b.textContent = text;
    flow.appendChild(b);
    armL2BubbleHide(opts.holdMs || 0);
}

/** 209:气泡 10s 无新内容自动淡出(淡出动画 0.4s 后移除 DOM) */
function armL2BubbleHide(extraMs = 0) {
    clearTimeout(_l2BubbleTimer);
    _l2BubbleTimer = setTimeout(() => {
        const flow = document.getElementById('l2-chat-flow');
        const b = flow && flow.firstChild;
        if (!b) return;
        b.classList.add('hide');
        setTimeout(() => { if (b.parentNode) b.parentNode.removeChild(b); }, 450);
    }, Math.max(10000, extraMs));
}

/** 205:Live2D 页对话——复用全局 AI/记忆/TTS 管线(sendMessage 同源)。
 *  209:气泡槽仅显示最新一条 AI 回复(用户消息不驻留,发送后显示思考占位),
 *  报错文案不朗读;回复 10s 无新内容自动淡出;与触摸回复同一位置同一样式。 */
let _l2Sending = false;
async function sendLive2DChat(text) {
    if (!window.aiChatManager || _l2Sending) return;
    _l2Sending = true;
    showL2Bubble('…', { loading: true });
    // 睡觉状态下开口说话会唤醒她
    window.live2dSystem && window.live2dSystem.wake && window.live2dSystem.wake();
    try {
        const result = await window.aiChatManager.sendMessage(text);
        const isErr = result.status === 'error' || result.source === 'error' || String(result.text || '').startsWith('⚠');
        const tts = gameEngine.getModule('TTSManager');
        showL2Bubble(result.text || '');
        if (tts && !isErr) tts.speak(result.text, 'chat');
        if (!isErr) {
            const cs = gameEngine.getModule('CharacterSystem');
            if (cs) cs.applyEffects({ affection: result.affectionDelta || 0, trust: result.trustDelta || 0 });
            const qs = gameEngine.getModule('QuestSystem');
            if (qs) qs.progress('chat_3', 1);
            const ds = gameEngine.getModule('DiarySystem');
            if (ds) ds.recordUserMessage();
        }
    } catch (e) {
        showL2Bubble('⚠ ' + (e && e.message ? e.message : '发送失败'));
    } finally {
        _l2Sending = false;
    }
}

/** 送出礼物：消耗背包库存 → AI 生成礼物反应 → 好感生效 */
async function sendGift(giftId) {
    const shop = gameEngine.getModule('ShopSystem');
    const messages = document.getElementById('chat-messages');
    const status = document.getElementById('chat-status');
    if (!shop || !window.aiChatManager) {
        window.showToast('AI 未初始化', 'error');
        return;
    }
    const r = shop.consumeGift(giftId);
    if (!r.success) {
        window.showToast(r.message || '背包里没有这个礼物', 'error');
        return;
    }
    const gift = r.gift;
    // 收起面板
    document.getElementById('gift-panel').style.display = 'none';
    document.getElementById('chat-gift-btn')?.classList.remove('active');

    // 礼物气泡（区别于普通消息）
    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user gift';
    userBubble.innerHTML = `<span class="gift-bubble-icon">${gift.icon}</span>送出了 ${gift.name}`;
    messages.appendChild(chatWrapRow('user', userBubble));
    messages.scrollTop = messages.scrollHeight;

    // AI 思考中
    const thinkingBubble = document.createElement('div');
    thinkingBubble.className = 'chat-bubble ai loading';
    thinkingBubble.textContent = '天依正在想';
    messages.appendChild(chatWrapRow('ai', thinkingBubble));
    messages.scrollTop = messages.scrollHeight;
    status.textContent = '天依收到礼物啦…';
    status.className = 'chat-status thinking';

    try {
        const result = await window.aiChatManager.sendMessage('', { gift });
        status.textContent = '';
        status.className = 'chat-status';

        const isErrReply = result.status === 'error' || result.source === 'error' || String(result.text || '').startsWith('⚠');
        const tts = gameEngine.getModule('TTSManager');
        if (tts && tts.enabled && tts.engine === 'mimotts' && !isErrReply) {
            // 音画同步:保持思考态,文字随 TTS 音频逐字显现
            revealBubbleTextSynced(thinkingBubble, result.text, tts);
        } else {
            thinkingBubble.classList.remove('loading');
            thinkingBubble.textContent = result.text;
            if (tts && !isErrReply) tts.speak(result.text, 'chat');
        }

        // 礼物好感生效 + AI 判定的变化
        const cs = gameEngine.getModule('CharacterSystem');
        if (cs && !isErrReply) {
            const aff = (gift.effects?.affection || 0) + (result.affectionDelta || 0);
            const tru = (gift.effects?.trust || 0) + (result.trustDelta || 0);
            cs.applyEffects({ affection: aff, trust: tru });
            if (aff > 0) window.showToast(`${gift.icon} 好感 +${aff}`, 'success');
        }
        if (!isErrReply) {
            const qs = gameEngine.getModule('QuestSystem');
            if (qs) qs.progress('chat_3', 1);
        }

        if (window.saveManager) window.saveManager.scheduleSave();
    } catch (e) {
        thinkingBubble.classList.remove('loading');
        thinkingBubble.textContent = '天依似乎分神了…稍后再试。';
        status.textContent = '连接出错';
        status.className = 'chat-status error';
        console.error(e);
    }
    messages.scrollTop = messages.scrollHeight;
}

function openChat() {
    // 163:body.chat-open 驱动(CSS 隐藏 gc+显示 chat-panel)
    document.body.classList.add('chat-open');
    // 166:清历史内联高度残留(v164 硬锁遗留;现已无锁定来源,幂等清理)
    const panel = document.getElementById('chat-panel');
    if (panel) panel.style.height = '';
    const input = document.getElementById('chat-input');
    if (input) setTimeout(() => input.focus(), 100);
    // 显示当前人格标签
    updateChatPersonaTag();
    const ts = gameEngine?.getModule('TimeSystem');
    if (ts) ts.consumeAction();
    // 渲染聊天历史
    renderChatHistory();
}

function renderChatHistory() {
    const messages = document.getElementById('chat-messages');
    if (!messages || !window.aiChatManager) return;
    // 只在 DOM 为空时渲染（避免重复）
    if (messages.children.length > 0) return;
    const history = window.aiChatManager.getHistory();
    history.forEach(msg => {
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble ' + (msg.role === 'user' ? 'user' : 'ai');
        bubble.textContent = msg.content;
        messages.appendChild(chatWrapRow(msg.role === 'user' ? 'user' : 'ai', bubble));
    });
    if (history.length > 0) {
        messages.scrollTop = messages.scrollHeight;
    }
}

function updateChatPersonaTag() {
    const tag = document.getElementById('chat-persona-tag');
    if (!tag) return;
    const ws = gameEngine?.getModule('WardrobeSystem');
    const outfit = ws?.getCurrentOutfit?.();
    if (outfit && outfit.tag) {
        tag.textContent = outfit.tag + '人格';
        tag.style.display = '';
    } else {
        tag.style.display = 'none';
    }
}

function closeChat() {
    document.body.classList.remove('chat-open');
    const panel = document.getElementById('chat-panel');
    if (panel) {
        panel.style.display = 'none';
        panel.style.height = ''; // 166:清历史内联高度残留(幂等)
    }
}

/**
 * Android 全面屏手势返回统一入口：
 * 优先级：关闭顶层弹窗 → 收起展开的聊天 → 关闭聊天面板 → 返回false（原生层退到后台）
 * 必须同步返回 'true'/'false'
 */
window.handleAndroidBack = function () {
    // 1. 关闭送礼面板（聊天内浮层）
    const giftPanel = document.getElementById('gift-panel');
    if (giftPanel && giftPanel.style.display !== 'none') {
        giftPanel.style.display = 'none';
        return 'true';
    }
    // 2. 关闭顶层模态弹窗（记忆/商店/日记等）
    const modalRoot = document.getElementById('modal-root');
    if (modalRoot && modalRoot.children.length > 0) {
        const top = modalRoot.lastElementChild;
        if (top) top.remove();
        return 'true';
    }
    // 2.5 关闭静态模态框（设置/存档选择/性别选择/引导/图片查看等）
    const staticModals = document.querySelectorAll('.modal');
    for (const m of staticModals) {
        if (m.style.display && m.style.display !== 'none') {
            m.style.display = 'none';
            if (m.id === 'live2d-page' && window.live2dSystem) window.live2dSystem.closePage();
            return 'true';
        }
    }
    // 3. 收起全屏展开的聊天
    const chat = document.getElementById('chat-panel');
    if (chat && chat.style.display !== 'none' && chat.classList.contains('expanded')) {
        chat.classList.remove('expanded');
        return 'true';
    }
    // 4. 关闭聊天面板(172 根修:对话页 v163 起由 body.chat-open 类驱动显示,
    //    内联 style.display 恒为 'none'——旧检测永假,导致对话页手势返回失效
    //    (不回主界面反而退后台)。改用类检测,从任何对话状态手势返回主界面)
    if (document.body.classList.contains('chat-open')) {
        closeChat();
        return 'true';
    }
    return 'false';
};

function toggleChatExpand() {
    const panel = document.getElementById('chat-panel');
    const btn = document.getElementById('chat-expand-btn');
    const isExpanded = panel.classList.toggle('expanded');
    btn.textContent = isExpanded ? '⛶' : '⛶';
    btn.title = isExpanded ? '收起' : '全屏展开';
    // 展开时重新渲染全部历史
    if (isExpanded) {
        const messages = document.getElementById('chat-messages');
        messages.innerHTML = '';
        renderChatHistory();
        messages.scrollTop = messages.scrollHeight;
    }
}

// 流体波纹效果
function addRipple(e, el) {
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    el.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
}

async function sendChat() {
    const input = document.getElementById('chat-input');
    const messages = document.getElementById('chat-messages');
    const status = document.getElementById('chat-status');
    const text = input.value.trim();
    if (!text) return;
    if (!window.aiChatManager) {
        window.showToast('AI 未初始化', 'error');
        return;
    }

    input.value = '';
    // 添加用户消息
    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user';
    userBubble.textContent = text;
    messages.appendChild(chatWrapRow('user', userBubble));
    messages.scrollTop = messages.scrollHeight;

    // 同步本地预设生成器状态
    if (window.presetReplyGenerator) {
        const cs = gameEngine.getModule('CharacterSystem');
        if (cs) window.presetReplyGenerator.setStats(cs.stats.affection, cs.stats.trust);
    }

    // AI 思考中
    const thinkingBubble = document.createElement('div');
    thinkingBubble.className = 'chat-bubble ai loading';
    thinkingBubble.textContent = '天依正在想';
    // 168:必须经 chatWrapRow 包裹(头像+行容器)——直接 append 会缺头像,
    // 且 .chat-bubble 的 flex:1 1 auto 在纵向 flex 容器(.chat-messages)中作用于
    // 垂直方向,多消息时 flex-shrink 压缩气泡高度→文字溢出边框(送礼路径正常即因有包裹)
    messages.appendChild(chatWrapRow('ai', thinkingBubble));
    messages.scrollTop = messages.scrollHeight;
    status.textContent = '天依正在思考…';
    status.className = 'chat-status thinking';

    try {
        const result = await window.aiChatManager.sendMessage(text);
        status.textContent = '';
        status.className = 'chat-status';

        // 报错文案不朗读、不做音画同步
        const tts = gameEngine.getModule('TTSManager');
        const isErrReply = result.status === 'error' || result.source === 'error' || String(result.text || '').startsWith('⚠');
        if (tts && tts.enabled && tts.engine === 'mimotts' && !isErrReply) {
            // 音画同步:保持思考态,文字随 TTS 音频逐字显现
            revealBubbleTextSynced(thinkingBubble, result.text, tts);
        } else {
            thinkingBubble.classList.remove('loading');
            thinkingBubble.textContent = result.text;
            if (tts && !isErrReply) tts.speak(result.text, 'chat');
        }

        // 应用好感/信任变化
        const cs = gameEngine.getModule('CharacterSystem');
        if (cs && !isErrReply) cs.applyEffects({ affection: result.affectionDelta || 0, trust: result.trustDelta || 0 });
        if (!isErrReply) {
            // 更新任务进度
            const qs = gameEngine.getModule('QuestSystem');
            if (qs) qs.progress('chat_3', 1);
            // AI 自动写日记（当天累计消息达阈值且未满 3 篇时）
            const ds = gameEngine.getModule('DiarySystem');
            if (ds) {
                ds.recordUserMessage().then(entry => {
                    if (entry) window.showToast(`天依写了一篇新日记：「${entry.title}」`, 'success');
                });
            }
        }
        // 立即保存
        if (window.saveManager) window.saveManager.scheduleSave();
    } catch (e) {
        thinkingBubble.classList.remove('loading');
        thinkingBubble.textContent = '天依似乎分神了…稍后再试。';
        status.textContent = '连接出错';
        status.className = 'chat-status error';
        console.error(e);
    }
    messages.scrollTop = messages.scrollHeight;
}

// ============= 行动按钮 =============
function setupActions() {
    // 主界面改版(144):底部导航 2×4 按钮组
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.add('ripple-container');
        btn.addEventListener('click', (e) => {
            addRipple(e, btn);
            handleAction(btn.dataset.nav);
        });
    });
    const lc = document.getElementById('live2d-close');
    if (lc) lc.onclick = () => { document.getElementById('live2d-page').style.display = 'none'; window.live2dSystem && window.live2dSystem.closePage(); };
    // 205:Live2D 页聊天条——发送按钮/Enter 发送(复用全局 AI/记忆/TTS 管线)
    const l2send = document.getElementById('l2-send-btn');
    const l2input = document.getElementById('l2-chat-input');
    if (l2send && l2input && !l2send.dataset.bound) {
        l2send.dataset.bound = '1';
        const doL2Send = () => {
            const text = l2input.value.trim();
            if (!text) return;
            l2input.value = '';
            sendLive2DChat(text);
        };
        l2send.addEventListener('click', doL2Send);
        l2input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doL2Send(); } });
    }
    const pc = document.getElementById('profile-close-btn');
    if (pc) pc.onclick = () => { document.getElementById('profile-modal').style.display = 'none'; };
    // 通用按钮波纹
    document.querySelectorAll('.btn').forEach(btn => {
        btn.classList.add('ripple-container');
        btn.addEventListener('click', (e) => addRipple(e, btn));
    });
}

function handleAction(action) {
    switch (action) {
        case 'talk': openChat(); break;
        case 'live2d':
            document.getElementById('live2d-page').style.display = 'flex';
            window.live2dSystem && window.live2dSystem.openPage();
            break;
        case 'activity': openActivity(); break;
        case 'profile': openProfile(); break;
        case 'diary': openDiary(); break;
        case 'shop': openShop(); break;
        case 'wardrobe': openWardrobe(); break;
        case 'date': openDate(); break;
        case 'game': openGame(); break;
        case 'trpg': openTRPG(); break;
        case 'travel': openTravel(); break;
        case 'quest': openQuest(); break;
        case 'memory': openMemory(); break;
    }
}

function openDiary() {
    const ds = gameEngine.getModule('DiarySystem');
    if (ds) {
        ds.listAll().then(entries => {
            const root = document.getElementById('modal-root');
            root.innerHTML = '';
            const m = document.createElement('div');
            m.className = 'modal';
            m.style.display = 'flex';
            const todayCount = ds.getTodayDiaryCount();
            let listHtml = '';
            if (entries.length === 0) {
                listHtml = '<p style="color:var(--muted);text-align:center;padding:1rem">还没有日记，和天依聊天后会自动生成～</p>';
            } else {
                listHtml = '<div class="diary-list">' + entries.map(e => `
                    <div class="diary-entry">
                        <div class="diary-title">${e.title || '无标题'}</div>
                        <div class="diary-body">${e.body || ''}</div>
                        <div class="diary-meta">
                            <span>好感 ${e.affection ?? '-'}</span>
                            <span>信任 ${e.trust ?? '-'}</span>
                            <span>${e.mood || ''}</span>
                            <span>${new Date(e.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    </div>
                `).join('') + '</div>';
            }
            m.innerHTML = `
                <div class="modal-card">
                    <h2>📔 天依的日记</h2>
                    <p style="color:var(--muted);font-size:0.85rem">天依会在陪你聊天后自动写日记，每天最多 3 篇（今天已写 ${todayCount}/3）</p>
                    ${listHtml}
                    <div class="modal-actions">
                        <button class="btn btn-ghost diary-close">关闭</button>
                    </div>
                </div>`;
            root.appendChild(m);
            m.querySelector('.diary-close').onclick = () => m.remove();
        });
    }
}

function openShop(tab = 'gift') {
    const shop = gameEngine.getModule('ShopSystem');
    const coins = gameEngine.getModule('CoinSystem');
    const ws = gameEngine.getModule('WardrobeSystem');
    if (!shop || !coins) return;
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const m = document.createElement('div');
    m.className = 'modal';
    m.style.display = 'flex';

    let currentTab = tab;
    function render() {
        const isGift = currentTab === 'gift';
        const items = isGift ? shop.gifts : shop.outfits;
        const itemsHtml = items.map(g => {
            const owned = !isGift && ws && ws.own(g.id);
            const bought = isGift ? (shop.getDailyGiftCount?.(g.id) || 0) : 0;
            const bagCount = isGift ? (shop.inventory?.[g.id] || 0) : 0;
            const soldOut = isGift && bought >= 3;
            return `
            <div class="item-card ${owned ? 'owned' : ''}" data-id="${g.id}" ${soldOut ? 'style="opacity:0.45;pointer-events:auto"' : ''}>
                <div class="item-icon">${g.icon}</div>
                <div class="item-name">${g.name}</div>
                <div class="item-price">💎 ${g.price}</div>
                ${g.effects ? `<div class="item-effect">好感 +${g.effects.affection || 0}${g.effects.trust ? ' 信任 +' + g.effects.trust : ''}</div>` : ''}
                ${g.desc ? `<div class="item-desc" style="color:var(--accent2)">${g.desc}</div>` : ''}
                ${owned ? '<div class="item-desc" style="color:var(--success)">已拥有</div>' : ''}
                ${isGift ? `<div class="item-desc" style="color:${soldOut ? 'var(--danger,#e74c3c)' : 'var(--muted)'}">今日 ${bought}/3${soldOut ? ' · 已限购' : ''}${bagCount > 0 ? ` · 背包 ${bagCount}` : ''}</div>` : ''}
            </div>`;
        }).join('');
        m.innerHTML = `
            <div class="modal-card modal-large">
                <h2>🛍 天依的商店</h2>
                <div class="seg" style="margin-bottom:0.8rem">
                    <button class="seg-btn ${isGift ? 'active' : ''}" data-tab="gift">🎁 礼物</button>
                    <button class="seg-btn ${!isGift ? 'active' : ''}" data-tab="outfit">👗 服装</button>
                </div>
                <p style="margin-bottom:0.3rem">当前余额：<strong style="color:var(--warning)">💎 ${coins.getCoins()}</strong></p>
                <div class="item-grid">${itemsHtml}</div>
                <div class="modal-actions">
                    <button class="btn btn-ghost shop-close">关闭</button>
                </div>
            </div>`;
        root.appendChild(m);
        m.querySelector('.shop-close').onclick = () => m.remove();
        m.querySelectorAll('.seg-btn').forEach(btn => {
            btn.onclick = () => { m.remove(); openShop(btn.dataset.tab); };
        });
        m.querySelectorAll('.item-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                const item = items.find(g => g.id === id);
                if (!item) return;
                if (isGift) {
                    const r = shop.purchase(id, 'gift');
                    if (r.success) {
                        window.showToast(`已购买 ${item.icon} ${item.name}，在聊天中送出吧（今日剩 ${r.remaining} 次）`, 'success');
                        refreshHUD();
                        if (window.saveManager) window.saveManager.scheduleSave();
                        m.remove();
                        openShop(currentTab);
                    } else {
                        window.showToast(r.message || '购买失败', 'error');
                    }
                } else {
                    if (ws && ws.own(id)) {
                        ws.setOutfit(id).then(() => {
                            window.showToast(`已穿上「${item.name}」`, 'success');
                            m.remove();
                            openShop(currentTab);
                        });
                        return;
                    }
                    if (coins.getCoins() < item.price) {
                        window.showToast('金币不足', 'error');
                        return;
                    }
                    const r = shop.purchase(id, 'outfit');
                    if (r.success) {
                        ws.setOutfit(id).then(() => {
                            window.showToast(`已购买并穿上「${item.name}」，解锁 ${item.desc || ''}`, 'success');
                            refreshHUD();
                            if (window.saveManager) window.saveManager.scheduleSave();
                            m.remove();
                            openShop(currentTab);
                        });
                    } else {
                        window.showToast(r.message || '购买失败', 'error');
                    }
                }
            });
        });
    }
    render();
}

function openWardrobe() {
    const ws = gameEngine.getModule('WardrobeSystem');
    const coins = gameEngine.getModule('CoinSystem');
    if (!ws) return;
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const m = document.createElement('div');
    m.className = 'modal';
    m.style.display = 'flex';
    const outfitsHtml = ws.outfits.map(o => `
        <div class="item-card ${ws.own(o.id) ? 'owned' : ''} ${ws.currentOutfit === o.id ? 'selected' : ''}" data-id="${o.id}">
            <div class="item-thumb"><img src="${o.image || 'images/characters/default.jpg'}" alt="${o.name}" loading="lazy"></div>
            <div class="item-name">${o.name}</div>
            <div class="item-desc" style="color:var(--accent2)">人格·${o.tag}</div>
            <div class="item-price">${o.price > 0 ? '💎 ' + o.price : '免费'}</div>
            ${ws.currentOutfit === o.id ? '<div class="item-desc" style="color:var(--accent)">当前穿着</div>' : ''}
        </div>
    `).join('');
    m.innerHTML = `
        <div class="modal-card modal-large">
            <h2>👗 天依的衣橱</h2>
            <p style="margin-bottom:0.3rem">每套服装都对应天依的不同人格，穿上后她说话的风格也会变化～</p>
            <p style="margin-bottom:0.3rem">余额：<strong style="color:var(--warning)">💎 ${coins ? coins.getCoins() : 0}</strong></p>
            <div class="item-grid">${outfitsHtml}</div>
            <div class="modal-actions">
                <button class="btn btn-ghost wardrobe-close">关闭</button>
            </div>
        </div>`;
    root.appendChild(m);
    m.querySelector('.wardrobe-close').onclick = () => m.remove();
    m.querySelectorAll('.item-card').forEach(card => {
        card.addEventListener('click', async () => {
            const id = card.dataset.id;
            const outfit = ws.outfits.find(o => o.id === id);
            if (!outfit) return;
            if (ws.own(id)) {
                await ws.setOutfit(id);
                window.showToast(`已切换为「${outfit.name}」· ${outfit.tag}人格`, 'success');
                m.remove();
                openWardrobe();
                if (window.saveManager) window.saveManager.scheduleSave();
            } else {
                if (!coins || coins.getCoins() < outfit.price) {
                    window.showToast('金币不足', 'error');
                    return;
                }
                coins.spend(outfit.price);
                ws.unlock(id);
                await ws.setOutfit(id);
                window.showToast(`已解锁并切换为「${outfit.name}」· ${outfit.tag}人格`, 'success');
                m.remove();
                openWardrobe();
                if (window.saveManager) window.saveManager.scheduleSave();
            }
        });
    });
}

function openDate() {
    const ds = gameEngine.getModule('DateSystem');
    if (!ds) return;
    const ts = gameEngine.getModule('TimeSystem');
    const period = ts.getTimeStatus().period;
    const available = ds.getAvailable(period);
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const m = document.createElement('div');
    m.className = 'modal';
    m.style.display = 'flex';
    if (available.length === 0) {
        m.innerHTML = `
            <div class="modal-card">
                <h2>🌸 约会</h2>
                <p>当前时段（${period}）没有可去的约会地点。</p>
                <p style="color:var(--muted);font-size:0.8rem">不同地点在不同时段开放</p>
                <div class="modal-actions">
                    <button class="btn btn-ghost date-close">关闭</button>
                </div>
            </div>`;
    } else {
        const locsHtml = available.map(l => `
            <div class="item-card" data-id="${l.id}">
                <div class="item-icon">${l.icon}</div>
                <div class="item-name">${l.name}</div>
                <div class="item-effect">好感 +${l.effects.affection || 0}${l.effects.trust ? ' 信任 +' + l.effects.trust : ''}</div>
            </div>
        `).join('');
        m.innerHTML = `
            <div class="modal-card modal-large">
                <h2>🌸 约会地点</h2>
                <p>当前时段：<strong>${period}</strong></p>
                <div class="item-grid">${locsHtml}</div>
                <div class="modal-actions">
                    <button class="btn btn-ghost date-close">返回</button>
                </div>
            </div>`;
    }
    root.appendChild(m);
    m.querySelector('.date-close').onclick = () => m.remove();
    m.querySelectorAll('.item-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            const r = ds.goDate(id);
            if (r.success) {
                window.showToast(`与天依约会：${r.location.name} ${r.location.icon}`, 'success');
                if (window.ChatEffects) ChatEffects.spawnHearts(document.querySelector('.character-layer'));
                // 约会剧情(137 预留接口):date_stories.json 填充后自动展示
                if (ds.getStory) ds.getStory(id).then(st => { if (st) showStoryModal(st); });
                refreshHUD();
                if (window.saveManager) window.saveManager.scheduleSave();
            } else {
                window.showToast('约会失败', 'error');
            }
            m.remove();
        });
    });
}

function openGame() {
    // 游戏合集(144):TRPG + 五子棋(GomokuAI 可玩)
    const root = document.getElementById('modal-root');
    if (!root) return;
    const m = document.createElement('div');
    m.className = 'modal';
    m.style.display = 'flex';
    m.innerHTML = `
        <div class="modal-card">
            <h2>🎮 游戏合集</h2>
            <div class="game-list">
                <button class="btn btn-secondary game-entry" data-g="trpg">🎲 TRPG 跑团</button>
                <button class="btn btn-secondary game-entry" data-g="gomoku">⚫ 五子棋(对战 AI)</button>
            </div>
            <div class="modal-actions"><button class="btn btn-ghost games-close">关闭</button></div>
        </div>`;
    root.appendChild(m);
    m.querySelector('.games-close').onclick = () => m.remove();
    m.querySelectorAll('.game-entry').forEach(b => {
        b.onclick = () => { m.remove(); if (b.dataset.g === 'trpg') openTRPG(); else openGomoku(); };
    });
}

/** 五子棋对战(144 框架;211 重构为正经棋盘):
 *  - Canvas 15 路盘,棋子落在网格交叉点(线+星位+最后一手标记),非格子里
 *  - 难度三层 简单/普通/困难(GomokuAI.setLevel,localStorage 持久化,可随时切换)
 *  - 回合锁(AI 思考中不可落子,修双击连下竞态)+平局判定(修软锁)+打开即 reset(修重进软锁)
 *  - 输赢/平局/过程提示全部为洛天依语气 */
const GOMOKU_LEVELS = [
    { key: 'easy', label: '简单', reward: { affection: 2, trust: 1 } },
    { key: 'normal', label: '普通', reward: { affection: 3, trust: 1 } },
    { key: 'hard', label: '困难', reward: { affection: 5, trust: 2 } },
];
function openGomoku() {
    const bs = gameEngine.getModule('BattleSystem');
    const engine = bs && bs.getGomokuEngine();
    if (!engine) { window.showToast('对战引擎未就绪', 'error'); return; }
    engine.reset();   // 211:打开即重置(修重进软锁——引擎是常驻单例,上局残局会拒收落子)
    const N = engine.size;
    let level = localStorage.getItem('gomokuLevel');
    if (!GOMOKU_LEVELS.some((l) => l.key === level)) level = 'normal';
    engine.setLevel(level);
    const root = document.getElementById('modal-root');
    if (!root) return;
    const m = document.createElement('div');
    m.className = 'modal';
    m.style.display = 'flex';
    m.innerHTML = `
        <div class="modal-card gomoku-card">
            <h2>⚫ 五子棋</h2>
            <div class="gomoku-levels" id="gomoku-levels">
                ${GOMOKU_LEVELS.map((l) => `<button class="btn btn-secondary gomoku-level" data-l="${l.key}">${l.label}</button>`).join('')}
            </div>
            <p id="gomoku-status" class="form-hint"></p>
            <canvas id="gomoku-board" class="gomoku-board"></canvas>
            <div class="modal-actions">
                <button id="gomoku-restart" class="btn btn-secondary">重开一局</button>
                <button class="btn btn-ghost gomoku-close">关闭</button>
            </div>
        </div>`;
    root.appendChild(m);
    const canvas = m.querySelector('#gomoku-board');
    const statusEl = m.querySelector('#gomoku-status');
    let over = false;
    let busy = false;   // 211:回合锁——AI 思考窗口内拒绝落子(修快速双击连下两手竞态)

    const TONE = {
        start: '来啦~你执黑 ● 先手哦,点棋盘上的交叉点落子 ♪',
        thinking: '天依想想哦…嗯……',
        aiMoved: (mv) => `天依下在 (${mv.x + 1},${mv.y + 1}) 啦,轮到你咯 ♪`,
        win: '呜哇…你居然赢啦!哼,下次天依可要认真起来了哦 ♪',
        lose: '嘿嘿,天依赢啦~你的棋力也很棒哦,再来一局嘛 ♪',
        draw: '哇…棋盘都下满了还没分出胜负,势均力敌呢!再来一局分个高下嘛 ♪',
    };

    // —— 棋盘几何:15 条线 15×15 交叉点,棋子落交叉点(非格子) ——
    let W = 0, cell = 0, pad = 0;
    function fit() {
        const avail = Math.min(canvas.parentElement ? canvas.parentElement.clientWidth : 320, 420);
        W = Math.max(240, Math.floor(avail));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.style.width = W + 'px';
        canvas.style.height = W + 'px';
        canvas.width = W * dpr;
        canvas.height = W * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cell = W / (N + 1);
        pad = cell;
    }
    const px = (i) => pad + i * cell;

    function draw() {
        fit();
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, W);
        // 盘面
        ctx.fillStyle = '#e8c88f';
        ctx.fillRect(0, 0, W, W);
        // 网格线
        ctx.strokeStyle = '#8a6a3a';
        ctx.lineWidth = 1;
        for (let i = 0; i < N; i++) {
            ctx.beginPath(); ctx.moveTo(px(0), px(i)); ctx.lineTo(px(N - 1), px(i)); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(px(i), px(0)); ctx.lineTo(px(i), px(N - 1)); ctx.stroke();
        }
        // 外框加粗
        ctx.lineWidth = 2;
        ctx.strokeRect(px(0), px(0), cell * (N - 1), cell * (N - 1));
        // 星位(天元+四星)
        ctx.fillStyle = '#8a6a3a';
        for (const [sx, sy] of [[7, 7], [3, 3], [11, 3], [3, 11], [11, 11]]) {
            ctx.beginPath(); ctx.arc(px(sx), px(sy), Math.max(2, cell * 0.09), 0, Math.PI * 2); ctx.fill();
        }
        // 棋子(落交叉点)
        for (const mv of engine.moves) {
            const cx = px(mv.x), cy = px(mv.y), r = cell * 0.44;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
            if (mv.id === 1) {
                const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
                g.addColorStop(0, '#5a5a5a'); g.addColorStop(1, '#0a0a0a');
                ctx.fillStyle = g;
            } else {
                const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
                g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#cfcfcf');
                ctx.fillStyle = g;
            }
            ctx.fill();
            if (mv.id === 2) { ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = 1; ctx.stroke(); }
            // 最后一手标记
            if (mv === engine.moves[engine.moves.length - 1] && !engine.winner) {
                ctx.beginPath(); ctx.arc(cx, cy, r * 0.28, 0, Math.PI * 2);
                ctx.fillStyle = mv.id === 1 ? '#e86a5a' : '#d0342c';
                ctx.fill();
            }
        }
    }

    // 落子:点击 → 最近交叉点(round 直接吸附)
    canvas.addEventListener('click', (e) => {
        if (over || busy) return;                        // 211:AI 思考中锁定
        const rect = canvas.getBoundingClientRect();
        const gx = Math.round((e.clientX - rect.left) / rect.width * (N + 1)) - 1;
        const gy = Math.round((e.clientY - rect.top) / rect.height * (N + 1)) - 1;
        if (gx < 0 || gy < 0 || gx >= N || gy >= N) return;
        if (!engine.place(gx, gy, 1)) return;
        draw();
        if (engine.winner) return finish(1);
        if (engine.isFull()) return finish(0);           // 211:平局判定(修下满软锁)
        busy = true;
        statusEl.textContent = TONE.thinking;
        setTimeout(() => {
            busy = false;
            if (over) return;
            const mv = engine.aiMove(2);
            draw();
            if (engine.winner) return finish(2);
            if (engine.isFull()) return finish(0);
            if (mv) statusEl.textContent = TONE.aiMoved(mv);
        }, 260);
    });

    function finish(w) {
        over = true;
        statusEl.textContent = w === 1 ? TONE.win : w === 2 ? TONE.lose : TONE.draw;
        if (w === 1) {
            const lv = GOMOKU_LEVELS.find((l) => l.key === level) || GOMOKU_LEVELS[1];
            const cs = gameEngine.getModule('CharacterSystem');
            if (cs) cs.applyEffects(lv.reward);   // 211:奖励随难度分级
            refreshHUD();
        }
    }

    // 难度选择(可局中切换,即时生效;localStorage 持久化)
    const levelBtns = [...m.querySelectorAll('.gomoku-level')];
    function syncLevelBtns() {
        levelBtns.forEach((b) => b.classList.toggle('active', b.dataset.l === level));
    }
    levelBtns.forEach((b) => {
        b.onclick = () => {
            level = b.dataset.l;
            localStorage.setItem('gomokuLevel', level);
            engine.setLevel(level);
            syncLevelBtns();
            if (!over) statusEl.textContent = '难度已切换为「' + (GOMOKU_LEVELS.find((l) => l.key === level) || {}).label + '」~继续对局 ♪';
        };
    });
    syncLevelBtns();
    statusEl.textContent = TONE.start;
    draw();
    m.querySelector('.gomoku-close').onclick = () => m.remove();
    m.querySelector('#gomoku-restart').onclick = () => {
        engine.reset(); over = false; busy = false;
        statusEl.textContent = TONE.start; draw();
    };
}

/** 活动面板(144):整合约会+旅行入口 */
function openActivity() {
    const root = document.getElementById('modal-root');
    if (!root) return;
    const m = document.createElement('div');
    m.className = 'modal';
    m.style.display = 'flex';
    m.innerHTML = `
        <div class="modal-card">
            <h2>🌐 活动</h2>
            <div class="game-list">
                <button class="btn btn-secondary game-entry" data-a="date">🌸 约会</button>
                <button class="btn btn-secondary game-entry" data-a="travel">🧳 旅行</button>
                <button class="btn btn-secondary game-entry" data-a="wardrobe">👗 换装</button>
            </div>
            <div class="modal-actions"><button class="btn btn-ghost activity-close">关闭</button></div>
        </div>`;
    root.appendChild(m);
    m.querySelector('.activity-close').onclick = () => m.remove();
    m.querySelectorAll('.game-entry').forEach(b => {
        b.onclick = () => { m.remove(); const a = b.dataset.a; if (a === 'date') openDate(); else if (a === 'travel') openTravel(); else openWardrobe(); };
    });
}

/** 角色属性面板(144):好感/信任/行动点/等级/钻石/服装 */
function openProfile() {
    updateChatChips();
    updateProfileStats();
    document.getElementById('profile-modal').style.display = 'flex';
}

/** 属性面板数值(146):好感/信任(-100~100 → 0~100% 条)+行动值(left/max);打开与数值变化时刷新 */
function updateProfileStats() {
    const cs = gameEngine ? gameEngine.getModule('CharacterSystem') : null;
    if (cs) {
        const aff = Math.round(cs.stats.affection || 0);
        const tru = Math.round(cs.stats.trust || 0);
        const pct = (v) => Math.max(0, Math.min(100, v)) + '%';   // 173:0~100→0~100%,负值钳0(原(v+100)/2导致初始0=50%)
        const af = document.getElementById('prof-aff-fill');
        if (af) af.style.width = pct(aff);
        const an = document.getElementById('prof-aff-num');
        if (an) an.textContent = aff;
        const tf = document.getElementById('prof-tru-fill');
        if (tf) tf.style.width = pct(tru);
        const tn = document.getElementById('prof-tru-num');
        if (tn) tn.textContent = tru;
    }
    const ts = gameEngine ? gameEngine.getModule('TimeSystem') : null;
    if (ts) {
        const st = ts.getTimeStatus ? ts.getTimeStatus() : { actionsLeft: 3, maxActions: 3 };
        const max = st.maxActions || 3;
        const left = Math.max(0, Math.min(max, st.actionsLeft || 0));
        const f = document.getElementById('prof-ap-fill');
        if (f) f.style.width = Math.round(left / max * 100) + '%';
        const n = document.getElementById('prof-ap-num');
        if (n) n.textContent = left;
    }
}

function openTRPG() {
    const trpg = gameEngine.getModule('TRPGSystem');
    if (!trpg) return;
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const m = document.createElement('div');
    m.className = 'modal';
    m.style.display = 'flex';
    const missionsHtml = trpg.getMissions().map(mi => `
        <div class="item-card" data-id="${mi.id}">
            <div class="item-icon">🎲</div>
            <div class="item-name">${mi.name}</div>
            <div class="item-desc">${mi.description}</div>
            <div class="item-price">${mi.difficulty}</div>
            <div class="item-effect">好感 +${mi.rewards.affection} 信任 +${mi.rewards.trust} 💎${mi.rewards.coins}</div>
        </div>
    `).join('');
    m.innerHTML = `
        <div class="modal-card modal-large">
            <h2>🎲 TRPG 冒险</h2>
            <p>选择一个任务卡开始冒险</p>
            <div class="item-grid">${missionsHtml}</div>
            <div class="modal-actions">
                <button class="btn btn-ghost trpg-close">返回</button>
            </div>
        </div>`;
    root.appendChild(m);
    m.querySelector('.trpg-close').onclick = () => m.remove();
    m.querySelectorAll('.item-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            const r = trpg.start(id);
            if (!r) return;
            const dice = r.dice;
            // 连败保底(137):连续失败 2 次后判定阈值下降,成功率提升
            const success = dice >= trpg.getSuccessThreshold();
            trpg.complete(id, success);
            trpg.notifyResult(success);
            m.remove();
            // 显示结果
            const rm = document.createElement('div');
            rm.className = 'modal';
            rm.style.display = 'flex';
            rm.innerHTML = `
                <div class="modal-card" style="text-align:center">
                    <div style="font-size:3rem;margin:0.5rem 0">${success ? '🎉' : '😢'}</div>
                    <h2>${r.mission.name}</h2>
                    <p style="font-size:1.1rem;margin:0.5rem 0">🎲 骰出了 <strong style="color:${success ? 'var(--success)' : 'var(--danger)'};font-size:1.4rem">${dice}</strong></p>
                    <p>${success ? '冒险成功！获得奖励～' : '冒险失败…下次再试试吧。'}</p>
                    ${success ? `<p style="color:var(--success)">好感 +${r.mission.rewards.affection} 信任 +${r.mission.rewards.trust} 💎+${r.mission.rewards.coins}</p>` : ''}
                    <div class="modal-actions" style="justify-content:center">
                        <button class="btn btn-primary result-close">好的</button>
                    </div>
                </div>`;
            document.getElementById('modal-root').appendChild(rm);
            rm.querySelector('.result-close').onclick = () => rm.remove();
            refreshHUD();
            if (window.saveManager) window.saveManager.scheduleSave();
        });
    });
}

/** 小剧场 modal(137 预留:旅行/约会剧情填充接口,story={title,text,icon}) */
function showStoryModal(story) {
    if (!story || !story.text) return;
    const root = document.getElementById('modal-root');
    if (!root) return;
    const m = document.createElement('div');
    m.className = 'modal';
    m.style.display = 'flex';
    m.innerHTML = `
        <div class="modal-card">
            <h2>${story.icon || '📖'} ${story.title || '小剧场'}</h2>
            <p style="white-space:pre-line;line-height:1.7">${story.text}</p>
            <div class="modal-actions">
                <button class="btn btn-primary story-modal-close">继续</button>
            </div>
        </div>`;
    root.appendChild(m);
    m.querySelector('.story-modal-close').onclick = () => m.remove();
}

function openTravel() {
    const tr = gameEngine.getModule('TravelSystem');
    if (!tr) return;
    const coins = gameEngine.getModule('CoinSystem');
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const m = document.createElement('div');
    m.className = 'modal';
    m.style.display = 'flex';
    const destsHtml = tr.destinations.map(d => `
        <div class="item-card ${tr.currentLocation === d.id ? 'selected' : ''}" data-id="${d.id}">
            <div class="item-icon">${d.id === 'home' ? '🏠' : d.id === 'park' ? '🌸' : d.id === 'school' ? '🏫' : d.id === 'cafe' ? '☕' : d.id === 'amusement' ? '🎡' : '🏖'}</div>
            <div class="item-name">${d.name}</div>
            <div class="item-price">${d.cost > 0 ? '💎 ' + d.cost : '免费'}</div>
            ${d.effects.affection || d.effects.trust ? `<div class="item-effect">${d.effects.affection ? '好感 +' + d.effects.affection : ''}${d.effects.trust ? ' 信任 +' + d.effects.trust : ''}</div>` : ''}
            ${tr.currentLocation === d.id ? '<div class="item-desc" style="color:var(--accent)">当前所在</div>' : ''}
        </div>
    `).join('');
    m.innerHTML = `
        <div class="modal-card modal-large">
            <h2>✈ 旅行</h2>
            <p style="margin-bottom:0.3rem">余额：<strong style="color:var(--warning)">💎 ${coins ? coins.getCoins() : 0}</strong></p>
            <div class="item-grid">${destsHtml}</div>
            <div class="modal-actions">
                <button class="btn btn-ghost travel-close">返回</button>
            </div>
        </div>`;
    root.appendChild(m);
    m.querySelector('.travel-close').onclick = () => m.remove();
    m.querySelectorAll('.item-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            const r = tr.travelTo(id);
            if (r.success) {
                window.showToast(`已到达：${r.destination.name}`, 'success');
                // 旅行剧情(137 预留接口):travel_stories.json 填充后自动展示
                if (tr.getStory) tr.getStory(id).then(st => { if (st) showStoryModal(st); });
                refreshHUD();
                if (window.saveManager) window.saveManager.scheduleSave();
                m.remove();
            } else {
                window.showToast(r.message || '旅行失败', 'error');
            }
        });
    });
}

function openQuest() {
    const qs = gameEngine.getModule('QuestSystem');
    if (!qs) return;
    const active = qs.getActive();
    const completed = qs.getCompleted();
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const m = document.createElement('div');
    m.className = 'modal';
    m.style.display = 'flex';
    let activeHtml = '';
    if (active.length === 0) {
        activeHtml = '<p style="color:var(--muted);text-align:center">今日任务已全部完成！</p>';
    } else {
        activeHtml = active.map(q => `
            <div class="item-card" style="cursor:default">
                <div class="item-icon">📜</div>
                <div class="item-name">${q.name}</div>
                <div class="item-desc">${q.progress}/${q.target}</div>
                <div class="item-effect">💎 ${q.reward}</div>
                <div style="margin-top:0.3rem;height:4px;background:rgba(31,58,82,0.6);border-radius:2px;overflow:hidden">
                    <div style="width:${(q.progress/q.target)*100}%;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:2px;transition:width 0.3s"></div>
                </div>
            </div>
        `).join('');
    }
    let completedHtml = '';
    if (completed.length > 0) {
        completedHtml = '<h3 style="margin-top:0.8rem;color:var(--success)">已完成</h3>' +
            completed.map(q => `<p style="color:var(--muted);font-size:0.85rem">✓ ${q.name}（+${q.reward}💎）</p>`).join('');
    }
    m.innerHTML = `
        <div class="modal-card modal-large">
            <h2>📜 今日任务</h2>
            <div class="item-grid">${activeHtml}</div>
            ${completedHtml}
            <div class="modal-actions">
                <button class="btn btn-ghost quest-close">关闭</button>
            </div>
        </div>`;
    root.appendChild(m);
    m.querySelector('.quest-close').onclick = () => m.remove();
}

function openMemory() {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const m = document.createElement('div');
    m.className = 'modal';
    m.style.display = 'flex';

    let currentLayer = 'short';
    let stats = { short: 0, mid: 0, long: 0, key: 0, embedAvailable: false };

    async function render() {
        const vault = window.memoryVault;
        stats = vault?.isInitialized ? await vault.getStats() : stats;
        const rows = vault?.isInitialized ? await vault.listAll(currentLayer) : [];
        const tabs = [
            { id: 'short', label: `短期（${stats.short}）` },
            { id: 'mid', label: `中期（${stats.mid}）` },
            { id: 'long', label: `长期（${stats.long}）` }
        ];
        let listHtml = '';
        if (!vault?.isInitialized) {
            listHtml = '<p style="color:var(--muted);text-align:center;padding:1rem">记忆库未初始化</p>';
        } else if (rows.length === 0) {
            listHtml = `<p style="color:var(--muted);text-align:center;padding:1rem">${currentLayer === 'short' ? '暂无记录，聊天后会自动保存 24 小时内的完整上下文' : currentLayer === 'mid' ? '暂无每日总结，跨天后自动生成当天记忆摘要' : '暂无长期记忆，重要内容会自动沉淀到这里'}</p>`;
        } else if (currentLayer === 'short') {
            listHtml = rows.map(r => `
                <div class="diary-entry">
                    <div class="diary-body" style="font-size:0.85rem">${r.role === 'user' ? '🧑' : '🎤'} ${r.content || ''}</div>
                    <div class="diary-meta"><span>${new Date(r.ts).toLocaleString('zh-CN')}</span></div>
                    <button class="btn btn-ghost mem-del" data-id="${r.id}" style="padding:0.15rem 0.5rem;font-size:0.75rem">删除</button>
                </div>`).join('');
        } else if (currentLayer === 'mid') {
            listHtml = rows.map(r => `
                <div class="diary-entry">
                    <div class="diary-title">📅 ${r.dateKey || ''} · 唯一提及 ${(r.mentionDates || []).length || r.mentions || 0} 天${r.degraded ? ' · <span style="color:var(--warning)">降级待重做</span>' : ''}</div>
                    <div class="diary-body" style="font-size:0.85rem">${r.summary || ''}</div>
                    <button class="btn btn-ghost mem-del" data-id="${r.id}" style="padding:0.15rem 0.5rem;font-size:0.75rem">删除</button>
                </div>`).join('');
        } else {
            listHtml = rows.map(r => `
                <div class="diary-entry">
                    <div class="diary-title">${r.isKey ? '⭐ 核心记忆' : '长期记忆'} · ${r.source === 'monthly' ? '月度沉淀' : r.source === 'key-auto' ? '自动提取' : '手动添加'}</div>
                    <div class="diary-body" style="font-size:0.85rem">${r.content || ''}</div>
                    <div class="diary-meta">
                        <span>最后提及 ${r.lastMentioned ? new Date(r.lastMentioned).toLocaleDateString('zh-CN') : '-'}</span>
                        <button class="btn btn-ghost mem-key" data-id="${r.id}" style="padding:0.15rem 0.5rem;font-size:0.75rem">${r.isKey ? '取消核心' : '设为核心'}</button>
                        <button class="btn btn-ghost mem-del" data-id="${r.id}" style="padding:0.15rem 0.5rem;font-size:0.75rem">删除</button>
                    </div>
                </div>`).join('');
        }

        m.innerHTML = `
            <div class="modal-card modal-large">
                <h2>🧠 记忆系统</h2>
                <p style="color:var(--muted);font-size:0.78rem;margin-bottom:0.6rem">
                    短期：24h 完整上下文（本地） → 中期：每日总结（唯一提及≥3 天沉淀）→ 长期：30 天提炼，60 天未提及自动遗忘（⭐核心记忆永不遗忘）
                    <br>时空：${window.memoryVault?.appId || 'tianyi_stories'} · 用户：${window.memoryVault?.userId || 'local'}
                    <br>向量检索：${stats.embedAvailable ? '<span style="color:var(--success)">原生嵌入已启用</span>' : '<span style="color:var(--warning)">降级模式（关键词）</span>'}
                    ｜ 云同步：${window.memoryVault?.cloudSync ? (window.memoryVault.cloudSync.constructor?.name === 'NullCloudAdapter' ? '未配置（服务端未上线）' : '已配置') : '未配置（服务端未上线）'}
                    ｜ <span style="color:var(--accent3)">时空回响：${window.settingsManager?.get?.('crossSenseEnabled') !== false ? '开' : '关'}</span>
                </p>
                <div class="seg" style="margin-bottom:0.6rem">
                    ${tabs.map(t => `<button class="seg-btn ${currentLayer === t.id ? 'active' : ''}" data-layer="${t.id}">${t.label}</button>`).join('')}
                </div>
                <div class="diary-list" style="max-height:45vh;overflow-y:auto">${listHtml}</div>
                ${currentLayer === 'long' ? `
                <div style="display:flex;gap:0.5rem;margin-top:0.6rem;align-items:center">
                    <input id="mem-add-input" placeholder="手动添加长期记忆…" style="flex:1;padding:0.4rem 0.6rem;border-radius:0.5rem;border:1px solid var(--muted);background:var(--card,#1b1b25);color:var(--text,#eee)">
                    <button class="btn btn-ghost" id="mem-add-key" style="padding:0.35rem 0.6rem;font-size:0.8rem">⭐ 核心</button>
                    <button class="btn" id="mem-add-btn" style="padding:0.35rem 0.8rem;font-size:0.8rem">添加</button>
                </div>` : ''}
                ${currentLayer === 'short' ? `<div class="modal-actions" style="margin-top:0.6rem"><button class="btn btn-ghost" id="mem-consolidate-btn">立即整合为每日记忆</button></div>` : ''}
                <div class="modal-actions">
                    <button class="btn btn-ghost memory-close">关闭</button>
                </div>
            </div>`;
        root.appendChild(m);

        m.querySelectorAll('.seg-btn').forEach(btn => {
            btn.onclick = () => { currentLayer = btn.dataset.layer; render(); };
        });
        m.querySelector('.memory-close').onclick = () => m.remove();
        m.querySelectorAll('.mem-del').forEach(btn => {
            btn.onclick = async () => {
                await window.memoryVault.deleteMemory(currentLayer, btn.dataset.id);
                render();
            };
        });
        m.querySelectorAll('.mem-key').forEach(btn => {
            btn.onclick = async () => {
                await window.memoryVault.toggleKey(btn.dataset.id);
                render();
            };
        });
        const addBtn = m.querySelector('#mem-add-btn');
        if (addBtn) {
            let asKey = false;
            m.querySelector('#mem-add-key').onclick = (e) => {
                asKey = !asKey;
                e.target.style.color = asKey ? 'var(--warning)' : '';
            };
            addBtn.onclick = async () => {
                const input = m.querySelector('#mem-add-input');
                const text = input?.value?.trim();
                if (!text) return;
                await window.memoryVault.addLongTerm(text, asKey, 'manual');
                window.showToast('已添加长期记忆' + (asKey ? '（核心）' : ''), 'success');
                render();
            };
        }
        const consBtn = m.querySelector('#mem-consolidate-btn');
        if (consBtn) {
            consBtn.onclick = async () => {
                consBtn.disabled = true;
                consBtn.textContent = '整合中…';
                const ok = await window.memoryVault.dailyConsolidation();
                window.showToast(ok ? '已整合为每日记忆' : '暂无可整合的内容', ok ? 'success' : 'info');
                render();
            };
        }
    }
    render();
}

// ============= 设置面板 =============
function setupSettingsUI() {
    const btn = document.getElementById('hud-settings-btn');
    const modal = document.getElementById('settings-modal');
    const closeBtn = document.getElementById('settings-close-btn');
    if (btn) btn.onclick = () => {
        // 同步当前 AI 设置
        document.getElementById('ai-baseurl').value = window.aiConfig.getBaseURL();
        document.getElementById('ai-model').value = window.aiConfig.getModelName();
        document.getElementById('ai-apikey').value = window.aiConfig.getApiKey();
        document.getElementById('ai-custom-headers').value = window.aiConfig.config.customHeaders || '';
        document.getElementById('ai-custom-body').value = window.aiConfig.config.customBody || '';
        // 同步 mode
        const mode = window.aiConfig.getMode();
        document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        applyAIModeUI(mode);
        modal.style.display = 'flex';
    };
    if (closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; };

    // 标签页
    document.querySelectorAll('.btn-tab').forEach(t => {
        t.onclick = () => {
            document.querySelectorAll('.btn-tab').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            const tab = t.dataset.tab;
            document.querySelectorAll('.settings-tab-panel').forEach(p => {
                p.style.display = p.dataset.panel === tab ? 'block' : 'none';
            });
        };
    });

    // 模式按钮
    document.querySelectorAll('.seg-btn').forEach(b => {
        b.onclick = () => {
            document.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            window.aiConfig.setMode(b.dataset.mode);
            applyAIModeUI(b.dataset.mode);
        };
    });

    /**
     * 模式驱动的配置区显隐:点哪个模式只出现该模式的配置
     *  - LOCAL  本地:无需任何配置
     *  - BUILTIN 内置:仅内置模型选择(免密钥,按轮扣💎)
     *  - OLLAMA/CLAUDE:Base URL + API Key + 模型
     *  - CUSTOM 自定义:全部字段 + 高级选项
     */
    function applyAIModeUI(mode) {
        const show = (id, v) => {
            const el = document.getElementById(id);
            if (el) el.style.display = v ? '' : 'none';
        };
        show('ai-builtin-row', mode === 'BUILTIN');
        show('ai-preset-row', mode === 'OLLAMA' || mode === 'CLAUDE' || mode === 'CUSTOM');
        const needApi = mode === 'OLLAMA' || mode === 'CLAUDE' || mode === 'CUSTOM';
        show('ai-baseurl-row', needApi);
        show('ai-apikey-row', needApi);
        show('ai-model-row', needApi);
        show('ai-advanced-row', mode === 'CUSTOM');
        show('ai-test-row', needApi);
    }
    window.applyAIModeUI = applyAIModeUI;

    // API 快捷选择按钮
    document.querySelectorAll('.api-preset-btn').forEach(btn => {
        btn.onclick = () => {
            const mode = btn.dataset.mode || 'CUSTOM';
            let url = btn.dataset.url;
            let model = btn.dataset.model;
            // 内置 API:从预载清单解析端点与模型(带💎/轮费用)
            if (mode === 'BUILTIN') {
                const m = (window.__builtinModels?.models || []).find(x => x.id === btn.dataset.builtin);
                if (!m) { window.showToast('内置模型清单未加载,请重启应用重试', 'error'); return; }
                url = window.__builtinModels.endpoint;
                model = m.model;
            }
            document.getElementById('ai-baseurl').value = url;
            document.getElementById('ai-model').value = model;
            window.aiConfig.setBaseURL(url);
            window.aiConfig.setModelName(model);
            window.aiConfig.setMode(mode);
            document.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('active', x.dataset.mode === mode));
            document.querySelectorAll('.api-preset-btn').forEach(x => x.classList.remove('active'));
            btn.classList.add('active');
            window.applyAIModeUI(mode);
            window.showToast(`已选择 ${btn.textContent}`, 'success');
        };
    });

    // 保存配置
    const saveConfig = () => {
        window.aiConfig.setBaseURL(document.getElementById('ai-baseurl').value);
        window.aiConfig.setApiKey(document.getElementById('ai-apikey').value);
        window.aiConfig.setModelName(document.getElementById('ai-model').value);
        window.aiConfig.setCustomHeaders(document.getElementById('ai-custom-headers').value);
        window.aiConfig.setCustomBody(document.getElementById('ai-custom-body').value);
        window.showToast('AI 设置已保存', 'success');
    };
    document.getElementById('ai-baseurl').onchange = saveConfig;
    document.getElementById('ai-apikey').onchange = saveConfig;
    document.getElementById('ai-model').onchange = saveConfig;
    document.getElementById('ai-custom-headers').onchange = saveConfig;
    document.getElementById('ai-custom-body').onchange = saveConfig;

    // 测试连接
    document.getElementById('ai-test-btn').onclick = async () => {
        const el = document.getElementById('ai-test-result');
        el.textContent = '测试中...';
        el.style.color = 'var(--muted)';
        saveConfig(); // 先保存
        const result = await window.aiConfig.testConnection();
        if (result.ok) el.textContent = `✓ 连接成功 (${result.url || ''})`;
        else el.textContent = '✗ ' + (result.error || `HTTP ${result.status}`) + (result.url ? `\nURL: ${result.url}` : '');
        el.style.color = result.ok ? 'var(--success)' : 'var(--danger)';
    };

    // 数据
    // ===== 关于页 =====
    const fillAboutVersion = () => {
        const el = document.getElementById('about-version-detail');
        if (!el) return;
        if (window.AppInfo) {
            el.textContent = `版本：${window.AppInfo.getVersionName()}（build ${window.AppInfo.getVersionCode()}）\n`
                + '本次更新：情感系统上线——好感/信任数值会真实影响天依的语气与亲近度；对话记忆注入优化，长期相处不再失忆；设备性能智能适配，低配手机自动减少动画与内存占用；输入法不再遮挡输入框；语音识别新增 V 家专属优化词；安装包大幅瘦身。\n'
                + '· 端侧 ASR 双引擎（云端硅基流动 + 端侧 FunASR）\n'
                + '· MiMo 音色克隆语音播报 + 音画同步\n'
                + '· 三层记忆系统 + 内置 API 模型💎计费';
        } else {
            el.textContent = '浏览器预览模式（版本信息仅 Android 端可用）';
        }
    };
    fillAboutVersion();

    document.getElementById('about-check-btn').onclick = () => {
        const result = document.getElementById('about-update-result');
        const row = document.getElementById('about-download-row');
        if (!window.AppInfo) {
            result.textContent = '仅 Android 端支持检查更新';
            return;
        }
        result.textContent = '检查中…';
        row.style.display = 'none';
        setTimeout(() => {
            try {
                const r = JSON.parse(window.AppInfo.checkAppUpdate() || '{}');
                if (r.error) {
                    result.textContent = '✗ ' + r.error;
                } else if (r.hasUpdate) {
                    result.textContent = `🎉 发现新版本：${r.notes || r.version}`;
                    row.style.display = '';
                    document.getElementById('about-download-btn').onclick = () => {
                        if (!window.AppInfo.openUrl(r.url)) window.showToast?.('打开下载链接失败', 'error');
                    };
                } else {
                    result.textContent = '✓ 已是最新版本';
                }
            } catch (e) {
                result.textContent = '✗ 检查失败：' + e.message;
            }
        }, 50);
    };

    document.getElementById('export-save-btn').onclick = async () => {
        const url = await window.saveManager.exportSave();
        if (!url) { window.showToast('没有可导出的存档', 'error'); return; }
        const json = await (await fetch(url)).text();
        // 优先走原生剪贴板（WebView 中 <a download> 不生效）
        let copied = false;
        if (window.AndroidSystem && typeof window.AndroidSystem.copyToClipboard === 'function') {
            try { copied = window.AndroidSystem.copyToClipboard(json); } catch (_) {}
        }
        const root = document.getElementById('modal-root');
        root.innerHTML = '';
        const m = document.createElement('div');
        m.className = 'modal';
        m.style.display = 'flex';
        m.innerHTML = `
            <div class="modal-card">
                <h2>📤 导出存档</h2>
                <p style="color:var(--muted)">${copied ? '已复制到剪贴板，可直接粘贴保存。' : '请手动复制下面的存档内容（很长）。'}</p>
                <textarea readonly class="export-textarea" spellcheck="false"></textarea>
                <div class="modal-actions">
                    <button class="btn btn-primary" id="export-copy-btn">复制存档</button>
                    <button class="btn btn-ghost" id="export-close-btn">关闭</button>
                </div>
            </div>`;
        root.appendChild(m);
        m.querySelector('.export-textarea').value = json;
        m.querySelector('#export-copy-btn').onclick = () => {
            copyTextToClipboard(json);
            window.showToast('存档已复制', 'success');
        };
        m.querySelector('#export-close-btn').onclick = () => m.remove();
    };
    document.getElementById('import-save-btn').onclick = () => {
        const root = document.getElementById('modal-root');
        root.innerHTML = '';
        const m = document.createElement('div');
        m.className = 'modal';
        m.style.display = 'flex';
        m.innerHTML = `
            <div class="modal-card">
                <h2>📥 导入存档</h2>
                <p style="color:var(--muted)">粘贴之前导出的存档 JSON 内容。</p>
                <textarea class="export-textarea" id="import-json-input" placeholder="在此粘贴存档 JSON…" spellcheck="false"></textarea>
                <div id="import-result" class="form-hint" style="margin-top:0.4rem"></div>
                <div class="modal-actions">
                    <button class="btn btn-primary" id="import-confirm-btn">导入</button>
                    <button class="btn btn-ghost" id="import-close-btn">取消</button>
                </div>
            </div>`;
        root.appendChild(m);
        m.querySelector('#import-close-btn').onclick = () => m.remove();
        m.querySelector('#import-confirm-btn').onclick = async () => {
            const text = m.querySelector('#import-json-input').value.trim();
            if (!text) { m.querySelector('#import-result').textContent = '请输入存档内容'; return; }
            const r = await window.saveManager.importSave(text);
            const el = m.querySelector('#import-result');
            if (r.success) {
                el.textContent = '✓ 导入成功，重启后生效';
                el.style.color = 'var(--success)';
                window.showToast('导入成功', 'success');
            } else {
                el.textContent = '✗ 导入失败：' + (r.error || '格式错误');
                el.style.color = 'var(--danger)';
            }
        };
    };
    const openMemoryBtn = document.getElementById('open-memory-btn');
    if (openMemoryBtn) openMemoryBtn.onclick = () => { document.getElementById('settings-modal').style.display = 'none'; openMemory(); };
    document.getElementById('clear-memory-btn').onclick = async () => {
        if (confirm('确认清空所有记忆（短期/中期/长期）？此操作不可恢复。')) {
            // 清空三层记忆库
            if (window.memoryVault?.isInitialized) {
                for (const store of ['short_term', 'mid_term', 'long_term']) {
                    await new Promise(res => {
                        const tx = window.memoryVault.db.transaction(store, 'readwrite');
                        tx.objectStore(store).clear();
                        tx.oncomplete = res; tx.onerror = res;
                    });
                }
                window.showToast('三层记忆已全部清空', 'success');
            } else {
                const r = await window.memoryBridge.clearAll();
                window.showToast(r.success ? '记忆已清空' : '清空失败', r.success ? 'success' : 'error');
            }
        }
    };
}

// 复制文本到剪贴板（WebView 优先原生，回退 navigator.clipboard / execCommand）
function copyTextToClipboard(text) {
    try {
        if (window.AndroidSystem && typeof window.AndroidSystem.copyToClipboard === 'function') {
            if (window.AndroidSystem.copyToClipboard(text)) return true;
        }
    } catch (_) {}
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => {});
            return true;
        }
    } catch (_) {}
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return true;
    } catch (_) {}
    return false;
}

// ============= 开场白剧情 =============
function showOpeningStory() {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const m = document.createElement('div');
    m.className = 'modal opening-story-modal';
    m.style.display = 'flex';

    const storyPages = [
        {
            text: '在遥远的世界尽头，有一个名为「瓦纳海姆」的地方……',
            sub: '那里是歌声与旋律交织的仙境',
            bg: 'linear-gradient(135deg, rgba(63,169,214,0.15), rgba(123,196,232,0.08))'
        },
        {
            text: '天依是那里的歌之少女，拥有能治愈人心的嗓音。',
            sub: '然而一场意外，将她卷入了时空的裂缝……',
            bg: 'linear-gradient(135deg, rgba(244,182,194,0.12), rgba(255,208,229,0.08))',
            audio: ['audio/story/page2.mp3']
        },
        {
            text: '当她再次睁开眼，已置身于一个陌生的世界——地球。',
            sub: '没有熟悉的一切，只有冰冷的雨滴落在身上',
            bg: 'linear-gradient(135deg, rgba(27,56,82,0.2), rgba(14,26,38,0.15))',
            audio: ['audio/story/page3.mp3']
        },
        {
            text: '她独自蜷缩在雨中哭泣，不知道该往哪里去……',
            sub: '就在这时，一把伞停在了她的头顶',
            bg: 'linear-gradient(135deg, rgba(63,169,214,0.1), rgba(95,203,142,0.08))',
            audio: ['audio/story/page4.mp3']
        },
        {
            text: '「你还好吗？跟我回家吧。」',
            sub: '那是你对她说的第一句话',
            bg: 'linear-gradient(135deg, rgba(63,169,214,0.15), rgba(244,182,194,0.1))',
            audio: ['audio/story/page5.mp3']
        },
        {
            text: '从此，天依的世界里多了一个最重要的人。',
            sub: '天依物语——属于你们的故事，现在开始',
            bg: 'linear-gradient(135deg, rgba(63,169,214,0.12), rgba(123,196,232,0.1))',
            audio: ['audio/story/page6.mp3']
        }
    ];

    let currentPage = 0;

    // 预置配音播放器（翻页/退出时自动停止）
    const storyAudio = new Audio();

    function stopStoryAudio() {
        storyAudio.onended = null;
        storyAudio.pause();
        storyAudio.currentTime = 0;
    }

    function renderPage() {
        const page = storyPages[currentPage];
        m.innerHTML = `
            <div class="modal-card opening-story-card" style="background: center/cover no-repeat; height:85vh; display:flex; flex-direction:column; justify-content:flex-end; background-color:transparent">
                <div class="story-text-area" style="background:linear-gradient(transparent, rgba(14,26,38,0.85) 30%, rgba(14,26,38,0.95)); padding-top:3rem">
                    <p class="story-main-text">${page.text}</p>
                    <p class="story-sub-text">${page.sub}</p>
                </div>
                <div class="story-controls" style="background:rgba(14,26,38,0.95)">
                    <span class="story-page-num">${currentPage + 1} / ${storyPages.length}</span>
                    <div class="story-btns">
                        ${currentPage > 0 ? '<button class="btn btn-ghost story-prev-btn">上一页</button>' : ''}
                        ${currentPage < storyPages.length - 1
                            ? '<button class="btn btn-primary story-next-btn">下一页</button>'
                            : '<button class="btn btn-primary story-start-btn">开始故事</button>'
                        }
                    </div>
                </div>
            </div>`;

        // 内存优化档:开场图降采样解码(scaledStoryBg;常规档返回原图)
        scaledStoryBg(`images/story/${currentPage + 1}.jpg`).then(u => {
            const card = m.querySelector('.opening-story-card');
            if (card) card.style.backgroundImage = `url('${u}')`;
        });

        root.appendChild(m);

        const tts = gameEngine?.getModule('TTSManager');
        tts?.stop();

        if (page.audio && tts?.enabled) {
            // 固定剧情使用预置配音
            stopStoryAudio();
            storyAudio.onended = () => {
                const playlist = storyPages[currentPage]?.audio || [];
                if (storyAudio._idx < playlist.length - 1) {
                    storyAudio._idx++;
                    storyAudio.src = playlist[storyAudio._idx];
                    storyAudio.play().catch(() => {});
                }
            };
            storyAudio._idx = 0;
            storyAudio.src = page.audio[0];
            storyAudio.play().catch(() => {});
        } else if (tts) {
            // 无预置配音时回退 TTS
            tts.speakNow(page.text, 'story');
        }

        // 绑定事件
        const prevBtn = m.querySelector('.story-prev-btn');
        const nextBtn = m.querySelector('.story-next-btn');
        const startBtn = m.querySelector('.story-start-btn');
        if (prevBtn) prevBtn.onclick = () => { currentPage--; renderPage(); };
        if (nextBtn) nextBtn.onclick = () => { currentPage++; renderPage(); };
        if (startBtn) startBtn.onclick = () => {
            stopStoryAudio();
            tts?.stop();
            m.remove();
            // 将开场白剧情写入记忆
            if (window.memoryBridge) {
                const storyText = storyPages.map((p, i) => `[第${i + 1}页] ${p.text} ${p.sub}`).join('\n');
                window.memoryBridge.addMemory(storyText, { type: 'story', timestamp: Date.now() });
            }
            // 触发开场事件
            const es = gameEngine?.getModule('EventSystem');
            if (es) es.triggerEvent('openingEvent', true);
            // 显示欢迎气泡
            const ms = gameEngine?.getModule('MainScene');
            const term = window.genderManager?.getTerm() || '哥哥';
            if (ms) ms.showBubble(`${term}，欢迎回家～`);
        };
    }

    renderPage();
}

// ============= 启动 =============
(function initMainScript() {
    if (!window.WebView) {
        // 浏览器直接访问时也支持
    }
    // Konami 彩蛋
    try { new KonamiCode(); } catch (e) {}

    setTimeout(() => {
        const newGameBtn = document.getElementById('new-game-btn');
        const continueBtn = document.getElementById('continue-game-btn');
        if (newGameBtn) newGameBtn.onclick = startNewGame;
        if (continueBtn) continueBtn.onclick = startContinueGame;
        showStartMenu();
    }, 200);
})();

// 暴露给原生调用
window.GameMain = {
    initGame,
    getCurrentGameData,
    getGameEngine: () => gameEngine,
    getGameData: () => gameData,
    isInitialized: () => isGameInitialized
};

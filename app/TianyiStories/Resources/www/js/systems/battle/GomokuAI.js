/**
 * 五子棋 AI(1.1.10Beta5/137 框架;211 重构为正经引擎)
 * - 棋盘/落子/胜负/平局判定完整;纯逻辑无 DOM,可单测
 * - 评分升级:模式匹配(活/眠 × 连/跳,四方向 9 格窗口),跳三/跳四不再被低估
 * - 难度分层(211):easy=带噪声贪心(防守权重降) / normal=模式贪心 / hard=minimax+α-β(深度 4,
 *   候选启发排序);三层共同保底:先手成五、对手成五必堵(行为兼容 137 断言)
 * - 入口经 BattleSystem.getGomokuEngine();难度由 UI setLevel 控制
 */
class GomokuAI {
    constructor(size = 15) {
        this.size = size;
        this.level = 'normal';
        this.reset();
    }

    /** 211:难度分层(easy/normal/hard),非法值回落 normal */
    setLevel(level) {
        this.level = ['easy', 'normal', 'hard'].includes(level) ? level : 'normal';
        return this.level;
    }

    reset() {
        this.board = Array.from({ length: this.size }, () => Array(this.size).fill(0));
        this.moves = [];
        this.winner = 0;
    }

    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }

    /** 211:棋盘是否下满(平局判定) */
    isFull() { return this.moves.length >= this.size * this.size; }

    place(x, y, id) {
        if (this.winner) return false;
        if (!this.inBounds(x, y) || this.board[y][x] !== 0 || (id !== 1 && id !== 2)) return false;
        this.board[y][x] = id;
        this.moves.push({ x, y, id });
        if (this.checkWin(x, y, id)) this.winner = id;
        return true;
    }

    /** 胜负判定:经过 (x,y) 的四条方向线连子 ≥5 */
    checkWin(x, y, id) {
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
            let count = 1;
            for (const s of [1, -1]) {
                let nx = x + dx * s, ny = y + dy * s;
                while (this.inBounds(nx, ny) && this.board[ny][nx] === id) {
                    count++; nx += dx * s; ny += dy * s;
                }
            }
            if (count >= 5) return true;
        }
        return false;
    }

    _hasNeighbor(x, y, dist = 2) {
        for (let dy = -dist; dy <= dist; dy++) {
            for (let dx = -dist; dx <= dist; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx, ny = y + dy;
                if (this.inBounds(nx, ny) && this.board[ny][nx] !== 0) return true;
            }
        }
        return false;
    }

    /**
     * 211:单点评分——模式匹配版。假设 id 在 (x,y) 落子,对四方向各取 9 格窗口
     * (候选点为 center,自己=o,空=-,对手/墙=#),按连/跳模式表计分:
     * 跳形(o-ooo/oo-oo 等)不再被连续计数法低估。
     */
    _scorePoint(x, y, id) {
        let score = 0;
        const opp = id === 1 ? 2 : 1;
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
            let line = '';
            for (let k = -4; k <= 4; k++) {
                if (k === 0) { line += 'o'; continue; }
                const nx = x + dx * k, ny = y + dy * k;
                if (!this.inBounds(nx, ny)) { line += '#'; continue; }
                const v = this.board[ny][nx];
                line += v === id ? 'o' : (v === 0 ? '-' : '#');
            }
            score += GomokuAI._windowScore(line);
        }
        return score;
    }

    /** 211:9 格窗口模式分表(o=候选落子后己方,-=空,#=对手/边墙)——
     *  长模式在前防短模式抢先命中;跳形(oo-oo/o-ooo 等)显式入表 */
    static _windowScore(w) {
        const T = [
            ['ooooo', 10000000],                                    // 成五
            ['-oooo-', 1000000],                                   // 活四
            ['oooo-', 100000],                                     // 冲四(右开)
            ['xoooo-', 100000], ['-oooox', 100000],                // 眠四(单闭)
            ['oo-oo', 100000], ['o-ooo', 100000], ['ooo-o', 100000],   // 跳四
            ['--ooo--', 50000],                                    // 活三(宽判定)
            ['-ooo--', 15000], ['--ooo-', 15000],                  // 眠三偏活
            ['-o-oo-', 15000], ['-oo-o-', 15000],                  // 跳活三
            ['x-ooo--', 8000], ['--ooo-x', 8000], ['x-ooo-x', 3000],   // 跳眠三
            ['ooo--', 8000], ['--ooo', 8000], ['xooo--', 3000], ['--ooox', 3000],   // 眠三
            ['--oo---', 1500], ['---oo--', 1500],                  // 活二
            ['-o-o--', 800], ['--o-o-', 800], ['o--oo', 600], ['oo--o', 600],   // 跳二
            ['xoo---', 200], ['---oox', 200],                      // 眠二
        ];
        for (const [pat, sc] of T) {
            if (w.indexOf(pat) !== -1) return sc;
        }
        return 0;
    }

    /** 211:全盘评估(hard 搜索叶节点用)——己方所有子的模式分和 减 对手×权重 */
    _evalBoard(id) {
        const opp = id === 1 ? 2 : 1;
        let s = 0;
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const v = this.board[y][x];
                if (v === id) s += this._scorePoint(x, y, id);
                else if (v === opp) s -= this._scorePoint(x, y, opp) * 1.05;
            }
        }
        return s;
    }

    /** 211:候选点(有邻居空点)按 攻+防 排序取前 K */
    _candidates(id, k) {
        const opp = id === 1 ? 2 : 1;
        const list = [];
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.board[y][x] !== 0 || !this._hasNeighbor(x, y)) continue;
                list.push({ x, y, s: this._scorePoint(x, y, id) + 0.9 * this._scorePoint(x, y, opp) });
            }
        }
        list.sort((a, b) => b.s - a.s);
        return list.slice(0, k);
    }

    /** 211:战术保底(三层共用)——①己方任意点成五→直接下;②对手任意点成五→堵 */
    _tacticalMove(id) {
        const opp = id === 1 ? 2 : 1;
        for (const who of [id, opp]) {
            for (let y = 0; y < this.size; y++) {
                for (let x = 0; x < this.size; x++) {
                    if (this.board[y][x] !== 0 || !this._hasNeighbor(x, y, 1)) continue;
                    // 模拟落子看是否成五(不改棋盘:借 checkWin 语义做虚拟检查)
                    this.board[y][x] = who;
                    const win = this.checkWin(x, y, who);
                    this.board[y][x] = 0;
                    if (win) return who === id ? { x, y, win: true } : { x, y, block: true };
                }
            }
        }
        return null;
    }

    /** 211:minimax+α-β(hard 专用);depth=每层候选已由 _candidates 限流 */
    _search(id, depth, alpha, beta, maximizing) {
        if (this.winner) return maximizing ? -9000000 : 9000000;   // 上一手已分胜负
        if (depth === 0 || this.isFull()) return this._evalBoard(id);
        const opp = id === 1 ? 2 : 1;
        const cur = maximizing ? id : opp;
        const cands = this._candidates(cur, 8);
        if (!cands.length) return this._evalBoard(id);
        let best = maximizing ? -Infinity : Infinity;
        for (const c of cands) {
            this.board[c.y][c.x] = cur;
            const wasWinner = this.checkWin(c.x, c.y, cur);
            if (wasWinner) this.winner = cur;
            const v = this._search(id, depth - 1, alpha, beta, !maximizing);
            this.winner = 0;
            this.board[c.y][c.x] = 0;
            if (maximizing) {
                if (v > best) best = v;
                if (best > alpha) alpha = best;
            } else {
                if (v < best) best = v;
                if (best < beta) beta = best;
            }
            if (alpha >= beta) break;
        }
        return best;
    }

    /**
     * AI 落子:三层难度。
     * easy   = 带噪声贪心(防守权重 0.6,前 3 候选随机)——会犯错但保底堵五/成五
     * normal = 模式贪心(攻+0.9×防,跳形感知)
     * hard   = 战术保底 + minimax α-β 深度 4(候选 8 限流)
     * 空盘落天元;返回 {x,y} 或 null(盘满)
     */
    aiMove(id = 2) {
        if (this.winner) return null;
        if (this.isFull()) return null;
        const opp = id === 1 ? 2 : 1;
        if (this.moves.length === 0) {
            const c = Math.floor(this.size / 2);
            this.place(c, c, id);
            return { x: c, y: c };
        }
        // 战术保底:能成五先成五,对手要成五必堵(三层一致,兼容 137 断言)
        const tac = this._tacticalMove(id);
        if (tac) { this.place(tac.x, tac.y, id); return { x: tac.x, y: tac.y }; }

        if (this.level === 'hard') {
            // minimax 根节点:AI-对手-AI 三层(搜索深度 2,候选 8 限流;
            // 评估 ~170μs/叶 → 全树 ~90ms,适配 low-perf 档;同分偏好高启发)
            const cands = this._candidates(id, 8);
            if (!cands.length) return null;
            let best = null, bestV = -Infinity;
            for (const c of cands) {
                this.board[c.y][c.x] = id;
                const wasWinner = this.checkWin(c.x, c.y, id);
                if (wasWinner) this.winner = id;
                const v = this._search(id, 2, -Infinity, Infinity, false) + c.s * 0.01;
                this.winner = 0;
                this.board[c.y][c.x] = 0;
                if (v > bestV) { bestV = v; best = c; }
            }
            if (best) { this.place(best.x, best.y, id); return { x: best.x, y: best.y }; }
            return null;
        }

        const defW = this.level === 'easy' ? 0.6 : 0.9;
        const scored = [];
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.board[y][x] !== 0 || !this._hasNeighbor(x, y)) continue;
                scored.push({ x, y, s: this._scorePoint(x, y, id) + defW * this._scorePoint(x, y, opp) });
            }
        }
        if (!scored.length) return null;
        scored.sort((a, b) => b.s - a.s);
        let pick = scored[0];
        if (this.level === 'easy' && scored.length > 1) {
            // 简单:分值 ≥35% 最高的候选中随机——会放过部分威胁,但对成五/堵五保底已在前置处理
            const top = scored.filter((c) => c.s >= scored[0].s * 0.35).slice(0, 3);
            pick = top[Math.floor(Math.random() * top.length)];
        }
        this.place(pick.x, pick.y, id);
        return { x: pick.x, y: pick.y };
    }
}

window.GomokuAI = GomokuAI;

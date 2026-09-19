/**
 * 五子棋 AI 框架(1.1.10Beta5/137 搭建,**暂不开放入口**)
 * - 棋盘/落子/胜负判定完整;AI 为启发式评分贪心(进攻分+防守分),
 *   aiMove 内预留 minimax 深化扩展点
 * - 纯逻辑无 DOM,可单测;入口经 BattleSystem.getGomokuEngine() 预留
 */
class GomokuAI {
    constructor(size = 15) {
        this.size = size;
        this.reset();
    }

    reset() {
        this.board = Array.from({ length: this.size }, () => Array(this.size).fill(0));
        this.moves = [];
        this.winner = 0;
    }

    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }

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

    /** 单点评分:该点对 id 的连子潜力(四方向双向延伸,活/眠区分) */
    _scorePoint(x, y, id) {
        let score = 0;
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
            let cnt = 1, open = 0;
            for (const s of [1, -1]) {
                let nx = x + dx * s, ny = y + dy * s;
                while (this.inBounds(nx, ny) && this.board[ny][nx] === id) {
                    cnt++; nx += dx * s; ny += dy * s;
                }
                if (this.inBounds(nx, ny) && this.board[ny][nx] === 0) open++;
            }
            if (cnt >= 5) score += 100000;              // 成五
            else if (cnt === 4) score += open >= 2 ? 10000 : 1000;  // 活四/眠四
            else if (cnt === 3) score += open >= 2 ? 1000 : 100;    // 活三/眠三
            else score += open >= 2 ? 100 : 10;
        }
        return score;
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
     * AI 落子:空点中取 进攻分 + 0.9×防守分 最高者(贪心);空盘落天元。
     * TODO(框架预留):在此接入 minimax(alpha-beta)深化与开局库
     */
    aiMove(id = 2) {
        if (this.winner) return null;
        const opp = id === 1 ? 2 : 1;
        if (this.moves.length === 0) {
            const c = Math.floor(this.size / 2);
            this.place(c, c, id);
            return { x: c, y: c };
        }
        let best = null, bestScore = -1;
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.board[y][x] !== 0 || !this._hasNeighbor(x, y)) continue;
                const s = this._scorePoint(x, y, id) + 0.9 * this._scorePoint(x, y, opp);
                if (s > bestScore) { bestScore = s; best = { x, y }; }
            }
        }
        if (best) this.place(best.x, best.y, id);
        return best;
    }
}

window.GomokuAI = GomokuAI;

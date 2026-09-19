/**
 * 云同步适配器骨架（服务端未实现 · 契约占位）
 *
 * 【角色】客户端与未来记忆云服务之间的唯一边界。服务器确认后只需实现一个
 * 真实 Adapter（HTTP 调用），替换 NullAdapter 挂载即可，端侧其余代码零改动。
 *
 * 【契约全文】docs/CLOUD_SYNC_CONTRACT.md（含数据 schema/同步协议/检索契约/
 *  跨时空感应协议/目标库建议/验收用例），服务端按文档开发即通。
 *
 * 【约定】
 *  - 所有方法幂等、可重入、失败静默降级（不打断本地功能）
 *  - push 数据 = exportAll() v2 结构（{schema:2, appId, deviceId, mid, long, deletedIds, lastSyncAt}）
 *  - 时空路由：一切请求携带 appId（时空ID）；服务端按时空隔离存储
 *  - 感应红线：crossSense 仅同 userId、仅摘要级、只读、服务端频控
 */
class CloudSyncAdapter {
    /** 探活：服务端可达性 + 版本兼容。返回 {ok, serverTime, supports: {push, pull, recall, crossSense}} */
    async health() { throw new Error('CloudSyncAdapter.health() 未实现'); }

    /**
     * 推送：exportAll() v2 全量/增量数据上传（幂等 upsert + tombstone 上报）。
     * 返回 {ok, syncedAt, ackedDeletedIds}（ACK 的墓碑可本地清理）。
     */
    async push(exportV2) { throw new Error('CloudSyncAdapter.push() 未实现'); }

    /**
     * 拉取：增量变更（since 之后的记录 + tombstone），结构同 exportV2。
     * 返回 {ok, data} 或 {ok, unchanged:true}。
     */
    async pull(since, appId) { throw new Error('CloudSyncAdapter.pull() 未实现'); }

    /**
     * 跨时空感应：读取同 userId 其他 appId 的记忆摘要（【时空回响】数据源）。
     * 入参 {appId, userId, query, topK≤2}；返回 [{content, layer, dateKey, sourceApp}]。
     * 红线：仅同用户、仅 mid/long 摘要级、只读；服务端须独立频控。
     */
    async crossSense(query, opts) { throw new Error('CloudSyncAdapter.crossSense() 未实现'); }

    /** 兼容旧签名：vault.syncToCloud() 走 sync = health+push 组合 */
    async sync(exportV2) {
        const h = await this.health();
        if (!h.ok) return { skipped: true, message: '服务端不可达' };
        return this.push(exportV2);
    }
}

/** 默认空适配器：服务端未上线前挂载，一切云操作静默 no-op（现状行为完全不变） */
class NullCloudAdapter extends CloudSyncAdapter {
    async health() { return { ok: false, reason: 'server_not_configured', supports: {} }; }
    async push() { return { skipped: true, message: '服务端未配置' }; }
    async pull() { return { ok: false, unchanged: true }; }
    async crossSense() { return []; }   // 感应恒空：本地单时空，零成本占位
    async sync() { return { skipped: true, message: '服务端未配置' }; }
}

window.CloudSyncAdapter = CloudSyncAdapter;
window.NullCloudAdapter = NullCloudAdapter;
// 默认挂载（服务器上线后替换为真实 Adapter 实例）
window.memoryVault?.attachCloudSync?.(new NullCloudAdapter());

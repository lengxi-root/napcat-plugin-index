#!/usr/bin/env node
/**
 * NapCat 插件索引校验脚本
 * 
 * 用于 CI 自动审核 PR 中对 plugins.v4.json 的修改：
 * - JSON 格式校验
 * - 必填字段完整性
 * - 插件 ID 唯一性 & 命名规范
 * - 版本号格式（宽松 semver）
 * - 下载链接可达性（HEAD 请求）
 * - homepage 链接可达性
 * - tags 合法性
 * - 与上一版本的 diff 检测（新增/更新/删除）
 * 
 * 用法：
 *   node scripts/validate-plugin.mjs                    # 校验 plugins.v4.json
 *   node scripts/validate-plugin.mjs --diff <base_ref>  # 对比 base 分支，只校验变更的插件
 *   node scripts/validate-plugin.mjs --check-links      # 校验所有插件下载链接（定时巡检用）
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PLUGINS_FILE = resolve(ROOT, 'plugins.v4.json');

// ======================== 配置 ========================

/** 允许的 tags 列表 */
const ALLOWED_TAGS = [
    '官方', '工具', '娱乐', 'AI', '群管', '管理', '自动化',
    '语音', '表情', '撤回', '游戏', '音乐', '图片', '视频',
    '搜索', '翻译', '天气', '签到', '抽奖', '其他',
];

/** 插件 ID 命名规范 */
const PLUGIN_ID_PATTERN = /^napcat-plugin-[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** 宽松版本号格式（支持 1.0 / 1.0.0 / 1.0.0-beta.1 等） */
const VERSION_PATTERN = /^\d+\.\d+(\.\d+)?([.-][a-zA-Z0-9.]+)?$/;

/** 必填字段 */
const REQUIRED_FIELDS = ['id', 'name', 'version', 'description', 'author', 'homepage', 'downloadUrl', 'tags', 'minVersion'];

/** 链接检查超时（毫秒） */
const LINK_CHECK_TIMEOUT = 15000;

/** 链接检查并发数 */
const LINK_CHECK_CONCURRENCY = 5;

// ======================== 工具函数 ========================

const colors = {
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

let errorCount = 0;
let warnCount = 0;

function logError(pluginId, msg) {
    console.error(colors.red(`  ✗ [${pluginId}] ${msg}`));
    errorCount++;
}

function logWarn(pluginId, msg) {
    console.warn(colors.yellow(`  ⚠ [${pluginId}] ${msg}`));
    warnCount++;
}

function logOk(msg) {
    console.log(colors.green(`  ✓ ${msg}`));
}

function logInfo(msg) {
    console.log(colors.cyan(`  ℹ ${msg}`));
}

// ======================== 校验函数 ========================

/**
 * 校验单个插件的字段
 */
function validatePluginFields(plugin, index) {
    const id = plugin.id || `[index=${index}]`;

    // 必填字段检查
    for (const field of REQUIRED_FIELDS) {
        if (plugin[field] === undefined || plugin[field] === null || plugin[field] === '') {
            logError(id, `缺少必填字段: ${field}`);
        }
    }

    // ID 命名规范
    if (plugin.id && !PLUGIN_ID_PATTERN.test(plugin.id)) {
        logError(id, `插件 ID 不符合命名规范 (应为 napcat-plugin-xxx，仅小写字母、数字和连字符): "${plugin.id}"`);
    }

    // 版本号格式
    if (plugin.version && !VERSION_PATTERN.test(plugin.version)) {
        logError(id, `版本号格式不正确 (应为 semver 格式如 1.0.0): "${plugin.version}"`);
    }

    // minVersion 格式
    if (plugin.minVersion && !VERSION_PATTERN.test(plugin.minVersion)) {
        logError(id, `minVersion 格式不正确: "${plugin.minVersion}"`);
    }

    // tags 检查
    if (Array.isArray(plugin.tags)) {
        if (plugin.tags.length === 0) {
            logWarn(id, 'tags 为空数组，建议至少添加一个标签');
        }
        for (const tag of plugin.tags) {
            if (!ALLOWED_TAGS.includes(tag)) {
                logWarn(id, `未知标签 "${tag}"，建议使用: ${ALLOWED_TAGS.join(', ')}`);
            }
        }
    } else if (plugin.tags !== undefined) {
        logError(id, 'tags 必须是字符串数组');
    }

    // downloadUrl 格式检查
    if (plugin.downloadUrl) {
        try {
            const url = new URL(plugin.downloadUrl);
            if (!['http:', 'https:'].includes(url.protocol)) {
                logError(id, `downloadUrl 必须是 http/https 链接`);
            }
            if (!plugin.downloadUrl.endsWith('.zip')) {
                logWarn(id, 'downloadUrl 建议以 .zip 结尾');
            }
        } catch {
            logError(id, `downloadUrl 不是有效的 URL: "${plugin.downloadUrl}"`);
        }
    }

    // homepage 格式检查
    if (plugin.homepage) {
        try {
            new URL(plugin.homepage);
        } catch {
            logError(id, `homepage 不是有效的 URL: "${plugin.homepage}"`);
        }
    }

    // name 长度检查
    if (plugin.name && plugin.name.length > 50) {
        logWarn(id, `插件名称过长 (${plugin.name.length} 字符)，建议不超过 50 字符`);
    }

    // description 长度检查
    if (plugin.description && plugin.description.length > 200) {
        logWarn(id, `描述过长 (${plugin.description.length} 字符)，建议不超过 200 字符`);
    }
}

/**
 * 校验插件 ID 唯一性
 */
function validateUniqueIds(plugins) {
    const idMap = new Map();
    for (let i = 0; i < plugins.length; i++) {
        const id = plugins[i].id;
        if (!id) continue;
        if (idMap.has(id)) {
            logError(id, `插件 ID 重复！首次出现在 index=${idMap.get(id)}，重复出现在 index=${i}`);
        } else {
            idMap.set(id, i);
        }
    }
}

/**
 * 检查链接可达性（HEAD 请求，失败后回退 GET）
 */
async function checkLink(url, timeout = LINK_CHECK_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        // 先尝试 HEAD
        let res = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'follow',
        });

        // 某些 CDN 不支持 HEAD，回退 GET
        if (res.status === 405 || res.status === 403) {
            res = await fetch(url, {
                method: 'GET',
                signal: controller.signal,
                redirect: 'follow',
                headers: { Range: 'bytes=0-0' }, // 只取 1 字节
            });
        }

        clearTimeout(timer);
        return { ok: res.ok, status: res.status };
    } catch (err) {
        clearTimeout(timer);
        return { ok: false, status: 0, error: err.message };
    }
}

/**
 * 批量检查链接（带并发控制）
 */
async function checkLinksWithConcurrency(tasks, concurrency = LINK_CHECK_CONCURRENCY) {
    const results = [];
    for (let i = 0; i < tasks.length; i += concurrency) {
        const batch = tasks.slice(i, i + concurrency);
        const batchResults = await Promise.all(
            batch.map(async ({ id, url, label }) => {
                const result = await checkLink(url);
                return { id, url, label, ...result };
            })
        );
        results.push(...batchResults);
    }
    return results;
}

/**
 * 获取 diff：对比 base 分支，找出变更的插件
 */
function getDiffPlugins(baseRef) {
    try {
        const baseContent = execSync(`git show ${baseRef}:plugins.v4.json`, { encoding: 'utf-8' });
        const baseData = JSON.parse(baseContent);
        const basePlugins = baseData.plugins || [];
        const baseMap = new Map(basePlugins.map(p => [p.id, p]));

        const currentContent = readFileSync(PLUGINS_FILE, 'utf-8');
        const currentData = JSON.parse(currentContent);
        const currentPlugins = currentData.plugins || [];
        const currentMap = new Map(currentPlugins.map(p => [p.id, p]));

        const added = [];
        const updated = [];
        const removed = [];

        for (const plugin of currentPlugins) {
            if (!baseMap.has(plugin.id)) {
                added.push(plugin);
            } else {
                const base = baseMap.get(plugin.id);
                if (JSON.stringify(base) !== JSON.stringify(plugin)) {
                    updated.push({ old: base, new: plugin });
                }
            }
        }

        for (const plugin of basePlugins) {
            if (!currentMap.has(plugin.id)) {
                removed.push(plugin);
            }
        }

        return { added, updated, removed };
    } catch (err) {
        console.error(colors.red(`无法获取 diff: ${err.message}`));
        return null;
    }
}

// ======================== 主流程 ========================

async function main() {
    const args = process.argv.slice(2);
    const isDiff = args.includes('--diff');
    const isCheckLinks = args.includes('--check-links');
    const baseRef = isDiff ? (args[args.indexOf('--diff') + 1] || 'origin/main') : null;

    console.log(colors.bold('\n🔍 NapCat 插件索引校验\n'));

    // 1. 读取并解析 JSON
    if (!existsSync(PLUGINS_FILE)) {
        console.error(colors.red('❌ plugins.v4.json 文件不存在'));
        process.exit(1);
    }

    let data;
    try {
        const content = readFileSync(PLUGINS_FILE, 'utf-8');
        data = JSON.parse(content);
        logOk('JSON 格式正确');
    } catch (err) {
        console.error(colors.red(`❌ JSON 解析失败: ${err.message}`));
        process.exit(1);
    }

    // 2. 顶层结构校验
    if (!data.version) logWarn('root', '缺少 version 字段');
    if (!data.updateTime) logWarn('root', '缺少 updateTime 字段');
    if (!Array.isArray(data.plugins)) {
        logError('root', 'plugins 字段必须是数组');
        process.exit(1);
    }

    logInfo(`共 ${data.plugins.length} 个插件`);

    // 3. 字段校验
    console.log(colors.bold('\n📋 字段校验'));
    for (let i = 0; i < data.plugins.length; i++) {
        validatePluginFields(data.plugins[i], i);
    }

    // 4. ID 唯一性
    console.log(colors.bold('\n🔑 ID 唯一性'));
    validateUniqueIds(data.plugins);
    if (errorCount === 0) logOk('所有插件 ID 唯一');

    // 5. Diff 模式：显示变更
    if (isDiff && baseRef) {
        console.log(colors.bold(`\n📊 变更检测 (对比 ${baseRef})`));
        const diff = getDiffPlugins(baseRef);
        if (diff) {
            if (diff.added.length > 0) {
                logInfo(`新增 ${diff.added.length} 个插件: ${diff.added.map(p => p.id).join(', ')}`);
            }
            if (diff.updated.length > 0) {
                for (const u of diff.updated) {
                    const changes = [];
                    if (u.old.version !== u.new.version) changes.push(`version: ${u.old.version} → ${u.new.version}`);
                    if (u.old.downloadUrl !== u.new.downloadUrl) changes.push('downloadUrl 已更新');
                    if (u.old.description !== u.new.description) changes.push('description 已更新');
                    logInfo(`更新 ${u.new.id}: ${changes.join(', ') || '其他字段变更'}`);
                }
            }
            if (diff.removed.length > 0) {
                logWarn('root', `删除 ${diff.removed.length} 个插件: ${diff.removed.map(p => p.id).join(', ')}`);
            }
            if (diff.added.length === 0 && diff.updated.length === 0 && diff.removed.length === 0) {
                logInfo('plugins.v4.json 无变更');
            }
        }
    }

    // 6. 链接检查
    if (isCheckLinks || isDiff) {
        console.log(colors.bold('\n🔗 链接可达性检查'));

        let pluginsToCheck = data.plugins;

        // diff 模式只检查变更的插件
        if (isDiff && baseRef) {
            const diff = getDiffPlugins(baseRef);
            if (diff) {
                const changedIds = new Set([
                    ...diff.added.map(p => p.id),
                    ...diff.updated.map(u => u.new.id),
                ]);
                pluginsToCheck = data.plugins.filter(p => changedIds.has(p.id));
                if (pluginsToCheck.length === 0) {
                    logInfo('无需检查链接（无变更的插件）');
                } else {
                    logInfo(`检查 ${pluginsToCheck.length} 个变更插件的链接`);
                }
            }
        }

        if (pluginsToCheck.length > 0) {
            const tasks = [];
            for (const plugin of pluginsToCheck) {
                if (plugin.downloadUrl) {
                    tasks.push({ id: plugin.id, url: plugin.downloadUrl, label: 'downloadUrl' });
                }
                if (plugin.homepage) {
                    tasks.push({ id: plugin.id, url: plugin.homepage, label: 'homepage' });
                }
            }

            logInfo(`共 ${tasks.length} 个链接待检查...`);
            const results = await checkLinksWithConcurrency(tasks);

            for (const r of results) {
                if (r.ok) {
                    logOk(`${r.id} ${r.label} → ${r.status}`);
                } else {
                    const detail = r.error ? r.error : `HTTP ${r.status}`;
                    if (r.label === 'downloadUrl') {
                        logError(r.id, `${r.label} 不可达: ${detail} (${r.url})`);
                    } else {
                        logWarn(r.id, `${r.label} 不可达: ${detail} (${r.url})`);
                    }
                }
            }
        }
    }

    // 7. 输出结果
    console.log(colors.bold('\n📊 校验结果'));
    if (errorCount > 0) {
        console.error(colors.red(`  ❌ ${errorCount} 个错误, ${warnCount} 个警告`));
        process.exit(1);
    } else if (warnCount > 0) {
        console.log(colors.yellow(`  ⚠ 0 个错误, ${warnCount} 个警告`));
        console.log(colors.green('  ✅ 校验通过（有警告）'));
    } else {
        console.log(colors.green('  ✅ 校验通过'));
    }
}

main().catch(err => {
    console.error(colors.red(`脚本执行失败: ${err.message}`));
    process.exit(1);
});

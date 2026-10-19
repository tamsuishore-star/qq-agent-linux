// 模块卸载（V1.1.0）
//
// 语义：
// - 禁用：只改配置（不在本文件）
// - 卸载：停用 → 目录移入 data/.trash/ → 清配置 → 注销登记（可恢复）
// - 彻底删除：暂不提供（后续只针对回收站）
//
// 安全约束：
// - 只接受 skill/plugin 两种 kind 与合法 id
// - 路径从已加载模块的 relDir 推导，不接受前端传路径
// - 拒绝符号链接、拒绝越出 skills/ 或 plugins/ 的路径
// - 内置模块禁止卸载
// - 未登记为用户安装的模块禁止卸载

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_DIR, getConfig, updateConfig } from '../config.js';
import { isBuiltin, isUserInstalled, unregister } from './registry.js';

const KINDS = new Set(['skill', 'plugin']);
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function fail(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function kindRoot(kind) {
  return path.resolve(ROOT, kind === 'plugin' ? 'plugins' : 'skills');
}

export async function uninstallModule({ kind, id, skillManager, context = {}, reloadSkills, log = () => {} }) {
  if (!KINDS.has(kind)) throw fail(400, 'BAD_KIND', `不支持的模块类型：${kind}`);
  if (!ID_RE.test(id)) throw fail(400, 'BAD_ID', '模块 id 不合法');

  const skill = skillManager?.registry?.get?.(id);
  if (!skill) throw fail(404, 'NOT_FOUND', `模块不存在：${id}`);

  const relDir = String(skill.relDir || skill.dir || '');
  if (!relDir) throw fail(400, 'NO_DIR', `模块没有可定位的目录：${id}`);

  const root = kindRoot(kind);
  const abs = path.resolve(ROOT, relDir);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw fail(400, 'BAD_PATH', '模块目录不在允许的范围内');
  }

  let st;
  try {
    st = fs.lstatSync(abs);
  } catch {
    throw fail(404, 'DIR_MISSING', '模块目录不存在');
  }
  if (st.isSymbolicLink()) throw fail(400, 'SYMLINK', '拒绝卸载符号链接目录');
  if (!st.isDirectory()) throw fail(400, 'NOT_DIR', '模块路径不是目录');

  if (isBuiltin(id)) throw fail(403, 'BUILTIN', '内置模块只允许禁用，不能卸载');
  if (!isUserInstalled(id)) throw fail(403, 'NOT_USER_INSTALLED', '该模块没有安装登记，已拒绝卸载');

  // 1) 停用（失败则中止，避免“文件删了但运行中还注册着”）
  try {
    skillManager.deactivate(id, context);
  } catch (error) {
    throw fail(500, 'DEACTIVATE_FAILED', `停用失败：${error?.message ?? error}`);
  }

  // 2) 原子移动到回收站（同分区 rename）
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trashDir = path.join(DATA_DIR, '.trash', stamp);
  const dest = path.join(trashDir, `${kind}-${id}`);
  try {
    fs.mkdirSync(trashDir, { recursive: true });
    fs.renameSync(abs, dest);
  } catch (error) {
    // 移动失败：尝试恢复启用，保持原状态
    try { skillManager.activate(id, context); } catch { /* ignore */ }
    throw fail(500, 'MOVE_FAILED', `移入回收站失败：${error?.message ?? error}`);
  }

  // 3) 清理配置中的模块段（整体替换，避免 deepMerge 删不掉键）
  try {
    const skillsCfg = getConfig()?.skills || {};
    if (Object.prototype.hasOwnProperty.call(skillsCfg, id)) {
      const next = { ...skillsCfg };
      delete next[id];
      updateConfig({ skills: { __replace__: next } });
    }
  } catch (error) {
    log(`[uninstall] 清理配置失败（文件已移入回收站）：${id} ${error?.message ?? error}`);
  }

  // 4) 注销登记
  unregister(id);

  // 5) 重扫，让列表立即一致
  try {
    if (typeof reloadSkills === 'function') await reloadSkills({ reason: `uninstall:${id}` });
  } catch (error) {
    log(`[uninstall] 重扫失败：${error?.message ?? error}`);
  }

  log(`[uninstall] ${kind} ${id} -> ${dest}`);
  return { id, kind, trash: dest };
}

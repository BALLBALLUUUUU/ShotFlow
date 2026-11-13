/**
 * 一次性数据迁移：把本机项目库里已有的旧版示例项目升级到最新内容。
 * 逻辑与 app 启动时的自动升级一致（src/domain/sampleUpgrade.ts），
 * 只是不依赖 Electron，方便在改完代码后立刻修复磁盘上的数据。
 *
 * 用法：npx vite-node scripts/upgrade-sample-data.ts [项目库目录]
 * 默认目录：~/Library/Application Support/ShotFlow/projects
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deserializeProject, serializeProject } from '../src/domain/project';
import { metaFromProject, normalizeIndex } from '../src/domain/library';
import { needsSampleUpgrade, upgradedSample } from '../src/domain/sampleUpgrade';

const dir = process.argv[2]
  ?? path.join(os.homedir(), 'Library', 'Application Support', 'ShotFlow', 'projects');
const indexPath = path.join(dir, 'index.json');

if (!fs.existsSync(indexPath)) {
  console.log(`没有找到项目库索引：${indexPath}`);
  process.exit(0);
}

const index = normalizeIndex(JSON.parse(fs.readFileSync(indexPath, 'utf8')));
let next = index;
let upgradedCount = 0;

for (const meta of index.projects) {
  if (meta.deletedAt !== null) {
    console.log(`跳过回收站项目 ${meta.id}`);
    continue;
  }
  const filePath = path.join(dir, `${meta.id}.json`);
  if (!fs.existsSync(filePath)) {
    console.log(`项目文件缺失，跳过 ${meta.id}`);
    continue;
  }
  const project = deserializeProject(fs.readFileSync(filePath, 'utf8'));
  if (!needsSampleUpgrade(project)) {
    console.log(`无需升级：${project.name}（v${project.sampleRevision ?? 0}，${project.shots.length} 镜）`);
    continue;
  }

  const stamp = Date.now().toString(36);
  const backupPath = path.join(dir, `backup-${meta.id}-${stamp}.json`);
  fs.copyFileSync(filePath, backupPath);

  const upgraded = upgradedSample(project);
  fs.writeFileSync(filePath, serializeProject(upgraded), 'utf8');
  next = {
    ...next,
    projects: next.projects.map((item) => (
      item.id === meta.id ? metaFromProject(upgraded, item) : item
    )),
  };
  upgradedCount += 1;
  console.log(
    `已升级：${upgraded.name} → ${upgraded.shots.length} 镜 / `
    + `${upgraded.shots.filter((shot) => shot.frame).length} 张图；备份 ${path.basename(backupPath)}`,
  );
}

if (upgradedCount > 0) {
  fs.writeFileSync(indexPath, JSON.stringify(next), 'utf8');
  console.log(`索引已更新，共升级 ${upgradedCount} 个示例项目。`);
} else {
  console.log('没有需要升级的示例项目。');
}

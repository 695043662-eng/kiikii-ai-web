#!/usr/bin/env npx ts-node
/**
 * #804 存量资产迁移脚本：1号桶(临时) → 2号桶(永久)
 * 
 * 将 1号桶 中属于系统固定资产的文件（如首页卡片视频、Logo、UI底图）
 * 复制到 2号桶，并在复制成功后删除 1号桶中的原文件。
 * 
 * 使用方式：
 *   npx ts-node scripts/migrate-assets.ts [--prefix dev/canvas/2026-07/] [--dry-run] [--delete-source]
 * 
 * 参数说明：
 *   --prefix <path>      要迁移的目录前缀（默认 dev/canvas/）
 *   --dry-run            仅预览，不实际执行复制/删除
 *   --delete-source      复制成功后删除源文件（默认不删除，仅复制）
 *   --size-threshold <KB> 只迁移大于此阈值的文件（单位KB，默认 1024 = 1MB）
 *   --include-video      只迁移视频文件（.mp4/.mov/.avi/.webm）
 *   --include-image      只迁移图片文件（.png/.jpg/.jpeg/.webp/.gif）
 * 
 * 示例：
 *   # 预览迁移（不执行任何操作）
 *   npx ts-node scripts/migrate-assets.ts --prefix dev/canvas/2026-07/ --dry-run
 * 
 *   # 迁移大于 1MB 的视频文件，并删除源文件
 *   npx ts-node scripts/migrate-assets.ts --prefix dev/canvas/2026-07/ --include-video --size-threshold 1024 --delete-source
 * 
 *   # 迁移所有文件（不删除源文件）
 *   npx ts-node scripts/migrate-assets.ts --prefix dev/canvas/
 * 
 * 前置条件：
 *   1. 项目根目录存在 .env.local 文件，包含以下变量：
 *      - COS_SECRET_ID / COS_SECRET_KEY
 *      - NEXT_PUBLIC_COS_BUCKET_TEMP (1号桶名)
 *      - NEXT_PUBLIC_COS_BUCKET_PERM (2号桶名)
 *      - NEXT_PUBLIC_COS_REGION (区域，如 ap-hongkong)
 *   2. SecretKey 对两个桶都有读写权限
 *   3. 已安装依赖：cos-nodejs-sdk-v5（项目已有）
 */

import COS from 'cos-nodejs-sdk-v5';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 加载环境变量
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ============ 配置 ============

const SECRET_ID = process.env.COS_SECRET_ID || '';
const SECRET_KEY = process.env.COS_SECRET_KEY || '';
const TEMP_BUCKET = process.env.NEXT_PUBLIC_COS_BUCKET_TEMP || '';
const PERM_BUCKET = process.env.NEXT_PUBLIC_COS_BUCKET_PERM || '';
const REGION = process.env.NEXT_PUBLIC_COS_REGION || 'ap-hongkong';

// 视频扩展名
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv']);
// 图片扩展名
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp']);

// ============ 参数解析 ============

interface MigrateOptions {
  prefix: string;
  dryRun: boolean;
  deleteSource: boolean;
  sizeThreshold: number; // KB
  includeVideo: boolean;
  includeImage: boolean;
}

function parseArgs(): MigrateOptions {
  const args = process.argv.slice(2);
  const options: MigrateOptions = {
    prefix: 'dev/canvas/',
    dryRun: false,
    deleteSource: false,
    sizeThreshold: 1024, // 默认 1MB
    includeVideo: false,
    includeImage: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--prefix':
        options.prefix = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--delete-source':
        options.deleteSource = true;
        break;
      case '--size-threshold':
        options.sizeThreshold = parseInt(args[++i], 10);
        break;
      case '--include-video':
        options.includeVideo = true;
        break;
      case '--include-image':
        options.includeImage = true;
        break;
      default:
        console.warn(`⚠️ 未知参数: ${args[i]}`);
    }
  }

  // 如果没有指定任何类型过滤，则迁移所有类型
  if (!options.includeVideo && !options.includeImage) {
    options.includeVideo = true;
    options.includeImage = true;
  }

  return options;
}

// ============ 主逻辑 ============

async function main() {
  const options = parseArgs();

  console.log('='.repeat(60));
  console.log('📦 #804 存量资产迁移：1号桶(临时) → 2号桶(永久)');
  console.log('='.repeat(60));
  console.log(`🔑 1号桶(TEMP): ${TEMP_BUCKET}`);
  console.log(`🔐 2号桶(PERM): ${PERM_BUCKET}`);
  console.log(`🌍 区域: ${REGION}`);
  console.log(`📁 目录前缀: ${options.prefix}`);
  console.log(`📊 文件大小阈值: ${options.sizeThreshold}KB`);
  console.log(`🎬 包含视频: ${options.includeVideo}`);
  console.log(`🖼️  包含图片: ${options.includeImage}`);
  console.log(`🧪 预览模式: ${options.dryRun ? '是(不执行)' : '否(实际执行)'}`);
  console.log(`🗑️  删除源文件: ${options.deleteSource ? '是' : '否'}`);
  console.log('='.repeat(60));

  // 验证配置
  if (!SECRET_ID || !SECRET_KEY) {
    console.error('❌ 缺少 COS_SECRET_ID 或 COS_SECRET_KEY，请检查 .env.local');
    process.exit(1);
  }
  if (!TEMP_BUCKET) {
    console.error('❌ 缺少 NEXT_PUBLIC_COS_BUCKET_TEMP，请检查 .env.local');
    process.exit(1);
  }
  if (!PERM_BUCKET) {
    console.error('❌ 缺少 NEXT_PUBLIC_COS_BUCKET_PERM，请检查 .env.local');
    process.exit(1);
  }
  if (TEMP_BUCKET === PERM_BUCKET) {
    console.error('❌ 1号桶和2号桶不能是同一个桶！');
    process.exit(1);
  }

  // 初始化 COS 客户端
  const cos = new COS({
    SecretId: SECRET_ID,
    SecretKey: SECRET_KEY,
  });

  // 1. 列出 1号桶中指定前缀的所有文件
  console.log(`\n📋 正在列出 1号桶 ${TEMP_BUCKET} 中 ${options.prefix} 下的文件...`);

  const allObjects: COS.CosObject[] = [];
  let marker: string | undefined;

  do {
    const result = await new Promise<any>((resolve, reject) => {
      cos.getBucket({
        Bucket: TEMP_BUCKET,
        Region: REGION,
        Prefix: options.prefix,
        Marker: marker,
        MaxKeys: 1000,
      }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    if (result.Contents) {
      allObjects.push(...result.Contents);
    }
    marker = result.NextMarker;
  } while (marker);

  console.log(`📋 共找到 ${allObjects.length} 个文件`);

  if (allObjects.length === 0) {
    console.log('✅ 没有需要迁移的文件');
    return;
  }

  // 2. 过滤文件
  const filteredObjects = allObjects.filter(obj => {
    const key = obj.Key!;
    const sizeKB = Number(obj.Size || 0) / 1024;
    const ext = path.extname(key).toLowerCase();

    // 大小过滤
    if (sizeKB < options.sizeThreshold) return false;

    // 类型过滤
    if (options.includeVideo && VIDEO_EXTENSIONS.has(ext)) return true;
    if (options.includeImage && IMAGE_EXTENSIONS.has(ext)) return true;

    return false;
  });

  console.log(`📋 过滤后剩余 ${filteredObjects.length} 个文件（>${options.sizeThreshold}KB）\n`);

  if (filteredObjects.length === 0) {
    console.log('✅ 没有符合过滤条件的文件需要迁移');
    return;
  }

  // 3. 预览/执行迁移
  let successCount = 0;
  let failCount = 0;
  let deleteCount = 0;

  for (let i = 0; i < filteredObjects.length; i++) {
    const obj = filteredObjects[i];
    const key = obj.Key!;
    const sizeMB = (Number(obj.Size || 0) / 1024 / 1024).toFixed(2);
    const progress = `[${i + 1}/${filteredObjects.length}]`;

    if (options.dryRun) {
      console.log(`🧪 ${progress} [预览] ${key} (${sizeMB}MB) → 2号桶 ${PERM_BUCKET}/${key}`);
      successCount++;
      continue;
    }

    try {
      // 3.1 复制到 2号桶
      console.log(`📤 ${progress} 复制: ${key} (${sizeMB}MB) → 2号桶...`);

      await new Promise((resolve, reject) => {
        cos.sliceCopyFile({
          Bucket: PERM_BUCKET,
          Region: REGION,
          Key: key,
          Source: {
            Bucket: TEMP_BUCKET,
            Region: REGION,
            Key: key,
          },
        } as any, (err: any, data: any) => {
          if (err) reject(err);
          else resolve(data);
        });
      });

      console.log(`✅ ${progress} 复制成功: ${key}`);
      successCount++;

      // 3.2 删除源文件（如果指定）
      if (options.deleteSource) {
        console.log(`🗑️  ${progress} 删除源文件: ${key}`);

        await new Promise((resolve, reject) => {
          cos.deleteObject({
            Bucket: TEMP_BUCKET,
            Region: REGION,
            Key: key,
          }, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });

        console.log(`🗑️  ${progress} 源文件已删除: ${key}`);
        deleteCount++;
      }

    } catch (error: any) {
      console.error(`❌ ${progress} 迁移失败: ${key}`, error.message || error);
      failCount++;
    }
  }

  // 4. 汇总报告
  console.log('\n' + '='.repeat(60));
  console.log('📊 迁移报告');
  console.log('='.repeat(60));
  console.log(`✅ 成功: ${successCount}`);
  console.log(`❌ 失败: ${failCount}`);
  console.log(`🗑️  已删除源文件: ${deleteCount}`);

  if (options.dryRun) {
    console.log('\n🧪 这是预览模式，没有实际执行任何操作');
    console.log('💡 去掉 --dry-run 参数即可实际执行迁移');
  }

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ 迁移脚本异常:', err);
  process.exit(1);
});

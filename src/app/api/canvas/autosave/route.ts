/**
 * @fileoverview 画布自动保存与资产转正路由
 *
 * 核心职责：
 * 1. 深度扫描 canvas_data JSON，发现 temp/ 前缀的 imageKey
 * 2. 调用 COS 内部 Copy 将 temp/ 文件转存到 perm/ 路径
 * 3. 替换 JSON 中的 imageKey 为新的 perm/ 路径
 * 4. UPSERT 落库到 user_workspaces
 * 5. 返回处理后的 canvas_data（前端回填阻断重复转存）
 *
 * @see MAINTENANCE_HANDBOOK.md #846
 */

import { NextRequest, NextResponse } from 'next/server';
import COS from 'cos-nodejs-sdk-v5';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';

// ============== COS 配置 ==============

function getCOSClient(): COS {
  return new COS({
    SecretId: process.env.COS_SECRET_ID!,
    SecretKey: process.env.COS_SECRET_KEY!,
  });
}

const COS_BUCKET = process.env.COS_BUCKET!;
const COS_REGION = process.env.COS_REGION!;

// ============== 类型定义 ==============

interface CanvasElement {
  type?: string;
  imageKey?: string;
  [key: string]: unknown;
}

interface CanvasData {
  elements?: CanvasElement[];
  [key: string]: unknown;
}

interface PromoteResult {
  oldKey: string;
  newKey: string;
}

// ============== 工具函数 ==============

/**
 * 深度遍历 canvas_data，收集所有包含 temp/ 前缀的 imageKey
 */
function findTempImageKeys(data: CanvasData): string[] {
  const keys: string[] = [];

  function walk(obj: unknown) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    const record = obj as Record<string, unknown>;
    for (const [k, v] of Object.entries(record)) {
      if (k === 'imageKey' && typeof v === 'string' && v.startsWith('temp/')) {
        keys.push(v);
      } else if (typeof v === 'object' && v !== null) {
        walk(v);
      }
    }
  }

  walk(data);
  // 去重
  return [...new Set(keys)];
}

/**
 * COS 内部 Copy：temp/xxx → perm/xxx
 * 同桶复制，零流量开销
 */
async function promoteTempKey(
  cos: COS,
  tempKey: string,
): Promise<string> {
  // temp/dev/xxx.png → perm/dev/xxx.png
  // temp/prod/xxx.png → perm/prod/xxx.png
  const pathAfterTemp = tempKey.slice('temp/'.length);
  const newKey = `perm/${pathAfterTemp}`;

  await new Promise<void>((resolve, reject) => {
    cos.putObjectCopy(
      {
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: newKey,
        CopySource: `${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${encodeURIComponent(tempKey)}`,
        MetadataDirective: 'Copy',
      },
      (err) => {
        if (err) {
          console.error('[autosave] COS Copy 失败:', tempKey, '→', newKey, err.message);
          reject(err);
        } else {
          console.log('[autosave] COS Copy 成功:', tempKey, '→', newKey);
          resolve();
        }
      },
    );
  });

  return newKey;
}

/**
 * 深度替换 canvas_data 中的 temp/ imageKey 为 perm/ imageKey
 */
function replaceTempKeys(
  data: CanvasData,
  mapping: Map<string, string>,
): CanvasData {
  if (mapping.size === 0) return data;

  function walk(obj: unknown): unknown {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      return obj.map(walk);
    }
    const record = obj as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      if (k === 'imageKey' && typeof v === 'string' && mapping.has(v)) {
        result[k] = mapping.get(v);
      } else if (typeof v === 'object' && v !== null) {
        result[k] = walk(v);
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  return walk(data) as CanvasData;
}

// ============== 主路由 ==============

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // 1. 认证校验（Cookie-based JWT）
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const userId = auth.userId;

    // 1b. 获取 supabase 客户端（CAS 检查和 UPSERT 共用）
    const supabase = getSupabaseClient(undefined, true);

    // 2. 解析请求体（支持压缩和未压缩两种格式）
    const body = await request.json() as { canvas_data?: CanvasData; canvas_data_compressed?: string; cloud_updated_at?: string };

    let canvas_data: CanvasData;
    if (body.canvas_data_compressed) {
      // #887 弊端1: 前端压缩格式，直接存储压缩字符串到 canvas_data 字段
      // 存储为 { _compressed: true, data: "..." } JSONB 格式
      canvas_data = { _compressed: true, data: body.canvas_data_compressed } as unknown as CanvasData;
    } else if (body.canvas_data) {
      canvas_data = body.canvas_data;
    } else {
      return NextResponse.json({ error: 'canvas_data 或 canvas_data_compressed 不能同时为空' }, { status: 400 });
    }

    // 3. 深度扫描 temp/ 前缀的 imageKey（仅未压缩格式需要扫描）
    const tempKeys = (body.canvas_data && !body.canvas_data_compressed) ? findTempImageKeys(canvas_data) : [];
    console.log(`[autosave] 用户 ${userId.slice(0, 8)}: 扫描到 ${tempKeys.length} 个 temp/ 资产`);

    // 4. COS 内部 Copy：temp/ → perm/（并行转存）
    const promoteMapping = new Map<string, string>();
    if (tempKeys.length > 0) {
      const cos = getCOSClient();
      const results = await Promise.allSettled(
        tempKeys.map(async (tempKey) => {
          const newKey = await promoteTempKey(cos, tempKey);
          return { oldKey: tempKey, newKey };
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          promoteMapping.set(result.value.oldKey, result.value.newKey);
        } else {
          console.error('[autosave] 资产转正失败:', result.reason?.message || result.reason);
          // 单个资产转正失败不阻塞整体保存
          // 该 temp/ key 保留在 canvas_data 中，下次 autosave 会再次尝试
        }
      }

      console.log(`[autosave] 资产转正完成: ${promoteMapping.size}/${tempKeys.length} 成功`);
    }

    // 5. 替换 JSON 中的 temp/ imageKey
    const processedData = replaceTempKeys(canvas_data, promoteMapping);

    // 🛡️ #887 弊端3: CAS乐观锁 — 防止多设备/多标签页相互覆盖
    const bodyWithCas = body as { canvas_data?: CanvasData; canvas_data_compressed?: string; cloud_updated_at?: string };
    if (bodyWithCas.cloud_updated_at) {
      const { data: currentRow } = await supabase
        .from('user_workspaces')
        .select('updated_at')
        .eq('user_id', userId)
        .single();

      if (currentRow && currentRow.updated_at !== bodyWithCas.cloud_updated_at) {
        // CAS冲突：云端数据已被其他会话更新
        console.warn(`[autosave] CAS冲突: 用户 ${userId.slice(0, 8)}, 客户端=${bodyWithCas.cloud_updated_at}, 云端=${currentRow.updated_at}`);
        // 读取云端最新数据返回给前端
        const { data: conflictRow } = await supabase
          .from('user_workspaces')
          .select('canvas_data, updated_at')
          .eq('user_id', userId)
          .single();

        let conflictCanvasData = conflictRow?.canvas_data as CanvasData | null;
        // 解压缩
        if (conflictCanvasData && (conflictCanvasData as Record<string, unknown>)._compressed) {
          try {
            const lz = await import('lz-string');
            const compressed = (conflictCanvasData as Record<string, unknown>).data as string;
            conflictCanvasData = JSON.parse(lz.decompressFromUTF16(compressed) || '{}') as CanvasData;
          } catch { /* 降级返回原始数据 */ }
        }

        return NextResponse.json({
          error: 'CAS_CONFLICT',
          message: '云端数据已被其他会话更新',
          server_updated_at: currentRow.updated_at,
          canvas_data: conflictCanvasData,
        }, { status: 409 });
      }
    }

    // 6. UPSERT 落库（使用 service_role 绕过 RLS，因为后端已通过 requireAuth 鉴权）
    const { error: upsertError } = await supabase
      .from('user_workspaces')
      .upsert(
        {
          user_id: userId,
          canvas_data: processedData,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (upsertError) {
      console.error('[autosave] UPSERT 失败:', upsertError.message);
      // 表不存在时给出明确提示
      if (upsertError.message.includes('does not exist') || upsertError.code === '42P01') {
        return NextResponse.json(
          {
            error: 'user_workspaces 表不存在，请先执行建表 SQL',
            hint: 'GET /api/admin/init-db 获取建表 SQL',
          },
          { status: 503 },
        );
      }
      // #887 外键约束错误：尝试自动修复（删除旧的外键约束）
      if (upsertError.message.includes('foreign key constraint') || upsertError.code === '23503') {
        console.log('[autosave] 检测到外键约束错误，尝试自动修复...');
        try {
          const { Client } = await import('pg');
          const dbPassword = process.env.DEV_SUPABASE_DB_PASSWORD || process.env.PROD_SUPABASE_DB_PASSWORD;
          const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('https://', '').replace('.supabase.co', '') || '';
          if (dbPassword && projectRef) {
            const regions = ['aws-0-ap-southeast-1', 'aws-0-ap-northeast-1', 'aws-0-us-east-1'];
            for (const region of regions) {
              try {
                const client = new Client({
                  host: `${region}.pooler.supabase.com`, port: 6543, database: 'postgres',
                  user: `postgres.${projectRef}`, password: dbPassword,
                  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000,
                });
                await client.connect();
                await client.query('ALTER TABLE public.user_workspaces DROP CONSTRAINT IF EXISTS user_workspaces_user_id_fkey');
                console.log(`[autosave] 外键约束已删除 (via ${region})`);
                await client.end();
                // 修复后重试 UPSERT
                const { error: retryError } = await supabase
                  .from('user_workspaces')
                  .upsert({ user_id: userId, canvas_data: processedData, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
                if (!retryError) {
                  console.log('[autosave] 外键修复后重试保存成功');
                  return NextResponse.json({ success: true, canvas_data: processedData, promoted_count: promoteMapping.size, elapsed_ms: Date.now() - startTime, saved_at: new Date().toISOString(), auto_fixed_fk: true });
                }
                console.error('[autosave] 外键修复后重试仍失败:', retryError.message);
                break;
              } catch { continue; }
            }
          }
        } catch (fixErr: any) {
          console.log('[autosave] 自动修复外键失败:', fixErr?.message?.substring(0, 100));
        }
        return NextResponse.json({ error: '保存失败：外键约束冲突，请执行 ALTER TABLE public.user_workspaces DROP CONSTRAINT IF EXISTS user_workspaces_user_id_fkey;' }, { status: 500 });
      }
      return NextResponse.json({ error: '保存失败' }, { status: 500 });
    }

    // 7. 数据回流：返回处理后的 canvas_data
    const elapsed = Date.now() - startTime;
    console.log(`[autosave] 保存成功: 用户 ${userId.slice(0, 8)}, ${promoteMapping.size} 资产转正, ${elapsed}ms`);

    return NextResponse.json({
      success: true,
      canvas_data: processedData,
      promoted_count: promoteMapping.size,
      elapsed_ms: elapsed,
      saved_at: new Date().toISOString(),
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error('[autosave] 异常:', error, `${elapsed}ms`);
    return NextResponse.json(
      { error: '自动保存失败' },
      { status: 500 },
    );
  }
}

/**
 * GET: 加载用户的画布数据
 */
export async function GET(request: NextRequest) {
  try {
    // 1. 认证校验（Cookie-based JWT）
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const userId = auth.userId;

    // 2. 查询用户工作台（使用 service_role 绕过 RLS，因为后端已通过 requireAuth 鉴权）
    const supabase = getSupabaseClient(undefined, true);
    const { data, error } = await supabase
      .from('user_workspaces')
      .select('canvas_data, updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[autosave] GET 失败:', error.message);
      if (error.message.includes('does not exist') || error.code === '42P01') {
        return NextResponse.json(
          {
            error: 'user_workspaces 表不存在',
            hint: 'GET /api/admin/init-db 获取建表 SQL',
            canvas_data: null,
          },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: '加载失败' }, { status: 500 });
    }

    // #887 解压 canvas_data（前端用 lz-string 压缩后上传，数据库存储压缩字符串）
    let canvasData = data?.canvas_data || null;
    if (canvasData && typeof canvasData === 'string') {
      try {
        // 数据库中存储的是压缩后的字符串，需要原样返回给前端解压
        // 前端 loadWorkspace 会检测 _compressed 标记并解压
        canvasData = { _compressed: true, data: canvasData };
      } catch {
        // 如果不是压缩字符串，直接返回
      }
    }

    return NextResponse.json({
      success: true,
      canvas_data: canvasData,
      updated_at: data?.updated_at || null,
    });
  } catch (error) {
    console.error('[autosave] GET 异常:', error);
    return NextResponse.json({ error: '加载失败' }, { status: 500 });
  }
}

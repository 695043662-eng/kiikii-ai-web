import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

let envLoaded = false;
let localEnv: Record<string, string> | null = null;

// #210 安全重构：使用新变量名，避免与系统环境变量冲突
// 新变量名：SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY
// 标准 Supabase URL 变量名

// 优先从 .env.local 或 .env.production 读取配置
function loadLocalEnv(): Record<string, string> {
  if (localEnv) return localEnv;
  
  const result: Record<string, string> = {};
  
  // #859 军规修复：禁止加载 .env.production（AGENTS.md #0.1 明确规定只使用 .env.local）
  // 历史教训：.env.production 曾导致生产环境连接到开发数据库
  // 如需切换环境，通过修改 .env.local 中的变量值实现
  
  // 尝试加载 .env.local（开发和生产统一使用此文件）
  try {
    const localPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(localPath)) {
      const content = fs.readFileSync(localPath, 'utf-8');
      parseEnvContent(content, result);
    }
  } catch {
    // ignore
  }
  
  localEnv = result;
  return result;
}

function parseEnvContent(content: string, result: Record<string, string>): void {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.substring(0, eq).trim();
      let value = trimmed.substring(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // 不覆盖已存在的值（.env.production 优先）
      if (!result[key]) {
        result[key] = value;
      }
    }
  }
}

interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

function loadEnv(): void {
  if (envLoaded) {
    return;
  }

  // 加载本地环境文件
  const localEnvValues = loadLocalEnv();
  
  // #210 使用新变量名，直接从环境变量或本地文件读取
  // 不再有硬编码兜底，确保代码库安全
  
  const url = process.env.SUPABASE_URL || localEnvValues.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || localEnvValues.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || localEnvValues.SUPABASE_SERVICE_ROLE_KEY;
  
  if (url && anonKey) {
    process.env.SUPABASE_URL = url;
    process.env.SUPABASE_ANON_KEY = anonKey;
    if (serviceRoleKey) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;
    }
    
    const isDev = process.env.NODE_ENV === 'development' || localEnvValues.NODE_ENV === 'development';
    console.log(`[supabase-client] ${isDev ? '🔧 开发模式' : '🚀 生产模式'}：数据库 ${url.substring(0, 40)}...`);
    envLoaded = true;
    return;
  }

  // 尝试从 dotenv 加载
  try {
    require('dotenv').config();
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      envLoaded = true;
      return;
    }
  } catch {
    // dotenv not available
  }

  // 安全重构：移除了 execSync + Python 的 coze_workload_identity 加载逻辑
  // 这是一个严重的安全隐患（RCE 向量），已被物理切除。
  // 如果需要 coze workload identity，应在服务器启动前通过外部脚本
  // 将环境变量写入 .env.local，而非在 Node.js 运行时执行 Python 代码。
  console.warn('[supabase-client] 未找到数据库配置，请确保 .env.local 或 .env.production 已正确配置');
}

function getSupabaseCredentials(): SupabaseCredentials {
  const localEnvValues = loadLocalEnv();
  
  // #210 使用新变量名
  const url = process.env.SUPABASE_URL || localEnvValues.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || localEnvValues.SUPABASE_ANON_KEY || '';

  if (!url) {
    throw new Error('SUPABASE_URL is not set. Please check .env.local (dev) or .env.production (prod)');
  }
  if (!anonKey) {
    throw new Error('SUPABASE_ANON_KEY is not set. Please check .env.local (dev) or .env.production (prod)');
  }
  
  // #837 去掉每次调用都打印的日志，避免日志风暴
  return { url, anonKey };
}

/**
 * #837 读风暴修复：Supabase 客户端单例池
 * 
 * 之前每次调用 getSupabaseClient() 都 createClient()，产生：
 * 1. 不必要的对象创建开销
 * 2. 每次都打印 console.log（#837 一起去掉，改为仅首次打印）
 * 3. 潜在的连接数膨胀
 * 
 * 现在按 (url, key) 组合缓存单例，同一配置复用同一 client 实例
 */
const clientPool = new Map<string, SupabaseClient>();

function getOrCreateClient(url: string, key: string, options: Record<string, any> = {}): SupabaseClient {
  const poolKey = `${url}::${key.substring(0, 12)}::${!!options.global?.headers?.Authorization}`;
  const cached = clientPool.get(poolKey);
  if (cached) return cached;

  const client = createClient(url, key, {
    db: { timeout: 60000 },
    auth: { autoRefreshToken: false, persistSession: false },
    // #859 斩断 Supabase 底层 fetch 的 Next.js Data Cache 死锁
    // Next.js App Router 会自动拦截全局 fetch 并缓存，必须显式注入 no-store
    global: {
      fetch: (input: any, init?: any) => fetch(input, { ...init, cache: 'no-store' }),
    },
    ...options,
  });
  clientPool.set(poolKey, client);
  return client;
}

/**
 * 🔥 #849 P0 修复：Token 客户端有界 LRU 连接池
 * 
 * 旧漏洞：每个带 token 的请求都 createClient() → 高并发下数百个实例 → 连接池雪崩
 * 
 * 修复策略：
 * 1. 按 token 哈希（前 16 字符）缓存复用 client 实例
 * 2. 硬上限 MAX_TOKEN_CLIENTS=200，超限时淘汰最久未访问的实例
 * 3. 周期性清理（每 10 分钟清理过期 token 的 client）
 */
const MAX_TOKEN_CLIENTS = 200;
const tokenClientPool = new Map<string, { client: SupabaseClient; lastAccess: number }>();

function getOrCreateTokenClient(url: string, anonKey: string, token: string): SupabaseClient {
  // 用 token 前 16 字符做 key（完整 token 太长，前 16 足够区分）
  const tokenKey = `${url}::${token.substring(0, 16)}`;
  const cached = tokenClientPool.get(tokenKey);
  if (cached) {
    cached.lastAccess = Date.now();
    return cached.client;
  }

  // 超上限时 LRU 淘汰：删除最久未访问的 25%
  if (tokenClientPool.size >= MAX_TOKEN_CLIENTS) {
    const entries = Array.from(tokenClientPool.entries()).sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toDelete = Math.floor(MAX_TOKEN_CLIENTS / 4);
    for (let i = 0; i < toDelete; i++) {
      tokenClientPool.delete(entries[i][0]);
    }
    console.log(`[supabase-client] Token 连接池 LRU 淘汰: 删除 ${toDelete} 个，剩余 ${tokenClientPool.size}`);
  }

  const client = createClient(url, anonKey, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      // #859 斩断 Supabase 底层 fetch 的 Next.js Data Cache 死锁
      fetch: (input: any, init?: any) => fetch(input, { ...init, cache: 'no-store' }),
    },
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  tokenClientPool.set(tokenKey, { client, lastAccess: Date.now() });
  return client;
}

// 🔥 #849 周期清理过期 token client（每 10 分钟清理 30 分钟未访问的）
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    const THIRTY_MINUTES = 30 * 60 * 1000;
    for (const [key, entry] of tokenClientPool.entries()) {
      if (now - entry.lastAccess > THIRTY_MINUTES) {
        tokenClientPool.delete(key);
      }
    }
  }, 10 * 60 * 1000);
}

function getSupabaseClient(token?: string, useServiceRole: boolean = false): SupabaseClient {
  const localEnvValues = loadLocalEnv();
  
  // #210 使用新变量名，不再有硬编码兜底
  const url = process.env.SUPABASE_URL || localEnvValues.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || localEnvValues.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || localEnvValues.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL is not set. Please check .env.local (dev) or .env.production (prod)');
  }
  
  // #837 仅首次打印，避免每次 API 调用都刷日志
  const isDev = process.env.NODE_ENV === 'development' || localEnvValues.NODE_ENV === 'development';
  if (!envLoaded) {
    console.log(`[supabase-client] ${isDev ? '🔧 开发模式' : '🚀 生产模式'}：数据库 ${url.substring(0, 40)}...`);
    envLoaded = true;
  }

  // 使用服务角色密钥时，绕过 RLS
  if (useServiceRole && serviceRoleKey) {
    return getOrCreateClient(url, serviceRoleKey);
  }

  if (!anonKey) {
    throw new Error('SUPABASE_ANON_KEY is not set. Please check .env.local (dev) or .env.production (prod)');
  }

  if (token) {
    // 🔥 #849 P0 修复：带 token 的 client 也进池，防止连接池雪崩
    // 旧漏洞：每次请求 new createClient() → 高并发下数百个 SupabaseClient 实例 → 
    //         每个实例独立 fetch 连接 → Supabase PostgREST 连接池耗尽 → 全站 500
    // 修复：按 token 哈希缓存复用，设硬上限 + LRU 淘汰
    return getOrCreateTokenClient(url, anonKey, token);
  }

  return getOrCreateClient(url, anonKey);
}

export { loadEnv, getSupabaseCredentials, getSupabaseClient };

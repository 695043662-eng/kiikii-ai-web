import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
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
  
  // 尝试加载 .env.production（生产环境优先）
  try {
    const prodPath = path.join(process.cwd(), '.env.production');
    if (fs.existsSync(prodPath)) {
      const content = fs.readFileSync(prodPath, 'utf-8');
      parseEnvContent(content, result);
    }
  } catch {
    // ignore
  }
  
  // 尝试加载 .env.local（开发环境）
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

  // 尝试从 coze workload identity 获取
  try {
    const pythonCode = `
import os
import sys
try:
    from coze_workload_identity import Client
    client = Client()
    env_vars = client.get_project_env_vars()
    client.close()
    for env_var in env_vars:
        print(f"{env_var.key}={env_var.value}")
except Exception as e:
    print(f"# Error: {e}", file=sys.stderr)
`;

    const output = execSync(`python3 -c '${pythonCode.replace(/'/g, "'\"'\"'")}'`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = output.trim().split('\n');
    for (const line of lines) {
      if (line.startsWith('#')) continue;
      const eqIndex = line.indexOf('=');
      if (eqIndex > 0) {
        const key = line.substring(0, eqIndex);
        let value = line.substring(eqIndex + 1);
        if ((value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith('"') && value.endsWith('"'))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }

    envLoaded = true;
  } catch {
    // Silently fail
  }
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
  
  console.log('[supabase-client] 数据库URL:', url.substring(0, 40) + '...');

  return { url, anonKey };
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
  
  const isDev = process.env.NODE_ENV === 'development' || localEnvValues.NODE_ENV === 'development';
  console.log(`[supabase-client] ${isDev ? '🔧 开发模式' : '🚀 生产模式'}：数据库 ${url.substring(0, 40)}...`);

  // 使用服务角色密钥时，绕过 RLS
  if (useServiceRole && serviceRoleKey) {
    return createClient(url, serviceRoleKey, {
      db: {
        timeout: 60000,
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  if (!anonKey) {
    throw new Error('SUPABASE_ANON_KEY is not set. Please check .env.local (dev) or .env.production (prod)');
  }

  if (token) {
    return createClient(url, anonKey, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
      db: {
        timeout: 60000,
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return createClient(url, anonKey, {
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export { loadEnv, getSupabaseCredentials, getSupabaseClient };

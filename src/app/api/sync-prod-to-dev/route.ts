import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    // 读取环境配置
    const envPath = path.join(process.cwd(), '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    
    const parseEnv = (content: string) => {
      const result: Record<string, string> = {};
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
          result[key] = value;
        }
      }
      return result;
    };

    const localEnv = parseEnv(envContent);
    
    // 开发数据库
    const devUrl = localEnv.SUPABASE_URL;
    const devKey = localEnv.SUPABASE_SERVICE_ROLE_KEY;
    
    // 生产数据库
    const prodUrl = process.env.SUPABASE_URL;
    const prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!devUrl || !devKey || !prodUrl || !prodKey) {
      return NextResponse.json({ success: false, error: '数据库配置缺失' });
    }

    const devClient = createClient(devUrl, devKey, {
      db: { timeout: 60000 },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const prodClient = createClient(prodUrl, prodKey, {
      db: { timeout: 60000 },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const results: string[] = [];

    // ===== 1. 同步 api_configs =====
    const { data: prodConfigs } = await prodClient.from('api_configs').select('*').order('id');
    
    if (prodConfigs && prodConfigs.length > 0) {
      // 清空开发库
      await devClient.from('api_models').delete().neq('id', 0); // 先删除子表
      await devClient.from('api_configs').delete().neq('id', 0);
      
      // 插入（保留生产库的 id）
      for (const config of prodConfigs) {
        const { error } = await devClient.from('api_configs').insert({
          id: config.id,
          name: config.name,
          service_type: config.service_type,
          description: config.description,
          api_endpoint: config.api_endpoint,
          api_key: config.api_key,
          request_method: config.request_method,
          request_headers: config.request_headers,
          request_body_template: config.request_body_template,
          response_parser: config.response_parser,
          sort_order: config.sort_order,
          is_active: config.is_active,
          created_at: config.created_at,
          updated_at: config.updated_at,
        });
        if (error) {
          results.push(`api_configs[${config.id}] 插入失败: ${error.message}`);
        }
      }
      results.push(`api_configs: ${prodConfigs.length} 条`);
    }

    // ===== 2. 同步 api_models =====
    const { data: prodModels } = await prodClient.from('api_models').select('*').order('id');
    
    if (prodModels && prodModels.length > 0) {
      for (const model of prodModels) {
        const { error } = await devClient.from('api_models').insert({
          id: model.id,
          config_id: model.config_id,
          model_id: model.model_id,
          model_name: model.model_name,
          description: model.description,
          api_endpoint: model.api_endpoint,
          parameters: model.parameters,
          credits_base: model.credits_base,
          is_active: model.is_active,
          sort_order: model.sort_order,
          created_at: model.created_at,
          updated_at: model.updated_at,
        });
        if (error) {
          results.push(`api_models[${model.id}] 插入失败: ${error.message}`);
        }
      }
      results.push(`api_models: ${prodModels.length} 条`);
    }

    // ===== 3. 同步 recharge_packages =====
    const { data: prodPackages } = await prodClient.from('recharge_packages').select('*').order('id');
    
    if (prodPackages && prodPackages.length > 0) {
      await devClient.from('recharge_packages').delete().neq('id', 0);
      for (const pkg of prodPackages) {
        const { error } = await devClient.from('recharge_packages').insert({
          id: pkg.id,
          name: pkg.name,
          price: pkg.price,
          credits: pkg.credits,
          tag: pkg.tag,
          savings: pkg.savings,
          sort_order: pkg.sort_order,
          is_active: pkg.is_active,
          created_at: pkg.created_at,
          updated_at: pkg.updated_at,
        });
        if (error && !error.message.includes('duplicate')) {
          results.push(`recharge_packages[${pkg.id}] 插入失败: ${error.message}`);
        }
      }
      results.push(`recharge_packages: ${prodPackages.length} 条`);
    }

    // ===== 4. 同步 redeem_keys（激活码）=====
    const { data: prodRedeemKeys } = await prodClient.from('redeem_keys').select('*').limit(100);
    
    if (prodRedeemKeys && prodRedeemKeys.length > 0) {
      await devClient.from('redeem_keys').delete().neq('id', 0);
      for (const key of prodRedeemKeys) {
        const { error } = await devClient.from('redeem_keys').insert({
          id: key.id,
          key_code: key.key_code,
          credits: key.credits,
          status: key.status,
          channel: key.channel,
          max_usage: key.max_usage,
          created_at: key.created_at,
          used_at: key.used_at,
        });
        if (error && !error.message.includes('duplicate')) {
          results.push(`redeem_keys[${key.id}] 插入失败: ${error.message}`);
        }
      }
      results.push(`redeem_keys: ${prodRedeemKeys.length} 条`);
    }

    return NextResponse.json({
      success: true,
      message: '✅ 数据同步完成',
      results,
      source: prodUrl.substring(0, 40) + '...',
      target: devUrl.substring(0, 40) + '...',
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
    });
  }
}

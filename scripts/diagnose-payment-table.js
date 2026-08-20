#!/usr/bin/env node
/**
 * #885 支付系统生产数据库诊断脚本
 * 用途：检查 payment_orders 表的列结构，诊断"积分不到账"根因
 * 
 * 在生产服务器上执行：
 *   node scripts/diagnose-payment-table.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// 加载 .env.local
function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('❌ 找不到 .env.local 文件');
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...valueParts] = trimmed.split('=');
      env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

async function main() {
  console.log('=== #885 支付系统数据库诊断 ===\n');

  const env = loadEnvLocal();
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
    console.log('SUPABASE_URL 存在:', !!supabaseUrl);
    console.log('SERVICE_ROLE_KEY 存在:', !!serviceRoleKey);
    if (serviceRoleKey) {
      console.log('SERVICE_ROLE_KEY 前缀:', serviceRoleKey.substring(0, 5));
    }
    process.exit(1);
  }

  console.log('✅ Supabase URL:', supabaseUrl);
  console.log('✅ Service Role Key 前缀:', serviceRoleKey.substring(0, 8) + '...');
  console.log('');

  // 查询表结构
  const queryUrl = `${supabaseUrl}/rest/v1/payment_orders?select=*&limit=1`;
  
  console.log('📡 查询 payment_orders 表...');
  
  try {
    const urlObj = new URL(queryUrl);
    const lib = urlObj.protocol === 'https:' ? https : http;
    
    const response = await new Promise((resolve, reject) => {
      const req = lib.get(queryUrl, {
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
          'Cache-Control': 'no-cache',
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('请求超时')); });
    });

    if (response.status === 200) {
      const rows = JSON.parse(response.data);
      console.log('✅ 表查询成功！返回行数:', rows.length);
      
      if (rows.length > 0) {
        const columns = Object.keys(rows[0]);
        console.log('\n📋 表结构（列名）:');
        columns.forEach(col => {
          const value = rows[0][col];
          const type = value === null ? 'null' : typeof value;
          console.log(`  - ${col} (${type})`);
        });
        
        // 检查关键列
        console.log('\n🔍 关键列检查:');
        const requiredColumns = ['out_trade_no', 'user_id', 'price', 'credits', 'status', 'raw_notify', 'trade_no', 'paid_at'];
        for (const col of requiredColumns) {
          const exists = columns.includes(col);
          console.log(`  ${exists ? '✅' : '❌'} ${col} ${exists ? '存在' : '不存在!!!'}`);
        }
        
        // 检查订单状态分布
        console.log('\n📊 最近一条订单信息:');
        console.log('  out_trade_no:', rows[0].out_trade_no);
        console.log('  status:', rows[0].status);
        console.log('  price:', rows[0].price);
        console.log('  credits:', rows[0].credits);
      } else {
        console.log('⚠️ 表存在但无数据（空表）');
      }
    } else if (response.status === 404) {
      console.log('❌ 表不存在！需要执行建表脚本');
    } else {
      console.log('❌ 查询失败:', response.status, response.data);
    }
  } catch (err) {
    console.error('❌ 请求出错:', err.message);
  }

  // 查询未支付订单数量
  console.log('\n📡 查询未支付订单...');
  try {
    const unpaidUrl = `${supabaseUrl}/rest/v1/payment_orders?status=eq.unpaid&select=out_trade_no,price,credits,created_at`;
    const urlObj = new URL(unpaidUrl);
    const lib = urlObj.protocol === 'https:' ? https : http;
    
    const response = await new Promise((resolve, reject) => {
      const req = lib.get(unpaidUrl, {
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('请求超时')); });
    });

    if (response.status === 200) {
      const rows = JSON.parse(response.data);
      console.log(`  未支付订单数量: ${rows.length}`);
      if (rows.length > 0) {
        console.log('  最近5条:');
        rows.slice(0, 5).forEach(r => {
          console.log(`    ${r.out_trade_no} | ${r.price}元 | ${r.credits}积分 | ${r.created_at}`);
        });
      }
    } else {
      console.log('  查询失败:', response.status);
    }
  } catch (err) {
    console.error('  请求出错:', err.message);
  }

  console.log('\n=== 诊断完成 ===');
}

main().catch(console.error);

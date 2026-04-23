import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 管理员手机号
const ADMIN_PHONE = '13824085362';

// POST /api/linjiaqi/distribute - 调整用户积分
// operation: 'add' - 增加积分
//            'subtract' - 扣减积分
//            'deduct' - 划扣配额（给负责人增加积分）
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    const body = await request.json();
    
    const { userId, amount, operation = 'add' } = body;
    
    if (!userId || !amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid parameters' },
        { status: 400 }
      );
    }

    // 获取目标用户
    const { data: targetUser, error: userError } = await client
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const isAdmin = targetUser.phone === ADMIN_PHONE;
    let newCredits = targetUser.credits || 0;
    let recordPoints = amount;
    let paymentMethod = 'admin_distribute';

    // 划扣配额：给负责人增加积分
    if (operation === 'deduct') {
      if (!isAdmin) {
        return NextResponse.json(
          { error: 'Only admin can use deduct operation' },
          { status: 400 }
        );
      }
      newCredits = (targetUser.credits || 0) + amount;
      paymentMethod = 'admin_deduct_quota';
    }
    // 增加积分
    else if (operation === 'add') {
      newCredits = (targetUser.credits || 0) + amount;
      paymentMethod = 'admin_add';
    }
    // 扣减积分
    else if (operation === 'subtract') {
      if ((targetUser.credits || 0) < amount) {
        return NextResponse.json(
          { error: `Insufficient user credits. Available: ${targetUser.credits || 0}, Required: ${amount}` },
          { status: 400 }
        );
      }
      newCredits = (targetUser.credits || 0) - amount;
      recordPoints = -amount; // 负数表示扣减
      paymentMethod = 'admin_subtract';
    }

    // 更新用户积分
    const { error: updateError } = await client
      .from('users')
      .update({ 
        credits: newCredits,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    // 记录操作历史到 recharge_records
    await client
      .from('recharge_records')
      .insert({
        user_id: userId,
        package_name: paymentMethod === 'admin_add' ? '管理员增加' : 
                      paymentMethod === 'admin_subtract' ? '管理员扣减' : 
                      paymentMethod === 'admin_deduct_quota' ? '配额划扣' : '未知',
        credits: Math.abs(recordPoints),
        price: 0,
        status: 'completed',
        created_at: new Date().toISOString()
      });

    // 计算新的剩余配额
    const { data: allUsers } = await client
      .from('users')
      .select('credits');
    const usedCredits = allUsers?.reduce((sum, user) => sum + (user.credits || 0), 0) || 0;

    return NextResponse.json({
      success: true,
      data: {
        operation,
        amount,
        userNewCredits: newCredits,
        usedCredits,
      }
    });
  } catch (error) {
    console.error('Error distributing credits:', error);
    return NextResponse.json(
      { error: 'Failed to distribute credits' },
      { status: 500 }
    );
  }
}

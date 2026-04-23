import re

# 读取文件
with open("/www/kiikii_me/client/src/app/api/image-to-image/route.ts", "r") as f:
    content = f.read()

# 1. 添加 clientRequestId 解析
old_parse = '''      userId,
    } = body;'''
new_parse = '''      userId,
      clientRequestId, // 客户端请求唯一标识（幂等性核心）
    } = body;'''
content = content.replace(old_parse, new_parse)

# 2. 在积分扣除前添加幂等性检查
old_credits = '''    // ====== 积分扣除逻辑 ======
    console.log(`[积分扣除] 开始计算和扣除积分`);'''
new_credits = '''    // ====== 幂等性检查（宪法强制要求）======
    if (clientRequestId) {
      console.log("[幂等性] 检查 clientRequestId:", clientRequestId);
      const supabase = getSupabaseClient();
      const { data: existingTask } = await supabase
        .from("api_tasks")
        .select("*")
        .eq("client_request_id", clientRequestId)
        .maybeSingle();

      if (existingTask) {
        console.log("[幂等性] 发现已存在任务:", existingTask.id, "状态:", existingTask.status);
        // 返回已有任务状态，不重复扣费
        if (existingTask.status === "completed" && existingTask.result_images?.length > 0) {
          return new Response(JSON.stringify({
            type: "idempotency_hit",
            taskId: existingTask.id.toString(),
            status: "completed",
            message: "请求已处理，返回已有结果",
            imageUrls: existingTask.result_images,
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        } else if (existingTask.status === "generating") {
          // 任务还在进行中，返回任务ID让前端轮询
          return new Response(JSON.stringify({
            type: "idempotency_hit",
            taskId: existingTask.id.toString(),
            status: "generating",
            message: "请求已处理，任务进行中",
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        } else if (existingTask.status === "failed") {
          // 之前的任务失败了，允许重新请求（删除旧记录）
          await supabase.from("api_tasks").delete().eq("id", existingTask.id);
          console.log("[幂等性] 删除失败任务，允许重试");
        }
      }
      console.log("[幂等性] 未找到重复任务，继续处理");
    }

    // ====== 积分扣除逻辑 ======
    console.log(`[积分扣除] 开始计算和扣除积分`);'''
content = content.replace(old_credits, new_credits)

# 3. 在积分扣除成功后写入 api_tasks 表
old_deduct_success = '''      creditsDeducted = true; // 标记已扣除
      console.log(`[积分扣除] 扣除成功，剩余 ${deductResult.remaining} 积分`);'''
new_deduct_success = '''      creditsDeducted = true; // 标记已扣除
      console.log(`[积分扣除] 扣除成功，剩余 ${deductResult.remaining} 积分`);
      
      // ====== 写入 api_tasks 表（幂等性核心）======
      if (clientRequestId) {
        const supabase = getSupabaseClient();
        const { error: insertError } = await supabase
          .from("api_tasks")
          .insert({
            client_request_id: clientRequestId,
            user_id: actualUserId,
            task_type: "image_generation",
            status: "generating",
            model: model,
            prompt: prompt,
            credits_deducted: totalCredits,
            generation_count: generationCount || 1,
          });
        
        if (insertError) {
          // 唯一索引冲突（code 23505）表示并发请求
          if (insertError.code === "23505") {
            console.log("[幂等性] 并发请求检测，返回已有任务");
            const { data: existingTask } = await supabase
              .from("api_tasks")
              .select("*")
              .eq("client_request_id", clientRequestId)
              .single();
            
            if (existingTask?.status === "completed" && existingTask.result_images?.length > 0) {
              // 退还本次扣除的积分（因为不会生成新图片）
              await refundCredits(actualUserId, totalCredits);
              return new Response(JSON.stringify({
                type: "idempotency_hit",
                taskId: existingTask.id.toString(),
                status: "completed",
                message: "并发请求检测，返回已有结果",
                imageUrls: existingTask.result_images,
              }), { status: 200, headers: { "Content-Type": "application/json" } });
            }
          } else {
            console.error("[幂等性] 写入 api_tasks 失败:", insertError);
          }
        } else {
          console.log("[幂等性] 写入 api_tasks 成功");
        }
      }'''
content = content.replace(old_deduct_success, new_deduct_success)

# 写入文件
with open("/www/kiikii_me/client/src/app/api/image-to-image/route.ts", "w") as f:
    f.write(content)

print("修改完成!")

import re

# 读取文件
with open("/www/kiikii_me/client/src/app/api/image-to-image/route.ts", "r") as f:
    content = f.read()

# 1. 添加 clientTaskIds 解析（兼容旧的 clientRequestId）
old_parse = '''      userId,
      clientRequestId, // 客户端请求唯一标识（幂等性核心）
    } = body;'''
new_parse = '''      userId,
      clientRequestId, // 客户端请求唯一标识（幂等性核心）- 单图模式
      clientTaskIds, // 每张图的独立 UUID 数组 - 多图模式
    } = body;'''
content = content.replace(old_parse, new_parse)

# 2. 修改幂等性检查逻辑，支持 clientTaskIds 数组
old_idempotency = '''    // ====== 幂等性检查（宪法强制要求）======
    if (clientRequestId) {
      console.log("[幂等性] 检查 clientRequestId:", clientRequestId);
      const supabase = getSupabaseClient();
      const { data: existingTask, error: queryError } = await supabase
        .from("api_tasks")
        .select("id, status, result_images, credits_deducted")
        .eq("client_request_id", clientRequestId)
        .maybeSingle();

      if (queryError) {
        console.error("[幂等性] 查询失败:", queryError);
      } else if (existingTask) {
        console.log("[幂等性] 发现已存在任务:", existingTask.id, "状态:", existingTask.status);
        
        // 返回 409 Conflict，告诉前端这是重复请求
        if (existingTask.status === "completed" && existingTask.result_images?.length > 0) {
          return new Response(JSON.stringify({
            error: "Duplicate request",
            message: "请求已处理，返回已有结果",
            taskId: existingTask.id.toString(),
            status: "completed",
            imageUrls: existingTask.result_images,
          }), { status: 409, headers: { "Content-Type": "application/json" } });
        } else if (existingTask.status === "generating") {
          return new Response(JSON.stringify({
            error: "Duplicate request",
            message: "请求处理中，请勿重复提交",
            taskId: existingTask.id.toString(),
            status: "generating",
          }), { status: 409, headers: { "Content-Type": "application/json" } });
        } else if (existingTask.status === "failed") {
          // 之前的任务失败了，删除旧记录允许重试
          await supabase.from("api_tasks").delete().eq("id", existingTask.id);
          console.log("[幂等性] 删除失败任务，允许重试");
        }
      }
      console.log("[幂等性] 未找到重复任务，继续处理");
    }'''

new_idempotency = '''    // ====== 幂等性检查（宪法强制要求）======
    // 支持 clientTaskIds 数组（多图模式）或 clientRequestId（单图模式）
    const idempotencyIds = clientTaskIds || (clientRequestId ? [clientRequestId] : []);
    
    if (idempotencyIds.length > 0) {
      console.log("[幂等性] 检查 IDs:", idempotencyIds);
      const supabase = getSupabaseClient();
      
      // 检查是否已存在任务
      const { data: existingTasks, error: queryError } = await supabase
        .from("api_tasks")
        .select("id, client_request_id, status, result_images")
        .in("client_request_id", idempotencyIds);

      if (queryError) {
        console.error("[幂等性] 查询失败:", queryError);
      } else if (existingTasks && existingTasks.length > 0) {
        console.log("[幂等性] 发现已存在任务:", existingTasks.length, "个");
        
        // 过滤出已完成和进行中的任务
        const completedTasks = existingTasks.filter(t => t.status === "completed" && t.result_images?.length > 0);
        const generatingTasks = existingTasks.filter(t => t.status === "generating");
        const failedTasks = existingTasks.filter(t => t.status === "failed");
        
        // 如果全部已完成，返回结果
        if (completedTasks.length === idempotencyIds.length) {
          const allImages = completedTasks.flatMap(t => t.result_images || []);
          return new Response(JSON.stringify({
            error: "Duplicate request",
            message: "所有请求已处理，返回已有结果",
            status: "completed",
            imageUrls: allImages,
          }), { status: 409, headers: { "Content-Type": "application/json" } });
        }
        
        // 如果有进行中的任务，返回进行中
        if (generatingTasks.length > 0) {
          return new Response(JSON.stringify({
            error: "Duplicate request",
            message: "有请求正在处理中，请勿重复提交",
            status: "generating",
          }), { status: 409, headers: { "Content-Type": "application/json" } });
        }
        
        // 删除失败的任务，允许重试
        if (failedTasks.length > 0) {
          const failedIds = failedTasks.map(t => t.id);
          await supabase.from("api_tasks").delete().in("id", failedIds);
          console.log("[幂等性] 删除失败任务:", failedIds);
        }
      }
      console.log("[幂等性] 检查通过，继续处理");
    }'''

content = content.replace(old_idempotency, new_idempotency)

# 3. 修改写入 api_tasks 逻辑，为每个 ID 创建记录
old_write = '''      // ====== 写入 api_tasks 表（幂等性核心）======
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
          });'''

new_write = '''      // ====== 写入 api_tasks 表（幂等性核心）======
      // 为每个 clientTaskId 创建独立记录
      const idsToInsert = clientTaskIds || (clientRequestId ? [clientRequestId] : []);
      if (idsToInsert.length > 0) {
        const supabase = getSupabaseClient();
        const recordsToInsert = idsToInsert.map(id => ({
          client_request_id: id,
          user_id: actualUserId,
          task_type: "image_generation",
          status: "generating",
          model: model,
          prompt: prompt,
          credits_deducted: Math.ceil(totalCredits / idsToInsert.length), // 平均分配积分
          generation_count: 1, // 每条记录对应 1 张图
        }));
        
        const { error: insertError } = await supabase
          .from("api_tasks")
          .insert(recordsToInsert);'''

content = content.replace(old_write, new_write)

# 4. 修改并发请求检测逻辑
old_concurrent = '''        if (insertError) {
          // 唯一索引冲突（code 23505）表示并发请求
          if (insertError.code === "23505") {
            console.log("[幂等性] 并发请求检测，退还积分并拒绝");
            await refundCredits(actualUserId, totalCredits, clientRequestId, "幂等性并发拦截退费");
            return new Response(JSON.stringify({
              error: "Duplicate request",
              message: "检测到并发请求，已拒绝",
            }), { status: 409, headers: { "Content-Type": "application/json" } });
          } else {
            console.error("[幂等性] 写入 api_tasks 失败:", insertError);
          }
        } else {
          console.log("[幂等性] 写入 api_tasks 成功");
        }
      }'''

new_concurrent = '''        if (insertError) {
          // 唯一索引冲突（code 23505）表示并发请求
          if (insertError.code === "23505") {
            console.log("[幂等性] 并发请求检测，退还积分并拒绝");
            await refundCredits(actualUserId, totalCredits, idsToInsert[0], "幂等性并发拦截退费");
            return new Response(JSON.stringify({
              error: "Duplicate request",
              message: "检测到并发请求，已拒绝",
            }), { status: 409, headers: { "Content-Type": "application/json" } });
          } else {
            console.error("[幂等性] 写入 api_tasks 失败:", insertError);
          }
        } else {
          console.log("[幂等性] 写入 api_tasks 成功，共", idsToInsert.length, "条记录");
        }
      }'''

content = content.replace(old_concurrent, new_concurrent)

# 写入文件
with open("/www/kiikii_me/client/src/app/api/image-to-image/route.ts", "w") as f:
    f.write(content)

print("后端 clientTaskIds 数组支持已添加!")

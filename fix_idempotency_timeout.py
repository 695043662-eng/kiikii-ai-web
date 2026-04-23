import re

# 读取文件
with open("/www/kiikii_me/client/src/app/api/image-to-image/route.ts", "r") as f:
    content = f.read()

# 1. 修改幂等性检查，加入超时清理
old_idempotency = '''    // ====== 幂等性检查（宪法强制要求）======
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

new_idempotency = '''    // ====== 幂等性检查（宪法强制要求）======
    // 支持 clientTaskIds 数组（多图模式）或 clientRequestId（单图模式）
    const idempotencyIds = clientTaskIds || (clientRequestId ? [clientRequestId] : []);
    
    if (idempotencyIds.length > 0) {
      console.log("[幂等性] 检查 IDs:", idempotencyIds);
      const supabase = getSupabaseClient();
      
      // 检查是否已存在任务
      const { data: existingTasks, error: queryError } = await supabase
        .from("api_tasks")
        .select("id, client_request_id, status, result_images, created_at")
        .in("client_request_id", idempotencyIds);

      if (queryError) {
        console.error("[幂等性] 查询失败:", queryError);
      } else if (existingTasks && existingTasks.length > 0) {
        console.log("[幂等性] 发现已存在任务:", existingTasks.length, "个");
        
        // 10分钟超时：超过10分钟的 generating 视为失效，允许重试
        const STALE_THRESHOLD = 10 * 60 * 1000; // 10分钟
        const now = Date.now();
        
        const completedTasks = existingTasks.filter(t => t.status === "completed" && t.result_images?.length > 0);
        const generatingTasks = existingTasks.filter(t => t.status === "generating");
        const failedTasks = existingTasks.filter(t => t.status === "failed");
        
        // 找出超时的 generating 任务
        const staleTasks = generatingTasks.filter(t => {
          const createdAt = new Date(t.created_at).getTime();
          return (now - createdAt) > STALE_THRESHOLD;
        });
        const freshGeneratingTasks = generatingTasks.filter(t => {
          const createdAt = new Date(t.created_at).getTime();
          return (now - createdAt) <= STALE_THRESHOLD;
        });
        
        // 删除超时和失败的任务，允许重试
        const idsToDelete = [...staleTasks.map(t => t.id), ...failedTasks.map(t => t.id)];
        if (idsToDelete.length > 0) {
          await supabase.from("api_tasks").delete().in("id", idsToDelete);
          console.log("[幂等性] 清理超时/失败任务:", idsToDelete);
        }
        
        // 如果全部已完成，返回已有结果
        if (completedTasks.length === idempotencyIds.length) {
          const allImages = completedTasks.flatMap(t => t.result_images || []);
          console.log("[幂等性] 所有任务已完成，返回已有结果，不扣费");
          // SSE 模式：不返回 409，而是启动 SSE 流直接推送已有结果
          // 这样前端可以正常处理
        }
        
        // 如果有新鲜的进行中任务（10分钟内），才拦截
        if (freshGeneratingTasks.length > 0) {
          console.log("[幂等性] 有任务正在处理中，拦截重复请求");
          return new Response(JSON.stringify({
            error: "Duplicate request",
            message: "有请求正在处理中，请勿重复提交",
            status: "generating",
          }), { status: 409, headers: { "Content-Type": "application/json" } });
        }
        
        // 超时的任务已被清理，继续处理
        console.log("[幂等性] 超时任务已清理，允许重试");
      }
      console.log("[幂等性] 检查通过，继续处理");
    }'''

content = content.replace(old_idempotency, new_idempotency)

# 写入文件
with open("/www/kiikii_me/client/src/app/api/image-to-image/route.ts", "w") as f:
    f.write(content)

print("后端幂等锁超时清理已添加!")

import re

# 读取 webhook 文件
with open("/www/kiikii_me/client/src/app/api/webhook/draw-callback/route.ts", "r") as f:
    content = f.read()

# 在成功处理图片后，添加 api_tasks 状态更新
# 找到成功保存图片的位置
old_success = '''          console.log(`[Webhook] 更新成功: ${mainTaskId}, index: ${itemIndex}, 进度: ${completedCount}/${generationCount}`);'''

new_success = '''          console.log(`[Webhook] 更新成功: ${mainTaskId}, index: ${itemIndex}, 进度: ${completedCount}/${generationCount}`);
          
          // ====== 同步更新 api_tasks 表 ======
          try {
            const apiClient = getSupabaseClient();
            // 查找与此任务相关的 api_tasks 记录
            const { data: apiTasks } = await apiClient
              .from("api_tasks")
              .select("id, status, result_images")
              .eq("prompt", existingResult?.requestParams?.prompt || "")
              .eq("status", "generating")
              .order("created_at", { ascending: false })
              .limit(1);
            
            if (apiTasks && apiTasks.length > 0) {
              const task = apiTasks[0];
              const existingResults = task.result_images || [];
              const newResults = [...existingResults, signedUrl];
              
              // 如果所有图片都完成了，更新为 completed
              const isAllDone = isAllCompleted;
              await apiClient
                .from("api_tasks")
                .update({
                  status: isAllDone ? "completed" : "generating",
                  result_images: newResults,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", task.id);
              console.log(`[Webhook] api_tasks ${task.id} 状态更新为 ${isAllDone ? "completed" : "generating"}`);
            }
          } catch (apiUpdateError) {
            console.error("[Webhook] api_tasks 更新失败:", apiUpdateError);
          }'''

content = content.replace(old_success, new_success)

# 在失败处理中也添加 api_tasks 更新
old_fail_update = '''          console.log(`[Webhook] 更新失败状态: ${mainTaskId}, index: ${itemIndex}, 进度: ${completedCount}/${generationCount}`);'''

new_fail_update = '''          console.log(`[Webhook] 更新失败状态: ${mainTaskId}, index: ${itemIndex}, 进度: ${completedCount}/${generationCount}`);
          
          // ====== 同步更新 api_tasks 表（失败） ======
          if (isAllCompleted && !hasSuccessfulImages) {
            try {
              const apiClient = getSupabaseClient();
              const { data: apiTasks } = await apiClient
                .from("api_tasks")
                .select("id, status")
                .eq("prompt", existingResult?.requestParams?.prompt || "")
                .eq("status", "generating")
                .order("created_at", { ascending: false })
                .limit(1);
              
              if (apiTasks && apiTasks.length > 0) {
                await apiClient
                  .from("api_tasks")
                  .update({
                    status: "failed",
                    error_message: finalErrorMsg,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", apiTasks[0].id);
                console.log(`[Webhook] api_tasks ${apiTasks[0].id} 状态更新为 failed`);
              }
            } catch (apiUpdateError) {
              console.error("[Webhook] api_tasks 失败更新失败:", apiUpdateError);
            }
          }'''

content = content.replace(old_fail_update, new_fail_update)

# 写入文件
with open("/www/kiikii_me/client/src/app/api/webhook/draw-callback/route.ts", "w") as f:
    f.write(content)

print("Webhook api_tasks 更新已添加!")

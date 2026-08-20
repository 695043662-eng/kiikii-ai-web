import re

# 读取文件
with open("/www/kiikii_me/client/src/app/canvas/page.tsx", "r") as f:
    content = f.read()

# 修改发送逻辑：传递 clientTaskIds 数组
old_send = '''      // ====== 【异步请求阶段】后台发送请求 ======
      // 生成任务ID 和 客户端请求唯一标识（幂等性核心）
      const taskId = Date.now().toString();
      finalTaskId = taskId; // 初始化任务ID（可能被 timeout 更新）
      
      // ====== 生成 client_request_id（幂等性核心）======
      const clientRequestId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
      console.log('[幂等性] 生成 client_request_id:', clientRequestId);
      
      // 构建请求参数 - 使用用户选择的参数
      const requestBody: any = {
        taskId,
        clientRequestId, // 客户端请求唯一标识（幂等性核心）
        prompt: content,
        model: selectedModel, // 使用用户选择的模型
        resolution: selectedResolution, // 使用用户选择的分辨率
        aspectRatio: selectedRatio, // 使用用户选择的比例
        generationCount: selectedCount, // 使用用户选择的数量
        md5Hashes: chatImageMd5s, // 传递 MD5 数组
        userId: userId, // 传递用户 ID
      };'''

new_send = '''      // ====== 【异步请求阶段】后台发送请求 ======
      // 生成任务ID
      const taskId = Date.now().toString();
      finalTaskId = taskId;
      
      // ====== 使用已生成的 clientTaskIds 作为幂等性 ID 数组 ======
      console.log('[幂等性] 使用 clientTaskIds:', clientTaskIds);
      
      // 构建请求参数 - 传递 clientTaskIds 数组（按图生成 UUID）
      const requestBody: any = {
        taskId,
        clientTaskIds, // 每张图的独立 UUID（幂等性核心）
        prompt: content,
        model: selectedModel,
        resolution: selectedResolution,
        aspectRatio: selectedRatio,
        generationCount: selectedCount,
        md5Hashes: chatImageMd5s,
        userId: userId,
      };'''

content = content.replace(old_send, new_send)

# 写入文件
with open("/www/kiikii_me/client/src/app/canvas/page.tsx", "w") as f:
    f.write(content)

print("前端 clientTaskIds 数组传递已修改!")

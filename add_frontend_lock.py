import re

# 读取文件
with open("/www/kiikii_me/client/src/app/canvas/page.tsx", "r") as f:
    content = f.read()

# 1. 添加 Loader2 导入
old_import = '''  Trash2,
} from 'lucide-react';'''
new_import = '''  Trash2,
  Loader2,
} from 'lucide-react';'''
content = content.replace(old_import, new_import)

# 2. 在 requestBody 构建前添加 clientRequestId 生成
old_request = '''      // ====== 【异步请求阶段】后台发送请求 ======
      // 生成任务ID
      const taskId = Date.now().toString();
      finalTaskId = taskId; // 初始化任务ID（可能被 timeout 更新）
      
      // 构建请求参数 - 使用用户选择的参数
      const requestBody: any = {
        taskId,
        prompt: content,'''

new_request = '''      // ====== 【异步请求阶段】后台发送请求 ======
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
        prompt: content,'''

content = content.replace(old_request, new_request)

# 3. 修改发送按钮，添加 disabled 和 loading 状态
old_button = '''            {/* 发送按钮 */}
            <button 
              className="px-4 py-1.5 text-xs bg-gray-900 dark:bg-gray-700 hover:bg-gray-700 dark:hover:bg-gray-600 rounded-lg text-white transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0"
              onClick={handleSend}
            >
              <span>发送</span>
              <Send className="w-3 h-3" />
            </button>'''

new_button = '''            {/* 发送按钮 */}
            <button 
              className="px-4 py-1.5 text-xs bg-gray-900 dark:bg-gray-700 hover:bg-gray-700 dark:hover:bg-gray-600 rounded-lg text-white transition-colors flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSend}
              disabled={messages.some(m => m.isGenerating)}
            >
              {messages.some(m => m.isGenerating) ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>生成中...</span>
                </>
              ) : (
                <>
                  <span>发送</span>
                  <Send className="w-3 h-3" />
                </>
              )}
            </button>'''

content = content.replace(old_button, new_button)

# 写入文件
with open("/www/kiikii_me/client/src/app/canvas/page.tsx", "w") as f:
    f.write(content)

print("前端修复完成!")

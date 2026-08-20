/**
 * 错误脱敏工具（P0 安全加固）
 * 
 * 原则：对客户端只返回脱敏后的统一文字说明，
 * 严禁将 error.stack / error.message / 数据库报错直接吐给前端。
 * 
 * ## 使用方式
 * ```typescript
 * catch (error) {
 *   console.error('[模块名] 操作失败:', error); // 后端日志保留完整信息
 *   return NextResponse.json(
 *     { success: false, error: sanitizeError(error, '操作失败') },
 *     { status: 500 }
 *   );
 * }
 * ```
 */

/**
 * 将后端异常脱敏为安全的用户提示
 * @param error 原始错误对象
 * @param fallback 用户可见的兜底提示语（如"操作失败"、"生成失败"）
 * @returns 脱敏后的安全字符串
 */
export function sanitizeError(error: unknown, fallback: string = '操作失败，请稍后重试'): string {
  // 后端日志已在 catch 块中 console.error，此处只做脱敏
  // 不返回任何 error.message / error.stack / 数据库报错文本
  
  // 特殊情况：已知的安全错误类型（如余额不足、违规等），可安全透传
  if (error instanceof Error) {
    const msg = error.message;
    
    // 白名单：允许透传的业务级错误关键词
    const safeKeywords = [
      '积分不足',
      '余额不足', 
      'Insufficient credits',
      '请先登录',
      '未登录',
      '内容违规',
      '违规',
      '频率过高',
      '操作过于频繁',
      '模型维护中',
      '服务维护中',
      '分辨率已被禁用',
      '暂时不可用',
      'RESOLUTION_BANNED',
      '账号因连续异常操作已被锁定',
      '无权操作',
    ];
    
    for (const keyword of safeKeywords) {
      if (msg.includes(keyword)) {
        return msg; // 业务错误安全透传
      }
    }
  }
  
  // 其他所有情况：返回兜底提示
  return fallback;
}

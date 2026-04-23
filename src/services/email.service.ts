/**
 * 腾讯云邮件发送服务
 * 使用腾讯云 SES (Simple Email Service) 发送邮件
 */

// 直接使用腾讯云 SDK
const TencentCloud = require('tencentcloud-sdk-nodejs');

// 配置
const TENCENTCLOUD_SECRET_ID = process.env.TENCENTCLOUD_SECRET_ID || '';
const TENCENTCLOUD_SECRET_KEY = process.env.TENCENTCLOUD_SECRET_KEY || '';
const TENCENTCLOUD_REGION = process.env.TENCENTCLOUD_REGION || 'ap-guangzhou';

// 发件人地址（需要在腾讯云配置验证）
const SENDER_EMAIL = process.env.SES_SENDER_EMAIL || 'noreply@mail.kiikii.me';
const SENDER_NAME = process.env.SES_SENDER_NAME || 'Kiikii AI';

interface SendEmailParams {
  toEmail: string;
  subject: string;
  htmlBody?: string;
  textBody?: string;
  code?: string;  // 模板验证码
}

/**
 * 发送邮件
 */
export async function sendEmail(params: SendEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { toEmail, subject, htmlBody, textBody, code } = params;

  // 验证配置
  if (!TENCENTCLOUD_SECRET_ID || !TENCENTCLOUD_SECRET_KEY) {
    console.error('[Email] 腾讯云配置缺失');
    return { success: false, error: '邮件服务配置错误' };
  }

  try {
    // 获取 SES 客户端
    const SESClient = TencentCloud.ses.v20201002.Client;
    
    // 创建客户端实例 - 使用默认配置
    const client = new SESClient({
      credential: {
        secretId: TENCENTCLOUD_SECRET_ID,
        secretKey: TENCENTCLOUD_SECRET_KEY,
      },
      region: TENCENTCLOUD_REGION,
    });

    // 构造邮件内容 - 使用腾讯云 SES 模板发送
    const emailContent: any = {
      FromEmailAddress: `${SENDER_NAME} <${SENDER_EMAIL}>`,
      Destination: [toEmail],
      Subject: subject,
      Template: {
        TemplateID: 171272,  // 腾讯云 SES 模板 ID
        TemplateData: JSON.stringify({ code: code || '' }),
      },
    };

    // 发送邮件
    const result = await client.SendEmail(emailContent);

    console.log('[Email] 邮件发送成功:', {
      messageId: result.MessageId,
      to: toEmail,
      subject: subject,
    });

    return {
      success: true,
      messageId: result.MessageId,
    };
  } catch (error: any) {
    console.error('[Email] 邮件发送失败:', error);
    return {
      success: false,
      error: error.message || '邮件发送失败',
    };
  }
}

/**
 * 生成验证码邮件 HTML
 */
export function generateVerificationEmailHtml(code: string, type: 'register' | 'reset_password'): string {
  const title = type === 'register' ? '注册验证码' : '重置密码验证码';
  const expireMinutes = 10;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f5f5f5;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 480px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 30px 20px;
      text-align: center;
    }
    .header h1 {
      color: #ffffff;
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .content {
      padding: 40px 30px;
      text-align: center;
    }
    .code-box {
      background-color: #f8f9fa;
      border: 2px dashed #e0e0e0;
      border-radius: 12px;
      padding: 24px;
      margin: 24px 0;
    }
    .code {
      font-size: 36px;
      font-weight: 700;
      color: #667eea;
      letter-spacing: 8px;
      font-family: 'Courier New', monospace;
    }
    .tips {
      color: #666;
      font-size: 14px;
      line-height: 1.6;
    }
    .warning {
      background-color: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 8px;
      padding: 12px;
      margin-top: 20px;
      font-size: 13px;
      color: #856404;
    }
    .footer {
      padding: 20px;
      text-align: center;
      color: #999;
      font-size: 12px;
      border-top: 1px solid #f0f0f0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${title}</h1>
    </div>
    <div class="content">
      <p class="tips">您好！</p>
      <p class="tips">您的验证码是：</p>
      <div class="code-box">
        <span class="code">${code}</span>
      </div>
      <p class="tips">验证码 ${expireMinutes} 分钟内有效，请尽快完成验证。</p>
      <div class="warning">
        如果您没有进行相关操作，请忽略此邮件。
      </div>
    </div>
    <div class="footer">
      <p>此邮件由系统自动发送，请勿回复。</p>
      <p>&copy; ${new Date().getFullYear()} Kiikii AI. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * 生成验证码邮件纯文本版本
 */
export function generateVerificationEmailText(code: string, type: 'register' | 'reset_password'): string {
  const title = type === 'register' ? '注册验证码' : '重置密码验证码';
  const expireMinutes = 10;

  return `
${title}

您好！

您的验证码是：${code}

验证码 ${expireMinutes} 分钟内有效，请尽快完成验证。

如果您没有进行相关操作，请忽略此邮件。

此邮件由系统自动发送，请勿回复。
© ${new Date().getFullYear()} Kiikii AI
  `.trim();
}

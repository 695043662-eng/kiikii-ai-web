/**
 * URL 安全验证工具
 * 防止 SSRF（服务端请求伪造）攻击
 */

// 允许代理的域名白名单
const ALLOWED_PROXY_DOMAINS = [
  // 腾讯云 COS
  'cos.ap-hongkong.myqcloud.com',
  'cos.ap-guangzhou.myqcloud.com',
  'cos.ap-shanghai.myqcloud.com',
  'cos.ap-beijing.myqcloud.com',
  // AI 服务商域名（根据实际使用情况添加）
  'api.mmw.ink',
  'api.openai.com',
  'api.deepseek.com',
  'ark.cn-beijing.volces.com',
  // 可根据需要添加更多
];

// 禁止访问的私有 IP 范围
const PRIVATE_IP_RANGES = [
  // IPv4 私有地址
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^127\./,                         // 127.0.0.0/8 (localhost)
  /^169\.254\./,                    // 169.254.0.0/16 (链路本地)
  /^0\.0\.0\.0/,                    // 0.0.0.0/8
  // IPv6 私有地址
  /^::1$/,                          // localhost
  /^fe80:/i,                        // 链路本地
  /^fc00:/i,                        // 唯一本地地址
  /^fd00:/i,                        // 唯一本地地址
];

// 危险协议（只允许 http/https）
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * 检查 IP 是否为私有地址
 */
function isPrivateIP(ip: string): boolean {
  for (const range of PRIVATE_IP_RANGES) {
    if (range.test(ip)) {
      return true;
    }
  }
  return false;
}

/**
 * 解析域名获取 IP 地址（异步）
 * 注意：在 Next.js 环境中，我们使用 DNS 解析
 */
async function resolveHostname(hostname: string): Promise<string[]> {
  const dns = await import('dns').then(m => m.promises);
  try {
    const addresses = await dns.resolve4(hostname);
    return addresses;
  } catch {
    // 如果 IPv4 解析失败，尝试 IPv6
    try {
      const addresses = await dns.resolve6(hostname);
      return addresses;
    } catch {
      return [];
    }
  }
}

/**
 * 验证 URL 是否安全
 * @param url 要验证的 URL
 * @param options 选项
 * @returns 验证结果
 */
export async function validateUrl(
  url: string,
  options: {
    allowPrivateIP?: boolean;  // 是否允许私有 IP（默认 false）
    allowAnyDomain?: boolean;  // 是否允许任意域名（默认 false，使用白名单）
    customWhitelist?: string[]; // 自定义域名白名单
  } = {}
): Promise<{ valid: boolean; error?: string; parsedUrl?: URL }> {
  const {
    allowPrivateIP = false,
    allowAnyDomain = false,
    customWhitelist,
  } = options;

  try {
    // 解析 URL
    const parsedUrl = new URL(url);

    // 检查协议
    if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
      return { valid: false, error: `不支持的协议: ${parsedUrl.protocol}` };
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // 检查域名白名单
    if (!allowAnyDomain) {
      const whitelist = customWhitelist || ALLOWED_PROXY_DOMAINS;
      const isAllowed = whitelist.some(domain => {
        // 支持通配符匹配（如 *.example.com）
        if (domain.startsWith('*.')) {
          const baseDomain = domain.slice(2);
          return hostname === baseDomain || hostname.endsWith('.' + baseDomain);
        }
        return hostname === domain;
      });

      if (!isAllowed) {
        return { valid: false, error: `域名不在白名单中: ${hostname}` };
      }
    }

    // 检查是否为 IP 地址（而非域名）
    const isIPAddress = /^[\d.]+$/.test(hostname) || /^[\da-f:]+$/i.test(hostname);

    if (isIPAddress) {
      // 直接检查 IP
      if (!allowPrivateIP && isPrivateIP(hostname)) {
        return { valid: false, error: '禁止访问私有 IP 地址' };
      }
    } else {
      // DNS 解析检查
      if (!allowPrivateIP) {
        const ips = await resolveHostname(hostname);
        for (const ip of ips) {
          if (isPrivateIP(ip)) {
            console.warn('[Security] 检测到 DNS 重绑定攻击:', { hostname, ip });
            return { valid: false, error: '域名解析到私有 IP 地址' };
          }
        }
      }
    }

    return { valid: true, parsedUrl };
  } catch (error) {
    return { valid: false, error: '无效的 URL' };
  }
}

/**
 * 同步验证 URL（仅检查格式和白名单，不进行 DNS 解析）
 * 用于快速检查，但不如异步版本安全
 */
export function validateUrlSync(
  url: string,
  options: {
    allowAnyDomain?: boolean;
    customWhitelist?: string[];
  } = {}
): { valid: boolean; error?: string; parsedUrl?: URL } {
  const { allowAnyDomain = false, customWhitelist } = options;

  try {
    const parsedUrl = new URL(url);

    // 检查协议
    if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
      return { valid: false, error: `不支持的协议: ${parsedUrl.protocol}` };
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // 检查是否为私有 IP（快速检查）
    if (isPrivateIP(hostname)) {
      return { valid: false, error: '禁止访问私有 IP 地址' };
    }

    // 检查域名白名单
    if (!allowAnyDomain) {
      const whitelist = customWhitelist || ALLOWED_PROXY_DOMAINS;
      const isAllowed = whitelist.some(domain => {
        if (domain.startsWith('*.')) {
          const baseDomain = domain.slice(2);
          return hostname === baseDomain || hostname.endsWith('.' + baseDomain);
        }
        return hostname === domain;
      });

      if (!isAllowed) {
        return { valid: false, error: `域名不在白名单中: ${hostname}` };
      }
    }

    return { valid: true, parsedUrl };
  } catch {
    return { valid: false, error: '无效的 URL' };
  }
}

/**
 * 获取允许的域名列表（用于调试）
 */
export function getAllowedDomains(): string[] {
  return [...ALLOWED_PROXY_DOMAINS];
}

/**
 * 添加域名到白名单（运行时动态添加）
 */
export function addAllowedDomain(domain: string): void {
  if (!ALLOWED_PROXY_DOMAINS.includes(domain)) {
    ALLOWED_PROXY_DOMAINS.push(domain);
  }
}

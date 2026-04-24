'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { 
  Users, 
  DollarSign, 
  Gift, 
  Coins, 
  Plus, 
  Search, 
  Eye, 
  Trash2,
  Phone,
  User as UserIcon,
  AlertCircle,
  Crown,
  LogOut,
  Ticket,
  Copy,
  Check,
  Key,
  Package,
  Edit2,
  Edit,
  Save,
  X,
  GripVertical,
  Sun,
  Moon,
  Palette,
  Pencil,
  Trash,
  Grip,
  Image,
  FileText,
  RefreshCw
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * 根据模型名称判断类型
 */
function inferModelType(modelKey: string): { type: string; configId: number } {
  const key = modelKey.toLowerCase();
  
  // 视频模型
  if (key.includes('sora') || key.includes('veo') || key.includes('video')) {
    return { type: 'video_generation', configId: 2 };
  }
  
  // 工具模型（不区分分辨率）
  if (key.includes('smart_split') || key.includes('split') || key.includes('upscale') || key.includes('enhance')) {
    return { type: 'tool', configId: 3 };
  }
  
  // 默认图片模型
  return { type: 'image_generation', configId: 1 };
}

/**
 * 基础宽高比列表（所有图片模型通用）
 */
const BASE_IMAGE_ASPECT_RATIOS = [
  { label: '自动', value: 'auto' },
  { label: '1:1', value: '1:1' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '5:4', value: '5:4' },
  { label: '4:5', value: '4:5' },
  { label: '21:9', value: '21:9' },
];

/**
 * nano-banana-2 系列额外支持的宽高比
 */
const BANANA2_EXTRA_ASPECT_RATIOS = [
  { label: '1:4', value: '1:4' },
  { label: '4:1', value: '4:1' },
  { label: '1:8', value: '1:8' },
  { label: '8:1', value: '8:1' },
];

/**
 * nano-banana-2 系列完整宽高比
 */
const BANANA2_ASPECT_RATIOS = [...BASE_IMAGE_ASPECT_RATIOS, ...BANANA2_EXTRA_ASPECT_RATIOS];

/**
 * 根据模型类型推断参数配置
 */
function inferParameters(credits: number, modelType: string, config?: any, modelKey?: string): any {
  // 判断是否为 nano-banana-2 系列
  const isBanana2Series = modelKey && ['nano-banana-2', 'nano-banana-2-cl', 'nano-banana-2-4k-cl'].includes(modelKey.toLowerCase());
  const aspectRatios = isBanana2Series ? BANANA2_ASPECT_RATIOS : BASE_IMAGE_ASPECT_RATIOS;
  
  // 如果有自定义 resolutions，使用自定义配置
  if (config?.resolutions && Array.isArray(config.resolutions) && config.resolutions.length > 0) {
    if (modelType === 'video_generation') {
      return { durations: config.resolutions, aspectRatios: [{ label: '自动', value: 'auto' }, { label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }, { label: '1:1', value: '1:1' }] };
    }
    return { resolutions: config.resolutions, aspectRatios };
  }
  
  if (modelType === 'video_generation') {
    return {
      durations: [
        { label: '5秒', value: '5s', credits: credits },
        { label: '10秒', value: '10s', credits: credits * 2 },
      ],
      aspectRatios: [{ label: '自动', value: 'auto' }, { label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }, { label: '1:1', value: '1:1' }],
    };
  }
  
  if (modelType === 'tool') {
    return { credits_base: credits };
  }
  
  // 特定模型的分辨率支持（按特定性从高到低匹配）
  if (modelKey) {
    const key = modelKey.toLowerCase();
    
    // ===== 只支持 4K 的模型 =====
    if (key === 'nano-banana-2-4k-cl' || key === 'nano-banana-pro-4k-vip') {
      return {
        resolutions: [
          { label: '4K', value: '4K', credits: credits },
        ],
        aspectRatios,
      };
    }
    
    // ===== 只支持 1K 的模型 =====
    if (key === 'nano-banana' || key === 'nano-banana-fast') {
      return {
        resolutions: [
          { label: '1K', value: '1K', credits: credits },
        ],
        aspectRatios,
      };
    }
    
    // ===== 只支持 1K, 2K 的模型 =====
    if (key === 'nano-banana-2-cl' || key === 'nano-banana-pro-vip') {
      return {
        resolutions: [
          { label: '1K', value: '1K', credits: credits },
          { label: '2K', value: '2K', credits: Math.round(credits * 1.2) },
        ],
        aspectRatios,
      };
    }
    
    // ===== 支持 1K, 2K, 4K 的模型 =====
    if (key === 'nano-banana-2' || 
        key === 'nano-banana-pro' || 
        key === 'nano-banana-pro-vt' || 
        key === 'nano-banana-pro-cl') {
      return {
        resolutions: [
          { label: '1K', value: '1K', credits: credits },
          { label: '2K', value: '2K', credits: Math.round(credits * 1.2) },
          { label: '4K', value: '4K', credits: Math.round(credits * 1.5) },
        ],
        aspectRatios,
      };
    }
  }
  
  // 默认支持所有分辨率
  return {
    resolutions: [
      { label: '1K', value: '1K', credits: credits },
      { label: '2K', value: '2K', credits: Math.round(credits * 1.2) },
      { label: '4K', value: '4K', credits: Math.round(credits * 1.5) },
    ],
    aspectRatios,
  };
}

interface User {
  id: string;
  nickname: string;
  phone: string;
  email?: string;               // 邮箱（可选）
  credits: number;              // 普通积分
  avatar?: string;              // 头像URL
  isAdmin?: boolean;            // 是否为管理员
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  rechargeRecords?: RechargeRecord[];
  exchangeRecords?: ExchangeRecord[];
  pointUsageRecords?: PointUsageRecord[];
}

interface Admin {
  id?: string;
  nickname: string;
  phone: string;
  totalQuota: number;         // 供应总配额（供应商积分÷100，仅显示）
  remainingQuota: number;     // 剩余配额（独立可编辑，初始值0）
  usedCredits: number;        // 已分配积分（所有用户积分总和）
  credits: number;            // 负责人普通积分
  supplierCredits?: number;   // 供应商原始积分（显示用）
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
  isAdmin: boolean;
}

interface RechargeRecord {
  id: number;
  user_id: string;
  amount: number;
  points: number;
  payment_method: string;
  status: string;
  created_at: string;
  users?: { nickname: string; phone: string };
}

interface ExchangeRecord {
  id: number;
  user_id: string;
  key_code?: string;
  item_name?: string;
  credits?: number;
  points_used?: number;
  status: string;
  created_at: string;
  users?: { nickname: string; phone: string };
}

interface PointUsageRecord {
  id: number;
  user_id: string;
  model_name: string;
  points_used: number;
  description?: string;
  created_at: string;
  users?: { nickname: string; phone: string };
}

interface RedeemKey {
  id: number;
  key_code: string;
  credits: number;
  status: 'unused' | 'used';
  used_by?: string;
  used_at?: string;
  created_at: string;
  created_by?: string;
  channel?: 'normal' | 'limited';
  is_limited?: boolean;
  users?: { nickname: string; phone: string };
}

interface ApiKey {
  id: number;
  name: string;
  key: string;
  type: string;
  status: 'active' | 'inactive';
  created_at: string;
}

interface RechargePackage {
  id: number;
  name: string;
  price: number;
  credits: number;
  tag: string | null;
  savings: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

interface ModelCreditsConfig {
  id: number;
  model_key: string;
  model_name: string;
  credits: number;
  resolutions?: any[]; // #114 新增：支持分辨率配置
  description: string | null;
  is_active: boolean;
  is_visible: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string | null;
}

// ===== API 配置类型（简化版）=====

// API 接口配置
interface ApiConfig {
  id: number;
  name: string;                          // 接口名称，如 "图片生成 - GRS AI"
  service_type: string;                  // 服务类型: image_generation, video_generation, smart_split
  description: string | null;
  
  // API 文档
  api_endpoint: string;                  // 接口地址
  request_method: string;                // 请求方式: POST, GET
  request_headers: Record<string, string>;
  request_body_template: Record<string, any>;
  response_parser: Record<string, any> | null;
  
  // 认证
  api_key: string | null;                // API 密钥
  
  // 状态
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string | null;
}

// 模型配置
interface ApiModel {
  id: number;
  config_id: number;                     // 关联 API 配置
  config_name?: string;                  // 配置名称（后台显示用）
  service_type?: string;                 // 服务类型（后台显示用）
  
  // 基本信息
  model_id: string;                      // 模型 ID
  model_name: string;                    // 模型名称
  description: string | null;
  
  // API 端点（可选，为空时使用接口的默认端点）
  api_endpoint: string | null;
  
  // 参数配置 (JSON) - 前端直接渲染
  // 例如: {"resolutions": [...], "aspectRatios": [...]}
  parameters: Record<string, any>;
  
  // 积分
  credits_base: number;
  
  // 状态
  is_active: boolean;
  is_visible: boolean;  // #115 新增：是否展示
  sort_order: number;
  created_at: string;
  updated_at: string | null;
}

// 其他集成服务
const OTHER_SERVICES = [
  {
    id: 'storage',
    name: '对象存储',
    description: '腾讯云COS对象存储服务',
    icon: '☁️',
  },
  {
    id: 'database',
    name: '数据库',
    description: 'Supabase数据库服务',
    icon: '🗄️',
    placeholder: '输入Service Role Key',
  },
];

export default function AdminDashboard() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [rechargeRecords, setRechargeRecords] = useState<RechargeRecord[]>([]);
  const [exchangeRecords, setExchangeRecords] = useState<ExchangeRecord[]>([]);
  const [pointUsageRecords, setPointUsageRecords] = useState<PointUsageRecord[]>([]);
  // #271 积分流水量表
  const [creditLogs, setCreditLogs] = useState<any[]>([]);
  const [creditLogsPagination, setCreditLogsPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [creditLogsFilter, setCreditLogsFilter] = useState({ userId: '', type: 'all', startDate: '', endDate: '' });
  const [redeemKeys, setRedeemKeys] = useState<RedeemKey[]>([]);
  const [redeemChannelFilter, setRedeemChannelFilter] = useState<string>('all');
  const [redeemStatusFilter, setRedeemStatusFilter] = useState<string>('unused');
  const [showGenerateKeyDialog, setShowGenerateKeyDialog] = useState(false);
  const [showGenerateLimitedKeyDialog, setShowGenerateLimitedKeyDialog] = useState(false);
  const [keyChannel, setKeyChannel] = useState<'normal' | 'limited'>('normal');
  const [keyChannelName, setKeyChannelName] = useState('普通渠道');
  const [newKeyCredits, setNewKeyCredits] = useState(100);
  const [newKeyCount, setNewKeyCount] = useState(10);
  const [generatedKeys, setGeneratedKeys] = useState<RedeemKey[]>([]);
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false); // 是否已完成首次加载
  const [searchPhone, setSearchPhone] = useState('');
  const [searchNickname, setSearchNickname] = useState('');
  const [searchEmail, setSearchEmail] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showUserDialog, setShowUserDialog] = useState(false);
  const [showAddUserDialog, setShowAddUserDialog] = useState(false);
  const [showAddCreditsDialog, setShowAddCreditsDialog] = useState(false);
  const [showEditQuotaDialog, setShowEditQuotaDialog] = useState(false); // #111 新增：编辑剩余配额对话框
  const [editQuotaValue, setEditQuotaValue] = useState(0); // #111 新增：编辑剩余配额的值
  const [showDistributeDialog, setShowDistributeDialog] = useState(false);
  const [distributeUserId, setDistributeUserId] = useState<string | null>(null);
  const [distributeAmount, setDistributeAmount] = useState(0);
  const [activeTab, setActiveTab] = useState('users');

  // 用户编辑
  const [editingUser, setEditingUser] = useState<any>(null);
  const [showEditUserDialog, setShowEditUserDialog] = useState(false);

  // API 配置管理（简化版）
  const [apiConfigs, setApiConfigs] = useState<ApiConfig[]>([]);
  const [apiModels, setApiModels] = useState<ApiModel[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null); // 当前选中的 API 接口
  const [editingConfig, setEditingConfig] = useState<any>(null);
  const [showConfigDialog, setShowConfigDialog] = useState(false);

  // 充值套餐管理
  const [packages, setPackages] = useState<RechargePackage[]>([]);
  const [editingPackage, setEditingPackage] = useState<RechargePackage | null>(null);
  const [showPackageDialog, setShowPackageDialog] = useState(false);
  const [newPackage, setNewPackage] = useState<Partial<RechargePackage>>({
    name: '',
    price: 990,
    credits: 600,
    tag: '',
    savings: 0,
    sort_order: 0,
    is_active: true,
  });

  // 新增用户表单
  const [newUser, setNewUser] = useState({ nickname: '', phone: '', email: '', credits: 0, password: '' });
  const [addCreditsAmount, setAddCreditsAmount] = useState(0);
  
  // 后台独立的日夜模式（不与前端互通）
  const [adminDarkMode, setAdminDarkMode] = useState(false);

  // 记录弹窗状态
  const [showRechargeDialog, setShowRechargeDialog] = useState(false);
  const [showExchangeDialog, setShowExchangeDialog] = useState(false);
  const [showPointUsageDialog, setShowPointUsageDialog] = useState(false);
  
  // 模型积分消耗配置
  const [modelCreditsConfigs, setModelCreditsConfigs] = useState<ModelCreditsConfig[]>([]);
  const [editingModelConfig, setEditingModelConfig] = useState<ModelCreditsConfig | null>(null);
  const [showModelConfigDialog, setShowModelConfigDialog] = useState(false);
  const [newModelConfig, setNewModelConfig] = useState<Partial<ModelCreditsConfig>>({
    model_key: '',
    model_name: '',
    credits: 10,
    description: '',
  });

  // 模型分组
  const [imageModelConfigs, setImageModelConfigs] = useState<ModelCreditsConfig[]>([]);
  const [videoModelConfigs, setVideoModelConfigs] = useState<ModelCreditsConfig[]>([]);
  const [toolModelConfigs, setToolModelConfigs] = useState<ModelCreditsConfig[]>([]);

  // 根据 model_key 判断模型类型
  const getModelType = (modelKey: string | null): 'image' | 'video' | 'tool' => {
    if (!modelKey) return 'image'; // 空值默认返回 image
    const key = modelKey.toLowerCase();
    if (key.includes('sora') || key.includes('veo') || key.includes('video')) return 'video';
    if (key.includes('smart_split') || key.includes('split') || key.includes('upscale') || key.includes('enhance')) return 'tool';
    return 'image';
  };

  // 更新分组 - #204 统一数据源：完全使用 apiModels 数据
  useEffect(() => {
    const image: ModelCreditsConfig[] = [];
    const video: ModelCreditsConfig[] = [];
    const tool: ModelCreditsConfig[] = [];

    // 直接使用 apiModels 数据（来自 /api/linjiaqi/api-config，即 api_models 表）
    apiModels.forEach(model => {
      const type = getModelType(model.model_id);
      const config: ModelCreditsConfig = {
        id: model.id,
        model_key: model.model_id,
        model_name: model.model_name,
        credits: model.credits_base,
        resolutions: model.parameters?.resolutions || [],
        description: model.description,
        is_active: model.is_active ?? true,
        is_visible: model.is_visible ?? true,
        sort_order: model.sort_order ?? model.id,
        created_at: '',
        updated_at: null,
      };
      if (type === 'image') image.push(config);
      else if (type === 'video') video.push(config);
      else tool.push(config);
    });

    setImageModelConfigs(image);
    setVideoModelConfigs(video);
    setToolModelConfigs(tool);
  }, [apiModels]);

  // 画布配置管理
  const [canvasConfigs, setCanvasConfigs] = useState<any[]>([]);
  const [editingCanvasConfig, setEditingCanvasConfig] = useState<any>(null);
  const [showCanvasConfigDialog, setShowCanvasConfigDialog] = useState(false);
  const [newCanvasConfig, setNewCanvasConfig] = useState<Partial<any>>({
    config_key: '',
    config_type: 'welcome_message',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 0,
  });

  useEffect(() => {
    // 检查登录状态
    let cancelled = false;
    
    const checkLogin = async () => {
      try {
        // 🔧 优先检查 localStorage（避免 SSR/cookie 同步问题）
        if (typeof window !== 'undefined') {
          const userStr = localStorage.getItem('user');
          if (userStr) {
            try {
              const user = JSON.parse(userStr);
              // 验证是否是管理员
              if (user.phone === '13824085362') {
                setCurrentUser(user);
                fetchData();
                return; // localStorage 验证成功，直接返回
              }
            } catch {
              // localStorage 解析失败，继续走 API 验证
            }
          }
        }
        
        if (cancelled) return;
        
        // API 验证（兜底）
        // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
        const res = await fetch('/api/user/info', { credentials: 'include' });
        const data = await res.json();
        
        if (cancelled) return;
        
        if (data.success && data.user) {
          // 验证是否是管理员
          if (data.user.phone !== '13824085362') {
            router.push('/');
            return;
          }
          setCurrentUser(data.user);
          fetchData();
        } else {
          // 没有登录信息，跳转登录页
          router.push('/login?redirect=/linjiaqi');
        }
      } catch (error) {
        if (cancelled) return;
        console.error('检查登录状态失败:', error);
        router.push('/login?redirect=/linjiaqi');
      }
    };
    
    checkLogin();
    
    return () => {
      cancelled = true;
    };
  }, []); // 只在组件挂载时执行一次，不依赖 router

  // 筛选条件变化时重新获取兑换码列表
  useEffect(() => {
    if (currentUser) {
      fetchRedeemKeys();
    }
  }, [redeemChannelFilter, redeemStatusFilter, currentUser]);

  // 🔧 #121 焦点回刷 + 30秒静默轮询（管理后台积分动态化）
  // 🔧 #270 新增：监听 creditsChanged 事件，本地热更新用户积分（0 API 请求）
  useEffect(() => {
    if (!currentUser) return;

    // 1. 焦点回刷：切换回管理后台标签页时自动刷新
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[管理后台] 焦点回刷：刷新积分数据');
        fetchAdminInfo();
        // 焦点回刷时仍调用 API（用户可能长时间离开，需要获取最新数据）
        fetch('/api/users', { credentials: 'include' })
          .then(res => res.json())
          .then(data => data.data && setUsers(data.data))
          .catch(err => console.error('[管理后台] 刷新用户列表失败:', err));
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 2. 静默轮询：30秒一次（作为兜底）
    const pollInterval = setInterval(() => {
      console.log('[管理后台] 静默轮询：刷新积分数据');
      fetchAdminInfo();
    }, 30000);

    // 3. #270 监听全局积分变化事件（本地热更新，0 API 请求）
    const handleCreditsChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ userId?: string; newCredits?: number }>;
      const { userId, newCredits } = customEvent.detail || {};
      
      if (userId && newCredits !== undefined) {
        console.log(`[管理后台] #270 本地热更新用户积分: userId=${userId}, newCredits=${newCredits}`);
        // 遍历 users 数组，精准替换对应用户的积分
        setUsers(prev => prev.map(u => 
          u.id === userId ? { ...u, credits: newCredits } : u
        ));
      } else {
        // 兜底：没有 userId 时仍调用 API（兼容旧事件）
        console.log('[管理后台] 积分变化事件无详情，回退到 API 刷新');
        fetch('/api/users', { credentials: 'include' })
          .then(res => res.json())
          .then(data => data.data && setUsers(data.data))
          .catch(err => console.error('[管理后台] 刷新用户列表失败:', err));
      }
    };
    window.addEventListener('creditsChanged', handleCreditsChanged);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(pollInterval);
      window.removeEventListener('creditsChanged', handleCreditsChanged);
    };
  }, [currentUser]);

  // 拖拽排序功能
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      // 判断拖拽的项目属于哪个分组
      const activeConfig = [...imageModelConfigs, ...videoModelConfigs, ...toolModelConfigs].find(c => c.id === active.id);
      if (!activeConfig) return;
      
      const modelType = getModelType(activeConfig.model_key);
      
      if (modelType === 'image') {
        const oldIndex = imageModelConfigs.findIndex(c => c.id === active.id);
        const newIndex = imageModelConfigs.findIndex(c => c.id === over.id);
        const newOrder = arrayMove(imageModelConfigs, oldIndex, newIndex);
        setImageModelConfigs(newOrder);
        updateSortOrder(newOrder, 'image');
      } else if (modelType === 'video') {
        const oldIndex = videoModelConfigs.findIndex(c => c.id === active.id);
        const newIndex = videoModelConfigs.findIndex(c => c.id === over.id);
        const newOrder = arrayMove(videoModelConfigs, oldIndex, newIndex);
        setVideoModelConfigs(newOrder);
        updateSortOrder(newOrder, 'video');
      } else if (modelType === 'tool') {
        const oldIndex = toolModelConfigs.findIndex(c => c.id === active.id);
        const newIndex = toolModelConfigs.findIndex(c => c.id === over.id);
        const newOrder = arrayMove(toolModelConfigs, oldIndex, newIndex);
        setToolModelConfigs(newOrder);
        updateSortOrder(newOrder, 'tool');
      }
    }
  };

  const updateSortOrder = async (newOrder: any[], modelType: 'image' | 'video' | 'tool') => {
    try {
      console.log(`[排序] 更新 ${modelType} 模型排序`);
      // #115 修复：直接更新 api_models 表
      await Promise.all(newOrder.map((config, index) => 
        fetch('/api/linjiaqi/api-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            table: 'api_models',
            id: config.id,
            data: { sort_order: index },
          }),
        })
      ));
      console.log(`[排序] ${modelType} 模型排序保存成功`);
      
      // 刷新 apiModels 数据
      fetchApiConfig();
    } catch (error) {
      console.error('更新排序失败:', error);
    }
  };

  // 可拖拽的表格行组件
  function SortableTableRow({ config, modelType }: { config: any; modelType: 'image' | 'video' | 'tool' }) {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: config.id });

    // 如果数据库中有 resolutions，直接使用（优先级最高！）
    // 否则通过 inferParameters 函数生成
    let resolutions: any[] = [];
    
    if (config.resolutions && Array.isArray(config.resolutions) && config.resolutions.length > 0) {
      // 用户已经配置了 resolutions，直接使用
      resolutions = config.resolutions;
    } else {
      // 用户没有配置，使用 inferParameters 生成
      const inferredParams = inferParameters(config.credits || 10, 'image_generation', null, config.model_key);
      resolutions = inferredParams.resolutions || [];
    }
    
    // 根据 label 快速查找
    const getCredits = (label: string) => {
      const found = resolutions.find((r: any) => r.label === label);
      return found ? found.credits : null;
    };

    // 更新积分
    const updateCredits = async (label: string, credits: number) => {
      // 获取当前数据库中的 resolutions
      const currentDbResolutions = config.resolutions || [];
      
      // 找到要更新的分辨率在数据库中的位置
      const existingIndex = currentDbResolutions.findIndex((r: any) => r.label === label);
      
      let newRes;
      if (existingIndex >= 0) {
        // 数据库中已有这个分辨率，更新它
        newRes = [...currentDbResolutions];
        newRes[existingIndex] = { ...newRes[existingIndex], credits };
      } else {
        // 数据库中没有这个分辨率，添加它
        newRes = [...currentDbResolutions, { label, value: label, credits }];
      }
      
      // #203 修复：同步更新 credits_base（取第一个分辨率的 credits）
      const newCreditsBase = newRes.length > 0 ? newRes[0].credits : credits;
      
      // 先更新本地状态
      setApiModels(prev => prev.map(model => {
        if (model.id !== config.id) return model;
        return {
          ...model,
          parameters: { ...model.parameters, resolutions: newRes },
          credits_base: newCreditsBase,
        };
      }));

      // 发送到服务器保存 - 同时更新 resolutions 和 credits_base
      const res = await fetch('/api/linjiaqi/api-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          table: 'api_models',
          id: config.id,
          data: {
            parameters: { ...(apiModels.find(m => m.id === config.id)?.parameters || {}), resolutions: newRes },
            credits_base: newCreditsBase,
          },
        }),
      });
      const data = await res.json();
      
      if (data.success) {
        window.dispatchEvent(new CustomEvent('modelCreditsUpdated'));
        toast.success('保存成功');
      } else {
        fetchApiConfig();
        toast.error('保存失败: ' + (data.error || '未知错误'));
      }
    };

    // 使用 ref 获取输入值，避免 defaultValue 重置问题
    const modelNameRef = useRef<HTMLInputElement>(null);
    const descriptionRef = useRef<HTMLInputElement>(null);

    const handleModelNameBlur = async () => {
      const newName = modelNameRef.current?.value.trim() || '';
      if (newName !== config.model_name) {
        await updateModelCredits(config.id, 'model_name', newName);
      }
    };

    const handleDescriptionBlur = async () => {
      const newDesc = descriptionRef.current?.value || '';
      if (newDesc !== (config.description || '')) {
        await updateModelCredits(config.id, 'description', newDesc);
      }
    };

    const handleStatusToggle = async () => {
      await updateModelCredits(config.id, 'is_active', !config.is_active);
    };

    const handleVisibleToggle = async () => {
      // 🔧 重构：直接更新数据库 is_visible 字段，不再使用 hidden-models.json
      const newVisible = config.is_visible !== false;
      await updateModelCredits(config.id, 'is_visible', !newVisible);
    };

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
      zIndex: isDragging ? 1000 : 1,
    };

    // 渲染单元格：有分辨率显示输入框，无数据显示短横线
    const renderCreditsCell = (label: string) => {
      const credits = getCredits(label);
      
      // 检查模型是否支持该分辨率
      const isSupported = resolutions.some((r: any) => r.label === label);
      
      if (!isSupported) {
        // 不支持的分辨率显示为灰色
        return (
          <span className="text-gray-300 text-sm">-</span>
        );
      }
      
      if (credits === null) {
        return (
          <span className="text-gray-400 text-sm">-</span>
        );
      }

      return (
        <input
          type="number"
          defaultValue={credits}
          onBlur={(e) => updateCredits(label, Number(e.target.value) || 0)}
          className="w-12 h-7 px-1 text-sm text-center border border-transparent hover:border-blue-400 focus:border-blue-500 rounded outline-none bg-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      );
    };
    
    // 获取模型支持的所有分辨率标签
    const getSupportedResolutionLabels = () => {
      return resolutions.map((r: any) => r.label);
    };
    
    const supportedLabels = getSupportedResolutionLabels();

    return (
      <TableRow ref={setNodeRef} style={style}>
        <TableCell>
          <button
            className="cursor-grab active:cursor-grabbing p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
            {...attributes}
            {...listeners}
          >
            <Grip className="h-4 w-4 text-gray-400" />
          </button>
        </TableCell>
        <TableCell className="font-mono text-sm">{config.model_key}</TableCell>
        <TableCell>
          <input
            ref={modelNameRef}
            type="text"
            defaultValue={config.model_name}
            onBlur={handleModelNameBlur}
            className="w-full px-2 py-1 text-sm border border-transparent hover:border-gray-300 focus:border-blue-500 rounded outline-none bg-transparent"
          />
        </TableCell>
        {/* 根据模型类型显示不同列 */}
        {modelType === 'image' && (
          <>
            <TableCell className="text-center align-middle">{renderCreditsCell('1K')}</TableCell>
            <TableCell className="text-center align-middle">{renderCreditsCell('2K')}</TableCell>
            <TableCell className="text-center align-middle">{renderCreditsCell('4K')}</TableCell>
          </>
        )}
        {modelType === 'video' && (
          <>
            <TableCell className="text-center align-middle">{renderCreditsCell('5秒')}</TableCell>
            <TableCell className="text-center align-middle">{renderCreditsCell('10秒')}</TableCell>
          </>
        )}
        {modelType === 'tool' && (
          <TableCell className="text-center align-middle">
            <input
              type="number"
              defaultValue={config.credits || 10}
              onBlur={async (e) => {
                const newCredits = Number(e.target.value) || 0;
                if (newCredits !== config.credits) {
                  await updateModelCredits(config.id, 'credits', newCredits);
                }
              }}
              className="w-12 h-7 px-1 text-sm text-center border border-transparent hover:border-blue-400 focus:border-blue-500 rounded outline-none bg-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </TableCell>
        )}
        <TableCell>
          <input
            ref={descriptionRef}
            type="text"
            defaultValue={config.description || ''}
            onBlur={handleDescriptionBlur}
            className="w-full px-2 py-1 text-sm border border-transparent hover:border-gray-300 focus:border-blue-500 rounded outline-none bg-transparent"
          />
        </TableCell>
        <TableCell>
          <Badge 
            variant={config.is_active ? 'default' : 'secondary'}
            className="cursor-pointer hover:opacity-80"
            onClick={handleStatusToggle}
          >
            {config.is_active ? '启用' : '禁用'}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge 
            variant={config.is_visible !== false ? 'default' : 'secondary'}
            className="cursor-pointer hover:opacity-80"
            onClick={handleVisibleToggle}
          >
            {config.is_visible !== false ? '展示' : '隐藏'}
          </Badge>
        </TableCell>
        <TableCell>
          <Button
            variant="outline"
            size="sm"
            onClick={() => deleteModelConfig(config.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </TableCell>
      </TableRow>
    );
  }

  const handleLogout = () => {
    localStorage.removeItem('user');
    router.push('/login');
  };

  const fetchData = async (showLoading: boolean = true) => {
    if (showLoading && !initialLoaded) setLoading(true);
    try {
      // 获取管理员信息（独立，不阻塞其他请求）
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      fetch('/api/linjiaqi/credits', { credentials: 'include' })
        .then(res => res.json())
        .then(adminData => {
          const newAdmin = adminData.data;
          if (newAdmin) {
            setAdmin(prev => {
              // 如果新数据 totalQuota 为 0 且之前有有效数据，保留旧值
              // （供应商API超时时 totalQuota 会变成 0）
              if (newAdmin.totalQuota === 0 && prev && prev.totalQuota > 0) {
                return {
                  ...newAdmin,
                  totalQuota: prev.totalQuota,
                  supplierCredits: prev.supplierCredits,
                };
              }
              return newAdmin;
            });
          }
        })
        .catch(err => console.error('获取管理员信息失败:', err));
      
      // 获取用户列表
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const usersRes = await fetch('/api/users', { credentials: 'include' });
      const usersData = await usersRes.json();
      setUsers(usersData.data || []);
      
      // 尝试获取其他数据
      const [rechargeRes, exchangeRes, pointsRes] = await Promise.all([
        fetch('/api/recharge', { credentials: 'include' }),
        fetch('/api/exchange', { credentials: 'include' }),
        fetch('/api/points', { credentials: 'include' }),
      ]);

      const rechargeData = await rechargeRes.json();
      const exchangeData = await exchangeRes.json();
      const pointsData = await pointsRes.json();

      setRechargeRecords(rechargeData.data || []);
      setExchangeRecords(exchangeData.data || []);
      setPointUsageRecords(pointsData.data || []);
      
      // 获取兑换码列表
      fetchRedeemKeys();
      
      // 获取API密钥列表
      fetchApiConfig();
      
      // 获取充值套餐列表
      fetchPackages();
      
      // 获取模型积分配置列表
      fetchModelCreditsConfigs();
      
      // 获取画布配置列表
      fetchCanvasConfigs();
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setInitialLoaded(true);
    }
  };

  // 获取画布配置列表
  const fetchCanvasConfigs = async () => {
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/linjiaqi/canvas-config', { credentials: 'include' });
      const data = await res.json();
      setCanvasConfigs(data.data || []);
    } catch (error) {
      console.error('Error fetching canvas configs:', error);
    }
  };

  // 保存画布配置
  const saveCanvasConfig = async (config: any) => {
    try {
      const isEditing = !!config.id;
      const url = isEditing ? '/api/linjiaqi/canvas-config' : '/api/linjiaqi/canvas-config';
      const method = isEditing ? 'PUT' : 'POST';
      
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      });
      const data = await res.json();
      
      if (data.success) {
        fetchCanvasConfigs();
        setShowCanvasConfigDialog(false);
        setEditingCanvasConfig(null);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error saving canvas config:', error);
      return false;
    }
  };

  // 删除画布配置
  const deleteCanvasConfig = async (id: number) => {
    if (!confirm('确定要删除这个配置项吗？')) return;
    
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch(`/api/linjiaqi/canvas-config?id=${id}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      
      if (data.success) {
        fetchCanvasConfigs();
      }
    } catch (error) {
      console.error('Error deleting canvas config:', error);
    }
  };

  // 获取充值记录
  const fetchRechargeRecords = async () => {
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/recharge', { credentials: 'include' });
      const data = await res.json();
      setRechargeRecords(data.data || []);
    } catch (error) {
      console.error('Error fetching recharge records:', error);
    }
  };

  // 获取兑换记录
  const fetchExchangeRecords = async () => {
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/exchange', { credentials: 'include' });
      const data = await res.json();
      setExchangeRecords(data.data || []);
    } catch (error) {
      console.error('Error fetching exchange records:', error);
    }
  };

  // 获取积分使用记录
  const fetchPointUsageRecords = async () => {
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/points', { credentials: 'include' });
      const data = await res.json();
      setPointUsageRecords(data.data || []);
    } catch (error) {
      console.error('Error fetching point usage records:', error);
    }
  };

  // #271 获取积分流水记录
  const fetchCreditLogs = async (page = 1) => {
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', '50');
      if (creditLogsFilter.userId) params.set('user_id', creditLogsFilter.userId);
      if (creditLogsFilter.type && creditLogsFilter.type !== 'all') params.set('type', creditLogsFilter.type);
      if (creditLogsFilter.startDate) params.set('start_date', creditLogsFilter.startDate);
      if (creditLogsFilter.endDate) params.set('end_date', creditLogsFilter.endDate);
      
      const res = await fetch(`/api/linjiaqi/credit-logs?${params.toString()}`, { credentials: 'include' });
      const data = await res.json();
      setCreditLogs(data.data || []);
      setCreditLogsPagination(data.pagination || { page: 1, pageSize: 50, total: 0, totalPages: 0 });
    } catch (error) {
      console.error('Error fetching credit logs:', error);
    }
  };

  // 获取充值套餐列表
  const fetchPackages = async () => {
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/linjiaqi/packages', { credentials: 'include' });
      const data = await res.json();
      setPackages(data.data || []);
    } catch (error) {
      console.error('Error fetching packages:', error);
    }
  };

  // 获取模型积分配置列表
  const fetchModelCreditsConfigs = async () => {
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/linjiaqi/model-credits', { credentials: 'include' });
      const data = await res.json();
      setModelCreditsConfigs(data.data || []);
    } catch (error) {
      console.error('Error fetching model credits configs:', error);
    }
  };

  // 保存模型积分配置 - #115 修复：直接保存到 api_models 表
  const saveModelConfig = async () => {
    if (!newModelConfig.model_key || !newModelConfig.model_name || newModelConfig.credits === undefined) {
      toast.error('请填写必填字段');
      return;
    }

    try {
      // #115 直接更新 api_models 表的 credits_base 字段
      if (editingModelConfig) {
        // 编辑模式：直接更新 api_models 表
        const res = await fetch('/api/linjiaqi/api-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            table: 'api_models',
            id: editingModelConfig.id,
            data: {
              model_id: newModelConfig.model_key,
              model_name: newModelConfig.model_name,
              credits_base: newModelConfig.credits,
              description: newModelConfig.description,
            },
          }),
        });
        const data = await res.json();

        if (data.success) {
          setShowModelConfigDialog(false);
          setEditingModelConfig(null);
          setNewModelConfig({
            model_key: '',
            model_name: '',
            credits: 10,
            description: '',
          });
          fetchApiConfig(); // 刷新 apiModels 数据
          toast.success('保存成功');
        } else {
          toast.error(data.error || '保存失败');
        }
      } else {
        // 新增模式：暂时不支持，因为需要关联 config_id
        toast.error('请到 API 配置页面添加新模型');
      }
    } catch (error) {
      console.error('保存配置失败:', error);
      toast.error('保存失败');
    }
  };

  // 删除模型积分配置 - #115 修复：直接删除 api_models 表
  const deleteModelConfig = async (id: number) => {
    if (!confirm('确定要删除这个配置吗？')) return;

    try {
      const res = await fetch(`/api/linjiaqi/api-config?table=api_models&id=${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();

      if (data.success) {
        fetchApiConfig(); // 刷新 apiModels 数据
        toast.success('删除成功');
      } else {
        toast.error(data.error || '删除失败');
      }
    } catch (error) {
      console.error('Error deleting model config:', error);
      toast.error('删除失败');
    }
  };

  // 保存模型积分配置 - #115 修复：直接更新 api_models 表
  const updateModelCredits = async (id: number, field: string, value: any) => {
    console.log('[DEBUG] updateModelCredits called:', { id, field, value });
    
    try {
      // #115 字段映射：前端字段名 -> api_models 表字段名
      const fieldMapping: Record<string, string> = {
        'model_key': 'model_id',
        'model_name': 'model_name',
        'credits': 'credits_base',
        'description': 'description',
        'is_active': 'is_active',
        'is_visible': 'is_visible',
        'resolutions': 'parameters', // resolutions 存储在 parameters 字段中
      };
      
      const apiField = fieldMapping[field] || field;
      
      // 特殊处理：resolutions 需要合并到 parameters 中
      let dataValue = value;
      if (field === 'resolutions') {
        // 获取当前的 parameters，然后更新 resolutions
        const currentModel = apiModels.find(m => m.id === id);
        const currentParams = currentModel?.parameters || {};
        dataValue = { ...currentParams, resolutions: value };
      }
      
      // 先更新本地状态
      setApiModels(prev => prev.map(model => {
        if (model.id !== id) return model;
        if (field === 'resolutions') {
          return { ...model, parameters: { ...model.parameters, resolutions: value } };
        }
        return { ...model, [apiField]: value };
      }));

      // 发送到服务器保存 - 直接更新 api_models 表
      const res = await fetch('/api/linjiaqi/api-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          table: 'api_models',
          id: id,
          data: { [apiField]: dataValue },
        }),
      });
      const data = await res.json();
      console.log('[DEBUG] Response:', data);

      if (data.success) {
        // 刷新模型列表页面
        window.dispatchEvent(new CustomEvent('modelCreditsUpdated'));
        toast.success('保存成功');
      } else {
        // 如果保存失败，恢复原状态
        fetchApiConfig();
        toast.error('保存失败: ' + (data.error || '未知错误'));
      }
    } catch (error) {
      console.error('[DEBUG] Error:', error);
      fetchApiConfig();
      toast.error('保存失败，请重试');
    }
  };

  // 保存套餐
  const savePackage = async () => {
    if (!newPackage.name || !newPackage.price || !newPackage.credits) {
      toast.error('请填写必填字段');
      return;
    }

    try {
      const url = editingPackage ? `/api/linjiaqi/packages` : '/api/linjiaqi/packages';
      const method = editingPackage ? 'PUT' : 'POST';
      const body = editingPackage 
        ? { id: editingPackage.id, ...newPackage }
        : newPackage;

      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        setShowPackageDialog(false);
        setEditingPackage(null);
        setNewPackage({
          name: '',
          price: 990,
          credits: 600,
          tag: '',
          savings: 0,
          sort_order: 0,
          is_active: true,
        });
        fetchPackages();
        toast.success(editingPackage ? '更新成功' : '添加成功');
      } else {
        toast.error(data.error || '操作失败');
      }
    } catch (error) {
      console.error('Error saving package:', error);
      toast.error('操作失败');
    }
  };

  // 删除套餐
  const deletePackage = async (id: number) => {
    if (!confirm('确定要删除这个套餐吗？')) return;

    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch(`/api/linjiaqi/packages?id=${id}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();

      if (data.success) {
        fetchPackages();
        toast.success('删除成功');
      } else {
        toast.error(data.error || '删除失败');
      }
    } catch (error) {
      console.error('Error deleting package:', error);
      toast.error('删除失败');
    }
  };

  // 格式化价格（分转元）
  const formatPrice = (price: number) => {
    return (price / 100).toFixed(1);
  };

  // 格式化积分
  const formatCredits = (credits: number) => {
    return credits.toLocaleString();
  };

  // 获取兑换码列表
  const fetchRedeemKeys = async () => {
    try {
      const params = new URLSearchParams();
      if (redeemStatusFilter !== 'all') params.append('status', redeemStatusFilter);
      if (redeemChannelFilter !== 'all') params.append('channel', redeemChannelFilter);
      const queryString = params.toString();
      const url = queryString ? `/api/linjiaqi/redeem-keys?${queryString}` : '/api/linjiaqi/redeem-keys';
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      setRedeemKeys(data.data || []);
    } catch (error) {
      console.error('Error fetching redeem keys:', error);
    }
  };

  // 获取 API 配置（新版）
  const fetchApiConfig = async () => {
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/linjiaqi/api-config', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setApiConfigs(data.data.configs || []);
        setApiModels(data.data.models || []);
      }
    } catch (error) {
      console.error('Error fetching API config:', error);
    }
  };

  // 更新 API 配置
  const updateApiConfig = async (table: string, id: number, data: any) => {
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/linjiaqi/api-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ table, id, data }),
      });
      const result = await res.json();
      if (result.success) {
        fetchApiConfig();
        toast.success('更新成功');
      } else {
        toast.error(result.error || '更新失败');
      }
    } catch (error) {
      console.error('Error updating API config:', error);
      toast.error('更新失败');
    }
  };

  // 生成兑换码（普通渠道）
  const generateRedeemKeys = async () => {
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/linjiaqi/redeem-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          credits: newKeyCredits,
          count: newKeyCount,
          channel: 'normal',
          isLimited: false,
        }),
      });
      const data = await res.json();
      
      if (data.success) {
        setGeneratedKeys(data.data || []);
        fetchRedeemKeys();
        toast.success(data.message);
      } else {
        toast.error(data.error || '生成失败');
      }
    } catch (error) {
      console.error('Error generating redeem keys:', error);
      toast.error('生成失败');
    }
  };

  // 生成限量渠道兑换码
  const generateLimitedRedeemKeys = async () => {
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/linjiaqi/redeem-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          credits: newKeyCredits,
          count: newKeyCount,
          channel: 'limited',
          isLimited: true,
        }),
      });
      const data = await res.json();
      
      if (data.success) {
        setGeneratedKeys(data.data || []);
        fetchRedeemKeys();
        toast.success(data.message);
      } else {
        toast.error(data.error || '生成失败');
      }
    } catch (error) {
      console.error('Error generating limited redeem keys:', error);
      toast.error('生成失败');
    }
  };

  // 删除兑换码
  const deleteRedeemKey = async (id: number) => {
    if (!confirm('确定要删除这个兑换码吗？')) return;
    
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/linjiaqi/redeem-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      
      if (data.success) {
        fetchRedeemKeys();
        toast.success('删除成功');
      } else {
        toast.error(data.error || '删除失败');
      }
    } catch (error) {
      console.error('Error deleting redeem key:', error);
      toast.error('删除失败');
    }
  };

  // 复制兑换码
  const copyKeyCode = async (keyCode: string, keyId: number) => {
    try {
      await navigator.clipboard.writeText(keyCode);
      setCopiedKeyId(keyId);
      setTimeout(() => setCopiedKeyId(null), 2000);
    } catch {
      toast.error('复制失败');
    }
  };

  const searchUsers = async () => {
    try {
      const params = new URLSearchParams();
      if (searchPhone) params.append('phone', searchPhone);
      if (searchNickname) params.append('nickname', searchNickname);
      if (searchEmail) params.append('email', searchEmail);
      
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch(`/api/users?${params}`, { credentials: 'include' });
      const data = await res.json();
      setUsers(data.data || []);
    } catch (error) {
      console.error('Error searching users:', error);
    }
  };

  const fetchUserDetail = async (id: string) => {
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch(`/api/users/${id}`, { credentials: 'include' });
      const data = await res.json();
      setSelectedUser(data.data);
      setShowUserDialog(true);
    } catch (error) {
      console.error('Error fetching user detail:', error);
    }
  };

  const createUser = async () => {
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      if (data.data) {
        // 乐观更新：直接添加新用户到列表
        setUsers(prev => [data.data, ...prev]);
        setNewUser({ nickname: '', phone: '', email: '', credits: 0, password: '' });
        setShowAddUserDialog(false);
        toast.success('用户创建成功');
      } else {
        toast.error(data.error || '创建失败');
      }
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error('创建失败，请重试');
    }
  };

  const deleteUser = async (id: string) => {
    if (!confirm('确定要删除这个用户吗？')) return;
    
    // 乐观更新：先从列表中移除
    const userToDelete = users.find(u => u.id === id);
    setUsers(prev => prev.filter(u => u.id !== id));
    
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      
      if (data.success) {
        toast.success('用户已删除');
      } else {
        // 删除失败，恢复用户
        setUsers(prev => [...prev, userToDelete!].sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ));
        toast.error(data.error || '删除失败');
      }
    } catch (error) {
      // 删除失败，恢复用户
      setUsers(prev => [...prev, userToDelete!].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ));
      console.error('Error deleting user:', error);
      toast.error('删除失败，请重试');
    }
  };

  const distributeCredits = async (operation: 'add' | 'subtract' | 'deduct' = 'add') => {
    if (!distributeUserId || distributeAmount <= 0) return;
    
    const targetUser = users.find(u => u.id === distributeUserId);
    const isAdmin = targetUser?.phone === '13824085362';
    const originalCredits = targetUser?.credits || 0;
    const amount = distributeAmount; // 保存金额，后面会清空
    
    // 乐观更新：先更新本地状态
    if (!isAdmin) {
      setUsers(prev => prev.map(u => {
        if (u.id === distributeUserId) {
          const newCredits = operation === 'add' 
            ? u.credits + amount 
            : Math.max(0, u.credits - amount);
          return { ...u, credits: newCredits };
        }
        return u;
      }));
    }
    
    // 清空输入并关闭对话框（提升用户体验）
    setDistributeAmount(0);
    setDistributeUserId(null);
    setShowDistributeDialog(false);
    
    try {
      if (isAdmin || operation === 'deduct') {
        // 管理员：划扣配额
        // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
        const res = await fetch('/api/linjiaqi/distribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ userId: distributeUserId, amount, operation: 'deduct' }),
        });
        const data = await res.json();
        if (data.success) {
          // 刷新 admin 状态（供应配额相关）
          fetchAdminInfo();
          // #270 触发全局积分变化事件，携带 userId 和 newCredits 实现本地热更新
          if (data.data?.userNewCredits !== undefined) {
            window.dispatchEvent(new CustomEvent('creditsChanged', {
              detail: {
                userId: distributeUserId,
                newCredits: data.data.userNewCredits,
                source: 'admin',
              }
            }));
          }
          toast.success(`成功划扣 ${amount} 配额`);
        } else {
          // 恢复用户积分
          if (!isAdmin) {
            setUsers(prev => prev.map(u => {
              if (u.id === distributeUserId) return { ...u, credits: originalCredits };
              return u;
            }));
          }
          toast.error(data.error || '划扣失败');
        }
      } else {
        // 普通用户：增加或扣减积分
        // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
        const res = await fetch('/api/linjiaqi/distribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ userId: distributeUserId, amount, operation }),
        });
        const data = await res.json();
        if (data.success) {
          // #270 触发全局积分变化事件，携带 userId 和 newCredits 实现本地热更新
          if (data.data?.userNewCredits !== undefined) {
            window.dispatchEvent(new CustomEvent('creditsChanged', {
              detail: {
                userId: distributeUserId,
                newCredits: data.data.userNewCredits,
                source: 'admin',
              }
            }));
          }
          toast.success(operation === 'add' 
            ? `成功增加 ${amount} 积分给用户` 
            : `成功扣减 ${amount} 积分`);
        } else {
          // 恢复用户积分
          setUsers(prev => prev.map(u => {
            if (u.id === distributeUserId) return { ...u, credits: originalCredits };
            return u;
          }));
          toast.error(data.error || '操作失败');
        }
      }
    } catch (error) {
      // 恢复用户积分
      if (!isAdmin) {
        setUsers(prev => prev.map(u => {
          if (u.id === distributeUserId) return { ...u, credits: originalCredits };
          return u;
        }));
      }
      console.error('Error distributing credits:', error);
      toast.error('操作失败，请重试');
    }
  };

  // 单独获取管理员信息
  const fetchAdminInfo = async () => {
    try {
      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/linjiaqi/credits', { credentials: 'include' });
      const data = await res.json();
      const newAdmin = data.data;
      if (newAdmin) {
        setAdmin(prev => {
          // 如果新数据 totalQuota 为 0 且之前有有效数据，保留旧值
          if (newAdmin.totalQuota === 0 && prev && prev.totalQuota > 0) {
            return {
              ...newAdmin,
              totalQuota: prev.totalQuota,
              supplierCredits: prev.supplierCredits,
            };
          }
          return newAdmin;
        });
      }
    } catch (error) {
      console.error('Error fetching admin info:', error);
    }
  };

  const updateAdminCredits = async (amount: number, operation: 'deduct') => {
    try {
      // 获取管理员用户ID
      const adminUser = users.find(u => u.phone === '13824085362');
      if (!adminUser?.id) {
        toast.error('管理员账户未找到');
        return;
      }

      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
      const res = await fetch('/api/linjiaqi/distribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: adminUser.id, amount, operation: 'deduct' }),
      });
      const data = await res.json();
      if (data.success) {
        setAddCreditsAmount(0);
        setShowAddCreditsDialog(false);
        fetchAdminInfo(); // 只刷新管理员信息
        toast.success(`成功划扣 ${amount} 配额`);
      } else {
        toast.error(data.error || '操作失败');
      }
    } catch (error) {
      console.error('Error updating admin credits:', error);
      toast.error('操作失败，请重试');
    }
  };

  // #111 新增：更新剩余配额
  const updateRemainingQuota = async (value: number) => {
    try {
      const res = await fetch('/api/linjiaqi/credits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ remainingQuota: value }),
      });
      const data = await res.json();
      if (data.success) {
        setShowEditQuotaDialog(false);
        fetchAdminInfo();
        toast.success('剩余配额已更新');
      } else {
        toast.error(data.error || '更新失败');
      }
    } catch (error) {
      console.error('Error updating remaining quota:', error);
      toast.error('更新失败，请重试');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN');
  };

  // 只在首次加载时显示全屏loading，后续操作不会覆盖整个页面
  if (loading && !initialLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">加载中...</div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen p-6 transition-colors duration-300"
      style={adminDarkMode ? {
        // 暗黑模式 - 完整的 CSS 变量集合（与 globals.css .dark 一致）
        backgroundColor: 'oklch(0.145 0 0)',
        '--background': 'oklch(0.145 0 0)',
        '--foreground': 'oklch(0.985 0 0)',
        '--card': 'oklch(0.205 0 0)',
        '--card-foreground': 'oklch(0.985 0 0)',
        '--popover': 'oklch(0.205 0 0)',
        '--popover-foreground': 'oklch(0.985 0 0)',
        '--primary': 'oklch(0.922 0 0)',
        '--primary-foreground': 'oklch(0.205 0 0)',
        '--secondary': 'oklch(0.269 0 0)',
        '--secondary-foreground': 'oklch(0.985 0 0)',
        '--muted': 'oklch(0.269 0 0)',
        '--muted-foreground': 'oklch(0.708 0 0)',
        '--accent': 'oklch(0.269 0 0)',
        '--accent-foreground': 'oklch(0.985 0 0)',
        '--destructive': 'oklch(0.704 0.191 22.216)',
        '--border': 'oklch(1 0 0 / 10%)',
        '--input': 'oklch(1 0 0 / 15%)',
        '--ring': 'oklch(0.556 0 0)',
      } as React.CSSProperties : {
        // 白天模式 - 完整的 CSS 变量集合（与 globals.css :root 一致）
        backgroundColor: 'oklch(1 0 0)',
        '--background': 'oklch(1 0 0)',
        '--foreground': 'oklch(0.145 0 0)',
        '--card': 'oklch(1 0 0)',
        '--card-foreground': 'oklch(0.145 0 0)',
        '--popover': 'oklch(1 0 0)',
        '--popover-foreground': 'oklch(0.145 0 0)',
        '--primary': 'oklch(0.205 0 0)',
        '--primary-foreground': 'oklch(0.985 0 0)',
        '--secondary': 'oklch(0.97 0 0)',
        '--secondary-foreground': 'oklch(0.205 0 0)',
        '--muted': 'oklch(0.97 0 0)',
        '--muted-foreground': 'oklch(0.556 0 0)',
        '--accent': 'oklch(0.97 0 0)',
        '--accent-foreground': 'oklch(0.205 0 0)',
        '--destructive': 'oklch(0.577 0.245 27.325)',
        '--border': 'oklch(0.922 0 0)',
        '--input': 'oklch(0.922 0 0)',
        '--ring': 'oklch(0.708 0 0)',
      } as React.CSSProperties}
    >
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Kiikii AI 后台管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">用户数据管理系统</p>
          </div>
          <div className="flex items-center gap-3">
            {/* 🔧 环境指示器：一眼识别开发/生产环境 */}
            {process.env.NODE_ENV === 'development' ? (
              <span className="px-3 py-1 text-xs font-bold rounded-full bg-red-100 text-red-600 border border-red-200 animate-pulse">
                ⚠️ 本地开发环境 (随便造)
              </span>
            ) : (
              <span className="px-3 py-1 text-xs font-bold rounded-full bg-green-100 text-green-600 border border-green-200">
                ✅ 线上正式环境 (谨慎操作)
              </span>
            )}
            
            {/* 日夜模式切换 */}
            <button
              onClick={() => setAdminDarkMode(!adminDarkMode)}
              className={`p-2 rounded-xl transition-all ${adminDarkMode ? 'bg-gray-800 text-yellow-400 hover:bg-gray-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              title={adminDarkMode ? '切换到日间模式' : '切换到夜间模式'}
            >
              {adminDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {currentUser && (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">{currentUser.nickname || '用户'}</p>
                  <p className="text-xs text-muted-foreground">{currentUser.phone}</p>
                </div>
                <Button variant="outline" size="sm" onClick={handleLogout} className="flex items-center gap-2 h-8">
                  <LogOut className="h-4 w-4" />
                  退出
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* 管理员信息卡片 */}
        {admin && (
          <Card className={`mb-6 border ${adminDarkMode ? 'bg-gray-900/80 border-violet-800/50' : 'bg-gradient-to-r from-violet-50 to-indigo-50 border-violet-100'}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className={`flex items-center gap-2 text-base ${adminDarkMode ? 'text-violet-300' : 'text-violet-700'}`}>
                  <Crown className="h-4 w-4" />
                  管理员账户
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className={`p-3 rounded-xl ${adminDarkMode ? 'bg-gray-800/80' : 'bg-white/60'}`}>
                  <Label className="text-xs text-muted-foreground">手机号</Label>
                  <p className="font-medium text-foreground mt-0.5">{admin.phone}</p>
                </div>
                <div className={`p-3 rounded-xl ${adminDarkMode ? 'bg-gray-800/80' : 'bg-white/60'}`}>
                  <Label className="text-xs text-muted-foreground">供应总配额</Label>
                  <p className="font-semibold text-lg text-blue-400 flex items-center gap-1.5 mt-0.5">
                    <Coins className="h-4 w-4" />
                    {admin.totalQuota}
                  </p>
                  {admin.supplierCredits !== undefined && (
                    <p className="text-xs mt-0.5 text-muted-foreground">
                      供应商原始: {admin.supplierCredits.toLocaleString()}
                    </p>
                  )}
                </div>
                <div className={`p-3 rounded-xl ${adminDarkMode ? 'bg-gray-800/80' : 'bg-white/60'}`}>
                  <Label className="text-xs text-muted-foreground">负责人积分</Label>
                  <p className={`font-semibold text-lg flex items-center gap-1.5 mt-0.5 ${adminDarkMode ? 'text-violet-400' : 'text-violet-500'}`}>
                    <Coins className="h-4 w-4" />
                    {admin.credits}
                  </p>
                </div>
                <div className={`p-3 rounded-xl ${adminDarkMode ? 'bg-gray-800/80' : 'bg-white/60'}`}>
                  <Label className="text-xs text-muted-foreground">已分配积分</Label>
                  <p className={`font-semibold text-lg flex items-center gap-1.5 mt-0.5 ${adminDarkMode ? 'text-blue-400' : 'text-blue-500'}`}>
                    <Coins className="h-4 w-4" />
                    {admin.usedCredits}
                  </p>
                </div>
                <div className={`p-3 rounded-xl ${adminDarkMode ? 'bg-gray-800/80' : 'bg-white/60'}`}>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">剩余配额</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-5 px-1.5 text-xs ${adminDarkMode ? 'hover:bg-gray-700' : ''}`}
                      onClick={() => setShowEditQuotaDialog(true)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                  <p className={`font-semibold text-lg flex items-center gap-1.5 mt-0.5 ${admin.remainingQuota < 0 ? 'text-red-400' : adminDarkMode ? 'text-emerald-400' : 'text-emerald-500'}`}>
                    <Coins className="h-4 w-4" />
                    {admin.remainingQuota}
                    {admin.remainingQuota < 0 && (
                      <span className="text-xs text-red-400 ml-1">(异常)</span>
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className={`w-full flex justify-start gap-1 mb-6 h-auto p-1 ${adminDarkMode ? 'bg-gray-800/50' : 'bg-gray-100'} rounded-xl`}>
            <TabsTrigger value="users" className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Users className="h-4 w-4" />
              用户管理
            </TabsTrigger>
            <TabsTrigger value="packages" className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Package className="h-4 w-4" />
              充值套餐
            </TabsTrigger>
            <TabsTrigger value="model-credits" className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Coins className="h-4 w-4" />
              积分配置
            </TabsTrigger>
            <TabsTrigger value="redeem-keys" className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Ticket className="h-4 w-4" />
              兑换码
            </TabsTrigger>
            <TabsTrigger value="api-keys" className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Key className="h-4 w-4" />
              API密钥
            </TabsTrigger>
            <TabsTrigger value="canvas-config" className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Palette className="h-4 w-4" />
              画布配置
            </TabsTrigger>
            <TabsTrigger value="credit-logs" className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <FileText className="h-4 w-4" />
              积分流水
            </TabsTrigger>
          </TabsList>

          {/* 记录查看按钮 */}
          <div className="flex gap-2 mb-6">
            <Button variant="outline" onClick={() => { setShowRechargeDialog(true); fetchRechargeRecords(); }}>
              <DollarSign className="h-4 w-4 mr-1" />
              充值记录
            </Button>
            <Button variant="outline" onClick={() => { setShowExchangeDialog(true); fetchExchangeRecords(); }}>
              <Gift className="h-4 w-4 mr-1" />
              兑换记录
            </Button>
            <Button variant="outline" onClick={() => { setShowPointUsageDialog(true); fetchPointUsageRecords(); }}>
              <Coins className="h-4 w-4 mr-1" />
              积分使用
            </Button>
          </div>

          {/* 充值记录弹窗 */}
          <Dialog open={showRechargeDialog} onOpenChange={setShowRechargeDialog}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
              <DialogHeader>
                <DialogTitle>充值记录</DialogTitle>
              </DialogHeader>
              {rechargeRecords.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>用户</TableHead>
                      <TableHead>充值金额</TableHead>
                      <TableHead>获得积分</TableHead>
                      <TableHead>支付方式</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rechargeRecords.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell>{record.id}</TableCell>
                        <TableCell>
                          {record.users ? (
                            <div className="flex items-center gap-2">
                              <UserIcon className="h-4 w-4" />
                              <span>{record.users.nickname}</span>
                              <Phone className="h-3 w-3 text-gray-400" />
                              <span className="text-gray-500 text-sm">{record.users.phone}</span>
                            </div>
                          ) : (
                            `用户${record.user_id.slice(0, 8)}`
                          )}
                        </TableCell>
                        <TableCell className="text-green-600 font-semibold">
                          ¥{(record.amount / 100).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                            <Coins className="h-3 w-3" />
                            +{record.points}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {record.payment_method === 'alipay' ? '支付宝' : 
                           record.payment_method === 'wechat' ? '微信' : '银行卡'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={record.status === 'completed' ? 'default' : 'secondary'}>
                            {record.status === 'completed' ? '已完成' : '处理中'}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDate(record.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>暂无充值记录</AlertDescription>
                </Alert>
              )}
            </DialogContent>
          </Dialog>

          {/* 兑换记录弹窗 */}
          <Dialog open={showExchangeDialog} onOpenChange={setShowExchangeDialog}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
              <DialogHeader>
                <DialogTitle>兑换记录</DialogTitle>
              </DialogHeader>
              {exchangeRecords.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>用户</TableHead>
                      <TableHead>兑换码</TableHead>
                      <TableHead>获得积分</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exchangeRecords.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell>{record.id}</TableCell>
                        <TableCell>
                          {record.users ? (
                            <div className="flex items-center gap-2">
                              <UserIcon className="h-4 w-4" />
                              <span>{record.users.nickname}</span>
                            </div>
                          ) : (
                            `用户${record.user_id.slice(0, 8)}`
                          )}
                        </TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-2 py-1 rounded">{record.key_code || record.item_name || '-'}</code>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                            <Coins className="h-3 w-3" />
                            +{record.credits || record.points_used}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={record.status === 'completed' ? 'default' : 'secondary'}>
                            {record.status === 'completed' ? '已完成' : '处理中'}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDate(record.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>暂无兑换记录</AlertDescription>
                </Alert>
              )}
            </DialogContent>
          </Dialog>

          {/* 积分使用记录弹窗 */}
          <Dialog open={showPointUsageDialog} onOpenChange={setShowPointUsageDialog}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
              <DialogHeader>
                <DialogTitle>积分使用记录</DialogTitle>
              </DialogHeader>
              {pointUsageRecords.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>用户</TableHead>
                      <TableHead>模型</TableHead>
                      <TableHead>使用积分</TableHead>
                      <TableHead>描述</TableHead>
                      <TableHead>时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pointUsageRecords.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell>{record.id}</TableCell>
                        <TableCell>
                          {record.users ? (
                            <div className="flex items-center gap-2">
                              <UserIcon className="h-4 w-4" />
                              <span>{record.users.nickname}</span>
                            </div>
                          ) : (
                            `用户${record.user_id.slice(0, 8)}`
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{record.model_name}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                            <Coins className="h-3 w-3" />
                            -{record.points_used}
                          </Badge>
                        </TableCell>
                        <TableCell>{record.description || '-'}</TableCell>
                        <TableCell>{formatDate(record.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>暂无积分使用记录</AlertDescription>
                </Alert>
              )}
            </DialogContent>
          </Dialog>

          {/* 用户管理 */}
          <TabsContent value="users">
            <Card className={`border ${adminDarkMode ? 'bg-gray-900/50 border-gray-800' : 'border-gray-200'}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>用户列表</CardTitle>
                  <Dialog open={showAddUserDialog} onOpenChange={setShowAddUserDialog}>
                    <DialogTrigger asChild>
                      <Button className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        添加用户
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>添加新用户</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="nickname">用户名</Label>
                          <Input
                            id="nickname"
                            value={newUser.nickname}
                            onChange={(e) => setNewUser({ ...newUser, nickname: e.target.value })}
                            placeholder="请输入用户名"
                          />
                        </div>
                        <div>
                          <Label htmlFor="phone">手机号</Label>
                          <Input
                            id="phone"
                            value={newUser.phone}
                            onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                            placeholder="请输入手机号"
                          />
                        </div>
                        <div>
                          <Label htmlFor="email">邮箱</Label>
                          <Input
                            id="email"
                            type="email"
                            value={newUser.email || ''}
                            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                            placeholder="请输入邮箱（选填）"
                          />
                        </div>
                        <div>
                          <Label htmlFor="password">密码</Label>
                          <Input
                            id="password"
                            type="password"
                            value={newUser.password}
                            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                            placeholder="请输入密码"
                          />
                        </div>
                        <div>
                          <Label htmlFor="credits">初始积分</Label>
                          <Input
                            id="credits"
                            type="number"
                            value={newUser.credits}
                            onChange={(e) => setNewUser({ ...newUser, credits: parseInt(e.target.value) || 0 })}
                            placeholder="请输入初始积分"
                          />
                        </div>
                        <Button onClick={createUser} className="w-full">
                          创建用户
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>

                  {/* 编辑用户对话框 */}
                  <Dialog open={showEditUserDialog} onOpenChange={setShowEditUserDialog}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>编辑用户</DialogTitle>
                      </DialogHeader>
                      {editingUser && (
                        <div className="space-y-4">
                          <div>
                            <Label>用户名</Label>
                            <Input
                              value={editingUser.nickname || ''}
                              onChange={(e) => setEditingUser({ ...editingUser, nickname: e.target.value })}
                              placeholder="请输入用户名"
                            />
                          </div>
                          <div>
                            <Label>手机号</Label>
                            <Input
                              value={editingUser.phone || ''}
                              onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}
                              placeholder="请输入手机号"
                            />
                          </div>
                          <div>
                            <Label>邮箱</Label>
                            <Input
                              type="email"
                              value={editingUser.email || ''}
                              onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                              placeholder="请输入邮箱（选填）"
                            />
                          </div>
                          <div>
                            <Label>状态</Label>
                            <Select
                              value={editingUser.is_active === false ? 'disabled' : 'active'}
                              onValueChange={(value) => setEditingUser({ ...editingUser, is_active: value === 'active' })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="选择状态" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="active">正常</SelectItem>
                                <SelectItem value="disabled">禁用</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            onClick={async () => {
                              try {
                                const res = await fetch(`/api/users/${editingUser.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  credentials: 'include',
                                  body: JSON.stringify({
                                    nickname: editingUser.nickname,
                                    phone: editingUser.phone,
                                    email: editingUser.email,
                                    isActive: editingUser.is_active,
                                  }),
                                });
                                const data = await res.json();
                                if (data.data) {
                                  setShowEditUserDialog(false);
                                  setEditingUser(null);
                                  searchUsers();
                                  toast.success('用户信息已更新');
                                } else {
                                  toast.error(data.error || '更新失败');
                                }
                              } catch (error) {
                                toast.error('更新失败');
                              }
                            }}
                            className="w-full"
                          >
                            保存修改
                          </Button>
                        </div>
                      )}
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 mb-4">
                  <Input
                    placeholder="搜索手机号"
                    value={searchPhone}
                    onChange={(e) => setSearchPhone(e.target.value)}
                    className="max-w-xs"
                  />
                  <Input
                    placeholder="搜索用户名"
                    value={searchNickname}
                    onChange={(e) => setSearchNickname(e.target.value)}
                    className="max-w-xs"
                  />
                  <Input
                    placeholder="搜索邮箱"
                    value={searchEmail}
                    onChange={(e) => setSearchEmail(e.target.value)}
                    className="max-w-xs"
                  />
                  <Button onClick={searchUsers} className="flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    搜索
                  </Button>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>用户名</TableHead>
                      <TableHead>手机号</TableHead>
                      <TableHead>邮箱</TableHead>
                      <TableHead>剩余积分</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>创建时间</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user, index) => (
                      <TableRow key={user.id || `admin-${index}`} className={user.phone === '13824085362' ? (adminDarkMode ? 'bg-purple-900/30' : 'bg-purple-50') : ''}>
                        <TableCell className="font-mono text-xs">{user.id ? `${String(user.id).slice(0, 8)}...` : '供应商'}</TableCell>
                        <TableCell>
                          {user.phone === '13824085362' ? (
                            <span className="flex items-center gap-1">
                              <Crown className={`h-4 w-4 ${adminDarkMode ? 'text-purple-400' : 'text-purple-500'}`} />
                              负责人
                            </span>
                          ) : (
                            user.nickname || '-'
                          )}
                        </TableCell>
                        <TableCell>{user.phone}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{user.email || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                            <Coins className="h-3 w-3" />
                            {user.credits}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.is_active !== false ? 'default' : 'destructive'}>
                            {user.is_active !== false ? '正常' : '禁用'}
                          </Badge>
                        </TableCell>
                        <TableCell>{user.created_at ? formatDate(user.created_at) : '-'}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => user.id && fetchUserDetail(user.id)}
                              disabled={!user.id}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingUser(user);
                                setShowEditUserDialog(true);
                              }}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setDistributeUserId(user.id);
                                setShowDistributeDialog(true);
                              }}
                            >
                              <Coins className="h-4 w-4" />
                            </Button>
                            {user.phone !== '13824085362' && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => deleteUser(user.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 充值套餐管理 */}
          <TabsContent value="packages">
            <Card className={`border ${adminDarkMode ? 'bg-gray-900/50 border-gray-800' : 'border-gray-200'}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>充值套餐管理</CardTitle>
                  <Button 
                    className="flex items-center gap-2"
                    onClick={() => {
                      setEditingPackage(null);
                      setNewPackage({
                        name: '',
                        price: 990,
                        credits: 600,
                        tag: '',
                        savings: 0,
                        sort_order: packages.length,
                        is_active: true,
                      });
                      setShowPackageDialog(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    添加套餐
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>排序</TableHead>
                      <TableHead>名称</TableHead>
                      <TableHead>价格</TableHead>
                      <TableHead>积分</TableHead>
                      <TableHead>标签</TableHead>
                      <TableHead>节省</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packages.map((pkg) => (
                      <TableRow key={pkg.id}>
                        <TableCell>{pkg.sort_order}</TableCell>
                        <TableCell className="font-medium">{pkg.name}</TableCell>
                        <TableCell className="text-lg font-bold">¥{formatPrice(pkg.price)}</TableCell>
                        <TableCell>{formatCredits(pkg.credits)}</TableCell>
                        <TableCell>
                          {pkg.tag ? (
                            <Badge className="bg-gradient-to-r from-[#9C6CFE] to-[#C874F9]">{pkg.tag}</Badge>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          {pkg.savings ? (
                            <span className="text-green-600">省 ¥{formatPrice(pkg.savings)}</span>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={pkg.is_active ? 'default' : 'secondary'}>
                            {pkg.is_active ? '启用' : '禁用'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingPackage(pkg);
                                setNewPackage({
                                  name: pkg.name,
                                  price: pkg.price,
                                  credits: pkg.credits,
                                  tag: pkg.tag || '',
                                  savings: pkg.savings || 0,
                                  sort_order: pkg.sort_order,
                                  is_active: pkg.is_active,
                                });
                                setShowPackageDialog(true);
                              }}
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => deletePackage(pkg.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* 预览区域 */}
                <div className="mt-8">
                  <h3 className="text-lg font-semibold mb-4">前端预览</h3>
                  <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
                    {packages.filter(p => p.is_active).map((pkg) => (
                      <div 
                        key={pkg.id}
                        className="bg-white rounded-xl p-6 relative border border-gray-200"
                      >
                        {pkg.tag && (
                          <div className="absolute -top-0 right-4 px-3 py-1 bg-gradient-to-br from-[#9C6CFE] to-[#C874F9] rounded-full text-white text-xs font-medium">
                            {pkg.tag}
                          </div>
                        )}
                        <p className="text-gray-800 text-2xl font-bold mb-1">¥{formatPrice(pkg.price)}</p>
                        <p className="text-gray-500 text-sm mb-1">{formatCredits(pkg.credits)} 积分</p>
                        {pkg.savings ? (
                          <div className="flex items-center gap-2">
                            <p className="text-gray-500 text-xs">¥{((pkg.price / 100) / pkg.credits).toFixed(4)}/积分</p>
                            <span className="text-green-600 text-xs">省 ¥{formatPrice(pkg.savings)}</span>
                          </div>
                        ) : (
                          <p className="text-gray-500 text-xs">¥{((pkg.price / 100) / pkg.credits).toFixed(4)}/积分</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 添加/编辑套餐对话框 */}
            <Dialog open={showPackageDialog} onOpenChange={setShowPackageDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingPackage ? '编辑套餐' : '添加套餐'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>套餐名称</Label>
                    <Input
                      value={newPackage.name || ''}
                      onChange={(e) => setNewPackage({ ...newPackage, name: e.target.value })}
                      placeholder="如：超值套餐"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>价格（元）</Label>
                      <Input
                        type="number"
                        value={newPackage.price ? newPackage.price / 100 : ''}
                        onChange={(e) => setNewPackage({ ...newPackage, price: Math.round(parseFloat(e.target.value) * 100) })}
                        placeholder="9.9"
                      />
                    </div>
                    <div>
                      <Label>积分</Label>
                      <Input
                        type="number"
                        value={newPackage.credits || ''}
                        onChange={(e) => setNewPackage({ ...newPackage, credits: parseInt(e.target.value) || 0 })}
                        placeholder="600"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>标签（可选）</Label>
                      <Input
                        value={newPackage.tag || ''}
                        onChange={(e) => setNewPackage({ ...newPackage, tag: e.target.value })}
                        placeholder="如：推荐"
                      />
                    </div>
                    <div>
                      <Label>节省金额（元）</Label>
                      <Input
                        type="number"
                        value={newPackage.savings ? newPackage.savings / 100 : ''}
                        onChange={(e) => setNewPackage({ ...newPackage, savings: Math.round(parseFloat(e.target.value) * 100) })}
                        placeholder="10"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>排序</Label>
                      <Input
                        type="number"
                        value={newPackage.sort_order || 0}
                        onChange={(e) => setNewPackage({ ...newPackage, sort_order: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-6">
                      <input
                        type="checkbox"
                        checked={newPackage.is_active}
                        onChange={(e) => setNewPackage({ ...newPackage, is_active: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <Label>启用</Label>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-4">
                    <Button onClick={savePackage} className="flex-1">
                      {editingPackage ? '保存修改' : '添加套餐'}
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setShowPackageDialog(false);
                        setEditingPackage(null);
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* 模型积分消耗配置 */}
          <TabsContent value="model-credits">
            <div className="space-y-6">
              {/* 图片模型 */}
              <Card className={`border ${adminDarkMode ? 'bg-gray-900/50 border-gray-800' : 'border-gray-200'}`}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="text-xl">🖼️</span> 图片模型
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext items={imageModelConfigs.map(c => c.id)} strategy={verticalListSortingStrategy}>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10 align-middle">排序</TableHead>
                            <TableHead className="align-middle">模型标识</TableHead>
                            <TableHead className="align-middle">模型名称</TableHead>
                            <TableHead className="text-center align-middle">1K</TableHead>
                            <TableHead className="text-center align-middle">2K</TableHead>
                            <TableHead className="text-center align-middle">4K</TableHead>
                            <TableHead className="align-middle">描述</TableHead>
                            <TableHead className="text-center align-middle">状态</TableHead>
                            <TableHead className="text-center align-middle">展示</TableHead>
                            <TableHead className="align-middle">操作</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {imageModelConfigs.map((config) => (
                            <SortableTableRow key={config.id} config={config} modelType="image" />
                          ))}
                          {imageModelConfigs.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={10} className="text-center text-gray-500 py-4">
                                暂无图片模型配置
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </SortableContext>
                  </DndContext>
                </CardContent>
              </Card>

              {/* 视频模型 */}
              <Card className={`border ${adminDarkMode ? 'bg-gray-900/50 border-gray-800' : 'border-gray-200'}`}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="text-xl">🎬</span> 视频模型
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext items={videoModelConfigs.map(c => c.id)} strategy={verticalListSortingStrategy}>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10 align-middle">排序</TableHead>
                            <TableHead className="align-middle">模型标识</TableHead>
                            <TableHead className="align-middle">模型名称</TableHead>
                            <TableHead className="text-center align-middle">5秒</TableHead>
                            <TableHead className="text-center align-middle">10秒</TableHead>
                            <TableHead className="align-middle">描述</TableHead>
                            <TableHead className="text-center align-middle">状态</TableHead>
                            <TableHead className="text-center align-middle">展示</TableHead>
                            <TableHead className="align-middle">操作</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {videoModelConfigs.map((config) => (
                            <SortableTableRow key={config.id} config={config} modelType="video" />
                          ))}
                          {videoModelConfigs.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={9} className="text-center text-gray-500 py-4">
                                暂无视频模型配置
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </SortableContext>
                  </DndContext>
                </CardContent>
              </Card>

              {/* 工具模型 */}
              <Card className={`border ${adminDarkMode ? 'bg-gray-900/50 border-gray-800' : 'border-gray-200'}`}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="text-xl">🔧</span> 工具模型
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext items={toolModelConfigs.map(c => c.id)} strategy={verticalListSortingStrategy}>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10 align-middle">排序</TableHead>
                            <TableHead className="align-middle">模型标识</TableHead>
                            <TableHead className="align-middle">模型名称</TableHead>
                            <TableHead className="text-center align-middle">基础积分</TableHead>
                            <TableHead className="align-middle">描述</TableHead>
                            <TableHead className="text-center align-middle">状态</TableHead>
                            <TableHead className="text-center align-middle">展示</TableHead>
                            <TableHead className="align-middle">操作</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {toolModelConfigs.map((config) => (
                            <SortableTableRow key={config.id} config={config} modelType="tool" />
                          ))}
                          {toolModelConfigs.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center text-gray-500 py-4">
                                暂无工具模型配置
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </SortableContext>
                  </DndContext>
                </CardContent>
              </Card>

              {/* 添加按钮 */}
              <div className="flex justify-center">
                <Button 
                  className="flex items-center gap-2"
                  onClick={() => {
                    setEditingModelConfig(null);
                    setNewModelConfig({
                      model_key: '',
                      model_name: '',
                      credits: 10,
                      description: '',
                    });
                    setShowModelConfigDialog(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  添加配置
                </Button>
              </div>
            </div>

            {/* 添加/编辑模型配置对话框 */}
            <Dialog open={showModelConfigDialog} onOpenChange={setShowModelConfigDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingModelConfig ? '编辑配置' : '添加配置'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>模型标识 *</Label>
                    <Input
                      value={newModelConfig.model_key || ''}
                      onChange={(e) => setNewModelConfig({ ...newModelConfig, model_key: e.target.value })}
                      placeholder="如：smart_split, longcat_upscale"
                      disabled={!!editingModelConfig}
                    />
                    <p className="text-xs text-gray-500 mt-1">唯一标识，创建后不可修改</p>
                  </div>
                  <div>
                    <Label>模型名称 *</Label>
                    <Input
                      value={newModelConfig.model_name || ''}
                      onChange={(e) => setNewModelConfig({ ...newModelConfig, model_name: e.target.value })}
                      placeholder="如：智能分割, LongCat超分"
                    />
                  </div>
                  <div>
                    <Label>消耗积分 *</Label>
                    <Input
                      type="number"
                      value={newModelConfig.credits || 0}
                      onChange={(e) => setNewModelConfig({ ...newModelConfig, credits: parseInt(e.target.value) || 0 })}
                      placeholder="每次使用消耗的积分"
                    />
                  </div>
                  <div>
                    <Label>描述</Label>
                    <Input
                      value={newModelConfig.description || ''}
                      onChange={(e) => setNewModelConfig({ ...newModelConfig, description: e.target.value })}
                      placeholder="功能描述（可选）"
                    />
                  </div>
                  {editingModelConfig && (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={newModelConfig.is_active ?? true}
                        onChange={(e) => setNewModelConfig({ ...newModelConfig, is_active: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <Label>启用</Label>
                    </div>
                  )}
                  <div className="flex gap-2 pt-4">
                    <Button onClick={saveModelConfig} className="flex-1">
                      {editingModelConfig ? '保存修改' : '添加配置'}
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setShowModelConfigDialog(false);
                        setEditingModelConfig(null);
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* 兑换码管理 */}
          <TabsContent value="redeem-keys">
            <Card className={`border ${adminDarkMode ? 'bg-gray-900/50 border-gray-800' : 'border-gray-200'}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>兑换码管理</CardTitle>
                  <Dialog open={showGenerateKeyDialog} onOpenChange={setShowGenerateKeyDialog}>
                    <DialogTrigger asChild>
                      <Button className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        生成兑换码
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>生成兑换码</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        {/* 积分套餐选择 */}
                        <div>
                          <Label>积分套餐（一键生成）</Label>
                          <Select
                            value=""
                            onValueChange={(value) => {
                              if (value) {
                                const pkg = packages.find(p => p.id === parseInt(value));
                                if (pkg) {
                                  setNewKeyCredits(pkg.credits);
                                }
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="选择积分套餐" />
                            </SelectTrigger>
                            <SelectContent>
                              {packages.filter(p => p.is_active).map((pkg) => (
                                <SelectItem key={pkg.id} value={pkg.id.toString()}>
                                  {pkg.name} - {formatCredits(pkg.credits)}积分 / ¥{formatPrice(pkg.price)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="keyCredits">积分数量</Label>
                            <Input
                              id="keyCredits"
                              type="number"
                              value={newKeyCredits}
                              onChange={(e) => setNewKeyCredits(parseInt(e.target.value) || 0)}
                              placeholder="每个兑换码的积分数量"
                            />
                          </div>
                          <div>
                            <Label htmlFor="keyCount">生成数量</Label>
                            <Input
                              id="keyCount"
                              type="number"
                              min={1}
                              max={100}
                              value={newKeyCount}
                              onChange={(e) => setNewKeyCount(parseInt(e.target.value) || 1)}
                              placeholder="生成数量 (1-100)"
                            />
                          </div>
                        </div>
                        
                        {generatedKeys.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label>生成的兑换码</Label>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => {
                                  const allKeys = generatedKeys.map(k => `${k.key_code} (${k.credits}积分)`).join('\n');
                                  navigator.clipboard.writeText(allKeys);
                                  toast.success('已复制所有兑换码');
                                }}
                              >
                                复制全部
                              </Button>
                            </div>
                            <div className="max-h-60 overflow-y-auto border rounded-lg p-2 space-y-1">
                              {generatedKeys.map((key) => (
                                <div 
                                  key={key.id} 
                                  className="flex items-center justify-between p-2 bg-muted rounded text-sm"
                                >
                                  <span className="font-mono">{key.key_code}</span>
                                  <span className="text-muted-foreground">{key.credits} 积分</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        <div className="flex gap-2">
                          <Button 
                            onClick={generateRedeemKeys}
                            className="flex-1"
                            disabled={newKeyCredits <= 0 || newKeyCount < 1 || newKeyCount > 1000}
                          >
                            生成 {newKeyCount} 个兑换码
                          </Button>
                          <Button 
                            variant="outline"
                            onClick={() => {
                              setShowGenerateKeyDialog(false);
                              setGeneratedKeys([]);
                              setNewKeyCredits(100);
                              setNewKeyCount(10);
                            }}
                          >
                            关闭
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                  
                  {/* 限量渠道兑换码 */}
                  <Dialog open={showGenerateLimitedKeyDialog} onOpenChange={setShowGenerateLimitedKeyDialog}>
                    <DialogTrigger asChild>
                      <Button 
                        variant="outline"
                        className="flex items-center gap-2 border-amber-500 text-amber-600 hover:bg-amber-50"
                      >
                        <Gift className="h-4 w-4" />
                        限量渠道
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>生成限量渠道兑换码</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 mb-4">
                        <p className="text-sm text-amber-800 dark:text-amber-200">
                          <strong>限量渠道说明：</strong>
                        </p>
                        <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1 list-disc list-inside">
                          <li>每个用户仅能兑换一次</li>
                          <li>适用于限时活动、专属福利等场景</li>
                          <li>建议设置较大的积分数量以吸引用户</li>
                        </ul>
                      </div>
                      <div className="space-y-4">
                        {/* 积分套餐选择 */}
                        <div>
                          <Label>积分套餐（一键生成）</Label>
                          <Select
                            value=""
                            onValueChange={(value) => {
                              if (value) {
                                const pkg = packages.find(p => p.id === parseInt(value));
                                if (pkg) {
                                  setNewKeyCredits(pkg.credits);
                                }
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="选择积分套餐" />
                            </SelectTrigger>
                            <SelectContent>
                              {packages.filter(p => p.is_active).map((pkg) => (
                                <SelectItem key={pkg.id} value={pkg.id.toString()}>
                                  {pkg.name} - {formatCredits(pkg.credits)}积分 / ¥{formatPrice(pkg.price)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="limitedKeyCredits">积分数量</Label>
                            <Input
                              id="limitedKeyCredits"
                              type="number"
                              value={newKeyCredits}
                              onChange={(e) => setNewKeyCredits(parseInt(e.target.value) || 0)}
                              placeholder="每个兑换码的积分数量"
                            />
                          </div>
                          <div>
                            <Label htmlFor="limitedKeyCount">生成数量</Label>
                            <Input
                              id="limitedKeyCount"
                              type="number"
                              min={1}
                              max={1000}
                              value={newKeyCount}
                              onChange={(e) => setNewKeyCount(parseInt(e.target.value) || 1)}
                              placeholder="生成数量 (1-1000)"
                            />
                          </div>
                        </div>
                        
                        {generatedKeys.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label>生成的兑换码</Label>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => {
                                  const allKeys = generatedKeys.map(k => `${k.key_code} (${k.credits}积分)`).join('\n');
                                  navigator.clipboard.writeText(allKeys);
                                  toast.success('已复制所有兑换码');
                                }}
                              >
                                复制全部
                              </Button>
                            </div>
                            <div className="max-h-60 overflow-y-auto border rounded-lg p-2 space-y-1">
                              {generatedKeys.map((key) => (
                                <div 
                                  key={key.id} 
                                  className="flex items-center justify-between p-2 bg-muted rounded text-sm"
                                >
                                  <span className="font-mono">{key.key_code}</span>
                                  <span className="text-muted-foreground">{key.credits} 积分</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        <div className="flex gap-2">
                          <Button 
                            onClick={generateLimitedRedeemKeys}
                            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
                            disabled={newKeyCredits <= 0 || newKeyCount < 1 || newKeyCount > 1000}
                          >
                            生成 {newKeyCount} 个限量兑换码
                          </Button>
                          <Button 
                            variant="outline"
                            onClick={() => {
                              setShowGenerateLimitedKeyDialog(false);
                              setGeneratedKeys([]);
                              setNewKeyCredits(100);
                              setNewKeyCount(10);
                            }}
                          >
                            关闭
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {/* 筛选按钮 */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <div className="flex gap-1 mr-4">
                    <span className="text-sm text-muted-foreground py-1">渠道:</span>
                    <Button 
                      variant={redeemChannelFilter === 'all' ? 'default' : 'outline'} 
                      size="sm"
                      onClick={() => { setRedeemChannelFilter('all'); }}
                    >
                      全部
                    </Button>
                    <Button 
                      variant={redeemChannelFilter === 'normal' ? 'default' : 'outline'} 
                      size="sm"
                      onClick={() => { setRedeemChannelFilter('normal'); }}
                    >
                      普通
                    </Button>
                    <Button 
                      variant={redeemChannelFilter === 'limited' ? 'default' : 'outline'} 
                      size="sm"
                      className={redeemChannelFilter === 'limited' ? 'bg-amber-500 hover:bg-amber-600' : 'border-amber-500 text-amber-600'}
                      onClick={() => { setRedeemChannelFilter('limited'); }}
                    >
                      限量
                    </Button>
                  </div>
                  <div className="flex gap-1">
                    <span className="text-sm text-muted-foreground py-1">状态:</span>
                    <Button 
                      variant={redeemStatusFilter === 'unused' ? 'default' : 'outline'} 
                      size="sm"
                      onClick={() => { setRedeemStatusFilter('unused'); }}
                    >
                      未使用
                    </Button>
                    <Button 
                      variant={redeemStatusFilter === 'used' ? 'default' : 'outline'} 
                      size="sm"
                      onClick={() => { setRedeemStatusFilter('used'); }}
                    >
                      已使用
                    </Button>
                  </div>
                </div>
                
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>渠道</TableHead>
                      <TableHead>兑换码</TableHead>
                      <TableHead>积分</TableHead>
                      <TableHead>价格</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>使用者</TableHead>
                      <TableHead>创建时间</TableHead>
                      <TableHead>使用时间</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {redeemKeys.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                          暂无兑换码
                        </TableCell>
                      </TableRow>
                    ) : (
                      redeemKeys.map((key) => (
                        <TableRow key={key.id} className={key.status === 'used' ? 'bg-muted/50' : ''}>
                          <TableCell>
                            {key.channel === 'limited' ? (
                              <Badge className="bg-amber-500 hover:bg-amber-600 text-white">
                                限量
                              </Badge>
                            ) : (
                              <Badge variant="outline">
                                普通
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <code className="font-mono text-sm bg-muted px-2 py-1 rounded">
                                {key.key_code}
                              </code>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => copyKeyCode(key.key_code, key.id)}
                              >
                                {copiedKeyId === key.id ? (
                                  <Check className="h-3 w-3 text-green-500" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                              <Coins className="h-3 w-3" />
                              {key.credits}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {/* 价格栏目 - 暂时显示"-" */}
                            -
                          </TableCell>
                          <TableCell>
                            <Badge variant={key.status === 'unused' ? 'default' : 'secondary'}>
                              {key.status === 'unused' ? '未使用' : '已使用'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {key.used_by ? (
                              <span className="text-sm">
                                {key.users?.nickname || `用户${key.used_by.slice(0, 8)}`}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatDate(key.created_at)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {key.used_at ? formatDate(key.used_at) : '-'}
                          </TableCell>
                          <TableCell>
                            {key.status === 'unused' && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => deleteRedeemKey(key.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* API配置中心 */}
          <TabsContent value="api-keys">
            <Card className={`border ${adminDarkMode ? 'bg-gray-900/50 border-gray-800' : 'border-gray-200'}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>
                      {selectedConfigId ? (
                        <div className="flex items-center gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => setSelectedConfigId(null)}
                          >
                            ← 返回
                          </Button>
                          <span>{apiConfigs.find(c => c.id === selectedConfigId)?.name} - 模型配置</span>
                        </div>
                      ) : (
                        'API 配置中心'
                      )}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {selectedConfigId 
                        ? '管理该接口下的模型，配置参数（分辨率、宽高比等）。修改后前端会实时同步。'
                        : '配置 API 接口和模型。点击接口进入模型配置页面。'}
                    </p>
                  </div>
                  {!selectedConfigId && (
                    <Button 
                      size="sm"
                      onClick={() => {
                        setEditingConfig({ type: 'config', data: { name: '', service_type: 'image_generation', api_endpoint: '', request_method: 'POST', request_headers: {}, request_body_template: {}, api_key: '', is_active: true } });
                        setShowConfigDialog(true);
                      }}
                    >
                      + 添加 API 接口
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {/* API 接口列表 */}
                {!selectedConfigId && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>接口名称</TableHead>
                        <TableHead>服务类型</TableHead>
                        <TableHead>API 地址</TableHead>
                        <TableHead>API Key</TableHead>
                        <TableHead>模型数量</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {apiConfigs.map((config) => {
                        const modelCount = apiModels.filter(m => m.config_id === config.id).length;
                        return (
                          <TableRow 
                            key={config.id} 
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => setSelectedConfigId(config.id)}
                          >
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                {config.name}
                                <span className="text-xs text-muted-foreground">→</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">
                                {config.service_type === 'image_generation' ? '图片生成' : 
                                 config.service_type === 'video_generation' ? '视频生成' :
                                 config.service_type === 'smart_split' ? '智能分割' : config.service_type}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-sm max-w-[300px] truncate">
                              {config.api_endpoint}
                            </TableCell>
                            <TableCell>
                              {config.api_key ? (
                                <code className="bg-muted px-2 py-1 rounded text-sm">••••••••</code>
                              ) : (
                                <span className="text-muted-foreground">未配置</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{modelCount} 个模型</Badge>
                            </TableCell>
                            <TableCell onClick={e => e.stopPropagation()}>
                              <div className="flex gap-2">
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingConfig({ type: 'config', data: config });
                                    setShowConfigDialog(true);
                                  }}
                                >
                                  编辑
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="destructive"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const modelCount = apiModels.filter(m => m.config_id === config.id).length;
                                    if (modelCount > 0) {
                                      toast.error(`该接口下有 ${modelCount} 个模型，请先删除模型再删除接口`);
                                      return;
                                    }
                                    if (confirm(`确定删除接口 "${config.name}" 吗？`)) {
                                      await fetch(`/api/linjiaqi/api-config?table=api_configs&id=${config.id}`, { method: 'DELETE', credentials: 'include' });
                                      fetchApiConfig();
                                    }
                                  }}
                                >
                                  删除
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}

                {/* 模型配置列表（属于选中的接口） */}
                {selectedConfigId && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <p className="text-sm text-muted-foreground">
                        管理 "{apiConfigs.find(c => c.id === selectedConfigId)?.name}" 的模型配置
                      </p>
                      <Button 
                        size="sm"
                        onClick={() => {
                          setEditingConfig({ 
                            type: 'model', 
                            data: { 
                              config_id: selectedConfigId,
                              model_id: '', 
                              model_name: '', 
                              description: '',
                              parameters: { resolutions: [], aspectRatios: [] },
                              credits_base: 10,
                              is_active: true,
                              sort_order: 0
                            },
                            isNew: true
                          });
                          setShowConfigDialog(true);
                        }}
                      >
                        + 添加模型
                      </Button>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>状态</TableHead>
                          <TableHead>模型 ID</TableHead>
                          <TableHead>模型名称</TableHead>
                          <TableHead>描述</TableHead>
                          <TableHead>分辨率</TableHead>
                          <TableHead>积分消耗</TableHead>
                          <TableHead>操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {apiModels
                          .filter(model => model.config_id === selectedConfigId)
                          .map((model) => {
                            // 通过 inferParameters 函数生成参数，传入数据库中的 parameters
                            const { type } = inferModelType(model.model_id);
                            const inferredParams = inferParameters(model.credits_base, type, model.parameters, model.model_id);
                            
                            // 计算积分范围
                            const creditsList = inferredParams?.resolutions?.map((r: any) => r.credits) || [];
                            const minCredits = Math.min(...creditsList);
                            const maxCredits = Math.max(...creditsList);
                            const creditsDisplay = creditsList.length > 0 
                              ? (minCredits === maxCredits ? `${minCredits}` : `${minCredits}~${maxCredits}`)
                              : '-';
                            
                            return (
                              <TableRow key={model.id}>
                                <TableCell>
                                  <Badge variant={model.is_active ? 'default' : 'secondary'}>
                                    {model.is_active ? '在线' : '离线'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono">{model.model_id}</TableCell>
                                <TableCell className="font-medium">{model.model_name}</TableCell>
                                <TableCell className="text-muted-foreground text-sm max-w-[150px] truncate">{model.description || '-'}</TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {inferredParams?.resolutions?.slice(0, 3).map((r: any, i: number) => (
                                      <Badge key={i} variant="secondary" className="text-xs">{r.label}</Badge>
                                    ))}
                                    {inferredParams?.resolutions?.length > 3 && (
                                      <span className="text-xs text-muted-foreground">+{inferredParams.resolutions.length - 3}</span>
                                    )}
                                    {(!inferredParams?.resolutions || inferredParams.resolutions.length === 0) && (
                                      <span className="text-muted-foreground text-xs">无</span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <span className="font-mono text-sm">{creditsDisplay}</span>
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1">
                                    <Button 
                                      size="sm" 
                                      variant="outline"
                                      onClick={() => {
                                        setEditingConfig({ type: 'model', data: model });
                                        setShowConfigDialog(true);
                                      }}
                                    >
                                      编辑
                                    </Button>
                                    <Button 
                                      size="sm" 
                                      variant="destructive"
                                      onClick={async () => {
                                        if (confirm(`确定删除模型 "${model.model_name}" 吗？`)) {
                                          await fetch(`/api/linjiaqi/api-config?table=api_models&id=${model.id}`, { method: 'DELETE', credentials: 'include' });
                                          fetchApiConfig();
                                        }
                                      }}
                                    >
                                      删除
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 画布配置 */}
          <TabsContent value="canvas-config">
            <Card className={`border ${adminDarkMode ? 'bg-gray-900/50 border-gray-800' : 'border-gray-200'}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>画布欢迎语与组件配置</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">配置画布页面显示的欢迎语和工具组件</p>
                  </div>
                  <Dialog open={showCanvasConfigDialog} onOpenChange={setShowCanvasConfigDialog}>
                    <DialogTrigger asChild>
                      <Button 
                        className="flex items-center gap-2"
                        onClick={() => {
                          setEditingCanvasConfig(null);
                          setNewCanvasConfig({
                            config_key: '',
                            config_type: 'welcome_message',
                            title: '',
                            content: '',
                            is_enabled: true,
                            sort_order: canvasConfigs.length,
                          });
                        }}
                      >
                        <Plus className="h-4 w-4" />
                        添加配置
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle>
                          {editingCanvasConfig ? '编辑配置' : '添加新配置'}
                        </DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="configType">配置类型</Label>
                          <select
                            id="configType"
                            className={`w-full mt-1 px-3 py-2 rounded-lg border ${adminDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-200'}`}
                            value={newCanvasConfig.config_type || 'welcome_message'}
                            onChange={(e) => setNewCanvasConfig({ ...newCanvasConfig, config_type: e.target.value })}
                          >
                            <option value="welcome_message">欢迎语</option>
                            <option value="tool_component">工具组件</option>
                            <option value="feature_toggle">功能开关</option>
                          </select>
                        </div>
                        <div>
                          <Label htmlFor="configKey">配置键（唯一标识）</Label>
                          <Input
                            id="configKey"
                            value={newCanvasConfig.config_key || ''}
                            onChange={(e) => setNewCanvasConfig({ ...newCanvasConfig, config_key: e.target.value })}
                            placeholder="如: welcome_message, tool_1"
                          />
                        </div>
                        <div>
                          <Label htmlFor="configTitle">显示标题</Label>
                          <Input
                            id="configTitle"
                            value={newCanvasConfig.title || ''}
                            onChange={(e) => setNewCanvasConfig({ ...newCanvasConfig, title: e.target.value })}
                            placeholder="如: 欢迎语"
                          />
                        </div>
                        <div>
                          <Label htmlFor="configContent">内容</Label>
                          <textarea
                            id="configContent"
                            className={`w-full mt-1 px-3 py-2 rounded-lg border min-h-[100px] ${adminDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-200'}`}
                            value={newCanvasConfig.content || ''}
                            onChange={(e) => setNewCanvasConfig({ ...newCanvasConfig, content: e.target.value })}
                            placeholder={newCanvasConfig.config_type === 'welcome_message' ? '欢迎语内容...' : '组件配置内容或功能说明...'}
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <Label htmlFor="sortOrder">排序</Label>
                            <Input
                              id="sortOrder"
                              type="number"
                              value={newCanvasConfig.sort_order ?? 0}
                              onChange={(e) => setNewCanvasConfig({ ...newCanvasConfig, sort_order: parseInt(e.target.value) || 0 })}
                            />
                          </div>
                          <div className="flex items-center gap-2 pt-6">
                            <input
                              type="checkbox"
                              id="isEnabled"
                              checked={newCanvasConfig.is_enabled ?? true}
                              onChange={(e) => setNewCanvasConfig({ ...newCanvasConfig, is_enabled: e.target.checked })}
                              className="w-4 h-4"
                            />
                            <Label htmlFor="isEnabled">启用</Label>
                          </div>
                        </div>
                        <Button 
                          onClick={async () => {
                            const config = {
                              ...newCanvasConfig,
                              id: editingCanvasConfig?.id,
                            };
                            const success = await saveCanvasConfig(config);
                            if (success) {
                              // 成功
                            }
                          }}
                          className="w-full"
                        >
                          保存
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {canvasConfigs.length > 0 ? (
                  <div className="space-y-4">
                    {canvasConfigs.map((config) => (
                      <div 
                        key={config.id}
                        className={`p-4 rounded-xl border ${adminDarkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant={config.config_type === 'welcome_message' ? 'default' : config.config_type === 'tool_component' ? 'secondary' : 'outline'}>
                                {config.config_type === 'welcome_message' ? '欢迎语' : config.config_type === 'tool_component' ? '工具组件' : '功能开关'}
                              </Badge>
                              <Badge variant={config.is_enabled ? 'default' : 'destructive'}>
                                {config.is_enabled ? '已启用' : '已禁用'}
                              </Badge>
                            </div>
                            <h4 className="font-medium mb-1">{config.title || config.config_key}</h4>
                            {config.content && (
                              <p className={`text-sm ${adminDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                {config.content.length > 100 ? config.content.substring(0, 100) + '...' : config.content}
                              </p>
                            )}
                            <p className={`text-xs mt-2 ${adminDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                              键: {config.config_key} | 排序: {config.sort_order}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingCanvasConfig(config);
                                setNewCanvasConfig({
                                  config_key: config.config_key,
                                  config_type: config.config_type,
                                  title: config.title || '',
                                  content: config.content || '',
                                  is_enabled: config.is_enabled,
                                  sort_order: config.sort_order,
                                });
                                setShowCanvasConfigDialog(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => deleteCanvasConfig(config.id)}
                            >
                              <Trash className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      暂无配置项。点击上方按钮添加新的欢迎语或工具组件配置。
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* #271 积分流水 */}
          <TabsContent value="credit-logs">
            <Card className={`border ${adminDarkMode ? 'bg-gray-900/50 border-gray-800' : 'border-gray-200'}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>积分流水</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">所有积分变动记录（双式记账法）</p>
                  </div>
                  <Button variant="outline" onClick={() => fetchCreditLogs(creditLogsPagination.page)}>
                    <RefreshCw className="h-4 w-4 mr-1" />
                    刷新
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* 筛选条件 */}
                <div className="flex flex-wrap gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">用户ID:</Label>
                    <Input
                      className="w-40"
                      placeholder="输入用户ID"
                      value={creditLogsFilter.userId}
                      onChange={(e) => setCreditLogsFilter({ ...creditLogsFilter, userId: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">类型:</Label>
                    <select
                      className={`px-3 py-2 rounded-lg border ${adminDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
                      value={creditLogsFilter.type}
                      onChange={(e) => setCreditLogsFilter({ ...creditLogsFilter, type: e.target.value })}
                    >
                      <option value="all">全部</option>
                      <option value="deduct">生成扣费(旧)</option>
                      <option value="generate">生成扣费</option>
                      <option value="refund">积分返还</option>
                      <option value="recharge">卡密充值</option>
                      <option value="admin_adjust">后台调整</option>
                      <option value="exchange">积分兑换</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">开始日期:</Label>
                    <Input
                      type="date"
                      className="w-36"
                      value={creditLogsFilter.startDate}
                      onChange={(e) => setCreditLogsFilter({ ...creditLogsFilter, startDate: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">结束日期:</Label>
                    <Input
                      type="date"
                      className="w-36"
                      value={creditLogsFilter.endDate}
                      onChange={(e) => setCreditLogsFilter({ ...creditLogsFilter, endDate: e.target.value })}
                    />
                  </div>
                  <Button onClick={() => fetchCreditLogs(1)}>
                    <Search className="h-4 w-4 mr-1" />
                    查询
                  </Button>
                </div>

                {/* 流水表格 */}
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>用户</TableHead>
                        <TableHead>变动金额</TableHead>
                        <TableHead>变动后余额</TableHead>
                        <TableHead>类型</TableHead>
                        <TableHead>关联ID</TableHead>
                        <TableHead>描述</TableHead>
                        <TableHead>时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {creditLogs.length > 0 ? creditLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>{log.id}</TableCell>
                          <TableCell>
                            {log.users ? (
                              <div className="flex items-center gap-2">
                                <UserIcon className="h-4 w-4" />
                                <span>{log.users.nickname}</span>
                                <span className="text-gray-400 text-xs">({log.user_id?.slice(0, 8)}...)</span>
                              </div>
                            ) : (
                              <span className="text-gray-500">{log.user_id?.slice(0, 8)}...</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className={`font-semibold ${log.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {log.amount > 0 ? '+' : ''}{log.amount}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{log.balance_after}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={
                              log.type === 'generate' || log.type === 'deduct' ? 'destructive' :
                              log.type === 'refund' ? 'default' :
                              log.type === 'recharge' ? 'default' :
                              log.type === 'admin_adjust' ? 'secondary' :
                              'outline'
                            }>
                              {log.type === 'generate' || log.type === 'deduct' ? '生成扣费' :
                               log.type === 'refund' ? '积分返还' :
                               log.type === 'recharge' ? '卡密充值' :
                               log.type === 'admin_adjust' ? '后台调整' :
                               log.type === 'exchange' ? '积分兑换' :
                               log.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[150px] truncate" title={log.reference_id}>
                            {log.reference_id || '-'}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate" title={log.description}>
                            {log.description || '-'}
                          </TableCell>
                          <TableCell className="text-sm text-gray-500">
                            {formatDate(log.created_at)}
                          </TableCell>
                        </TableRow>
                      )) : (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                            暂无积分流水记录
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* 分页 */}
                {creditLogsPagination.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-sm text-gray-500">
                      共 {creditLogsPagination.total} 条记录，第 {creditLogsPagination.page} / {creditLogsPagination.totalPages} 页
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={creditLogsPagination.page <= 1}
                        onClick={() => fetchCreditLogs(creditLogsPagination.page - 1)}
                      >
                        上一页
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={creditLogsPagination.page >= creditLogsPagination.totalPages}
                        onClick={() => fetchCreditLogs(creditLogsPagination.page + 1)}
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* API 配置编辑对话框 */}
        <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingConfig?.type === 'config' && (editingConfig.data.id ? '编辑 API 接口' : '添加 API 接口')}
                {editingConfig?.type === 'model' && (editingConfig.isNew ? '添加模型' : '编辑模型参数')}
              </DialogTitle>
            </DialogHeader>
            {editingConfig && (
              <div className="space-y-4">
                {/* API 接口编辑 */}
                {editingConfig.type === 'config' && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>接口名称</Label>
                        <Input 
                          value={editingConfig.data.name || ''}
                          onChange={(e) => setEditingConfig({
                            ...editingConfig,
                            data: { ...editingConfig.data, name: e.target.value }
                          })}
                          placeholder="例如: 图片生成 - GRS AI"
                        />
                      </div>
                      <div>
                        <Label>服务类型</Label>
                        <select
                          className="w-full p-2 border rounded-md"
                          value={editingConfig.data.service_type || 'image_generation'}
                          onChange={(e) => setEditingConfig({
                            ...editingConfig,
                            data: { ...editingConfig.data, service_type: e.target.value }
                          })}
                        >
                          <option value="image_generation">图片生成</option>
                          <option value="video_generation">视频生成</option>
                          <option value="smart_split">智能分割</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <Label>API 接口地址</Label>
                      <Input 
                        value={editingConfig.data.api_endpoint || ''}
                        onChange={(e) => setEditingConfig({
                          ...editingConfig,
                          data: { ...editingConfig.data, api_endpoint: e.target.value }
                        })}
                        placeholder="https://api.example.com/v1/generate"
                      />
                    </div>
                    <div>
                      <Label>请求方式</Label>
                      <select
                        className="w-full p-2 border rounded-md"
                        value={editingConfig.data.request_method || 'POST'}
                        onChange={(e) => setEditingConfig({
                          ...editingConfig,
                          data: { ...editingConfig.data, request_method: e.target.value }
                        })}
                      >
                        <option value="POST">POST</option>
                        <option value="GET">GET</option>
                        <option value="PUT">PUT</option>
                      </select>
                    </div>
                    <div>
                      <Label>请求头模板 (JSON)</Label>
                      <textarea
                        className="w-full h-24 p-2 border rounded-md font-mono text-sm"
                        value={JSON.stringify(editingConfig.data.request_headers || {}, null, 2)}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            setEditingConfig({
                              ...editingConfig,
                              data: { ...editingConfig.data, request_headers: parsed }
                            });
                          } catch {}
                        }}
                      />
                    </div>
                    <div>
                      <Label>请求体模板 (JSON)</Label>
                      <textarea
                        className="w-full h-32 p-2 border rounded-md font-mono text-sm"
                        value={JSON.stringify(editingConfig.data.request_body_template || {}, null, 2)}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            setEditingConfig({
                              ...editingConfig,
                              data: { ...editingConfig.data, request_body_template: parsed }
                            });
                          } catch {}
                        }}
                      />
                      <p className="text-xs text-muted-foreground mt-1">使用 ${'{变量名}'} 作为占位符，如: ${'{model}'}, ${'{prompt}'}</p>
                    </div>
                    <div>
                      <Label>API Key</Label>
                      <Input 
                        type="password"
                        value={editingConfig.data.api_key || ''}
                        onChange={(e) => setEditingConfig({
                          ...editingConfig,
                          data: { ...editingConfig.data, api_key: e.target.value }
                        })}
                        placeholder="sk-xxxxxxxx"
                      />
                    </div>
                  </>
                )}

                {/* 模型参数编辑 */}
                {editingConfig.type === 'model' && (
                  <>
                    {/* 新增模型时可编辑基本信息 */}
                    {editingConfig.isNew && (
                      <div className="space-y-4 p-4 bg-muted/50 rounded-lg mb-4">
                        <p className="text-sm font-medium">基本信息</p>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>模型 ID <span className="text-red-500">*</span></Label>
                            <Input 
                              value={editingConfig.data.model_id || ''}
                              onChange={(e) => {
                                const newModelId = e.target.value;
                                // 当模型 ID 变化时，自动填充正确的分辨率
                                const { type } = inferModelType(newModelId);
                                const defaultCredits = 10; // 默认积分
                                const inferredParams = inferParameters(defaultCredits, type, null, newModelId);
                                
                                setEditingConfig({
                                  ...editingConfig,
                                  data: { 
                                    ...editingConfig.data, 
                                    model_id: newModelId,
                                    // 自动填充分辨率，保留用户已设置的 aspectRatios
                                    parameters: {
                                      ...editingConfig.data.parameters,
                                      resolutions: inferredParams.resolutions || [],
                                    }
                                  }
                                });
                              }}
                              placeholder="例如: nano-banana-new"
                            />
                            <p className="text-xs text-muted-foreground mt-1">唯一标识，建议使用英文和小写</p>
                          </div>
                          <div>
                            <Label>模型名称 <span className="text-red-500">*</span></Label>
                            <Input 
                              value={editingConfig.data.model_name || ''}
                              onChange={(e) => setEditingConfig({
                                ...editingConfig,
                                data: { ...editingConfig.data, model_name: e.target.value }
                              })}
                              placeholder="例如: Nano Banana New"
                            />
                          </div>
                        </div>
                        <div>
                          <Label>描述</Label>
                          <Input 
                            value={editingConfig.data.description || ''}
                            onChange={(e) => setEditingConfig({
                              ...editingConfig,
                              data: { ...editingConfig.data, description: e.target.value }
                            })}
                            placeholder="例如: 新版本，提升画质"
                          />
                        </div>
                      </div>
                    )}
                    
                    {/* API 端点配置（通用架构：支持每个模型独立的 URL） */}
                    <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Label className="text-sm font-medium">API 端点（可选）</Label>
                        <span className="text-xs text-muted-foreground">— 不同模型可用不同的接口地址</span>
                      </div>
                      <Input 
                        value={editingConfig.data.api_endpoint || ''}
                        onChange={(e) => setEditingConfig({
                          ...editingConfig,
                          data: { ...editingConfig.data, api_endpoint: e.target.value || null }
                        })}
                        placeholder="留空则使用接口的默认地址"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        例：Gemini 模型需要填写完整路径 <code className="bg-muted px-1 rounded">/v1beta/models/gemini-xxx:generateContent</code>
                      </p>
                    </div>
                    
                    {/* 编辑已有模型时显示只读信息 */}
                    {!editingConfig.isNew && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>模型 ID</Label>
                          <Input value={editingConfig.data.model_id} readOnly className="bg-muted" />
                        </div>
                        <div>
                          <Label>模型名称</Label>
                          <Input value={editingConfig.data.model_name} readOnly className="bg-muted" />
                        </div>
                      </div>
                    )}
                    
                    <div>
                      <Label>分辨率选项 (JSON)</Label>
                      <textarea
                        className="w-full h-32 p-2 border rounded-md font-mono text-sm"
                        value={JSON.stringify(editingConfig.data.parameters?.resolutions || [], null, 2)}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            setEditingConfig({
                              ...editingConfig,
                              data: { 
                                ...editingConfig.data, 
                                parameters: { ...editingConfig.data.parameters, resolutions: parsed }
                              }
                            });
                          } catch {}
                        }}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        格式: [{"{ \"value\": \"1K\", \"label\": \"1K\", \"credits\": 10 }"}, ...] - credits 为该分辨率消耗的积分
                      </p>
                    </div>
                    <div>
                      <Label>宽高比选项 (JSON)</Label>
                      <textarea
                        className="w-full h-32 p-2 border rounded-md font-mono text-sm"
                        value={JSON.stringify(editingConfig.data.parameters?.aspectRatios || [], null, 2)}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            setEditingConfig({
                              ...editingConfig,
                              data: { 
                                ...editingConfig.data, 
                                parameters: { ...editingConfig.data.parameters, aspectRatios: parsed }
                              }
                            });
                          } catch {}
                        }}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        格式: [{"{ \"value\": \"1:1\", \"label\": \"1:1 方形\" }"}, ...]
                      </p>
                    </div>
                  </>
                )}

                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={() => setShowConfigDialog(false)}>
                    取消
                  </Button>
                  <Button onClick={async () => {
                    let table = '';
                    let data = {};
                    
                    if (editingConfig.type === 'config') {
                      table = 'api_configs';
                      data = {
                        name: editingConfig.data.name,
                        service_type: editingConfig.data.service_type,
                        api_endpoint: editingConfig.data.api_endpoint,
                        request_method: editingConfig.data.request_method,
                        request_headers: editingConfig.data.request_headers,
                        request_body_template: editingConfig.data.request_body_template,
                        api_key: editingConfig.data.api_key,
                        is_active: true,
                      };
                    } else if (editingConfig.type === 'model') {
                      table = 'api_models';
                      // 新增模型时保存完整信息
                      if (editingConfig.isNew) {
                        // 验证必填字段
                        if (!editingConfig.data.model_id || !editingConfig.data.model_name) {
                          toast.error('请填写模型 ID 和模型名称');
                          return;
                        }
                        data = {
                          config_id: editingConfig.data.config_id,
                          model_id: editingConfig.data.model_id,
                          model_name: editingConfig.data.model_name,
                          description: editingConfig.data.description || '',
                          api_endpoint: editingConfig.data.api_endpoint || null,
                          parameters: editingConfig.data.parameters || { resolutions: [], aspectRatios: [] },
                          credits_base: 10,
                          is_active: true,
                          sort_order: 0,
                        };
                      } else {
                        // 编辑已有模型，更新参数和端点
                        data = {
                          api_endpoint: editingConfig.data.api_endpoint || null,
                          parameters: editingConfig.data.parameters,
                        };
                      }
                    }
                    
                    if (editingConfig.data.id) {
                      await updateApiConfig(table, editingConfig.data.id, data);
                    } else {
                      // #110 修复：添加 credentials: 'include' 确保请求携带 cookie
                      await fetch('/api/linjiaqi/api-config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ table, data }),
                      });
                      fetchApiConfig();
                    }
                    setShowConfigDialog(false);
                  }}>
                    保存
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* 用户详情对话框 */}
        <Dialog open={showUserDialog} onOpenChange={setShowUserDialog}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>用户详情</DialogTitle>
            </DialogHeader>
            {selectedUser && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-500">用户名</Label>
                    <p className="text-lg font-semibold">{selectedUser.nickname || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-gray-500">手机号</Label>
                    <p className="text-lg font-semibold">{selectedUser.phone}</p>
                  </div>
                  <div>
                    <Label className="text-gray-500">邮箱</Label>
                    <p className="text-lg font-semibold">{selectedUser.email || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-gray-500">剩余积分</Label>
                    <p className="text-lg font-semibold flex items-center gap-2">
                      <Coins className="h-5 w-5 text-yellow-500" />
                      {selectedUser.credits}
                    </p>
                  </div>
                  <div>
                    <Label className="text-gray-500">状态</Label>
                    <p className="text-lg font-semibold">
                      <Badge variant={selectedUser.is_active ? 'default' : 'destructive'}>
                        {selectedUser.is_active ? '正常' : '禁用'}
                      </Badge>
                    </p>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-gray-500">用户ID</Label>
                    <p className="text-sm font-mono">{selectedUser.id}</p>
                  </div>
                  <div>
                    <Label className="text-gray-500">创建时间</Label>
                    <p className="text-sm">{formatDate(selectedUser.created_at)}</p>
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-lg font-semibold mb-3">充值记录</h3>
                  {selectedUser.rechargeRecords && selectedUser.rechargeRecords.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>金额</TableHead>
                          <TableHead>获得积分</TableHead>
                          <TableHead>支付方式</TableHead>
                          <TableHead>时间</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedUser.rechargeRecords.map((record) => (
                          <TableRow key={record.id}>
                            <TableCell className="text-green-600">¥{(record.amount / 100).toFixed(2)}</TableCell>
                            <TableCell>+{record.points}</TableCell>
                            <TableCell>
                              {record.payment_method === 'alipay' ? '支付宝' : 
                               record.payment_method === 'wechat' ? '微信' : '银行卡'}
                            </TableCell>
                            <TableCell>{formatDate(record.created_at)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-gray-500">暂无充值记录</p>
                  )}
                </div>

                <Separator />

                <div>
                  <h3 className="text-lg font-semibold mb-3">兑换记录</h3>
                  {selectedUser.exchangeRecords && selectedUser.exchangeRecords.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>兑换物品</TableHead>
                          <TableHead>消耗积分</TableHead>
                          <TableHead>时间</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedUser.exchangeRecords.map((record) => (
                          <TableRow key={record.id}>
                            <TableCell>{record.item_name}</TableCell>
                            <TableCell className="text-red-600">-{record.points_used}</TableCell>
                            <TableCell>{formatDate(record.created_at)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-gray-500">暂无兑换记录</p>
                  )}
                </div>

                <Separator />

                <div>
                  <h3 className="text-lg font-semibold mb-3">积分使用记录</h3>
                  {selectedUser.pointUsageRecords && selectedUser.pointUsageRecords.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>模型</TableHead>
                          <TableHead>使用积分</TableHead>
                          <TableHead>描述</TableHead>
                          <TableHead>时间</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedUser.pointUsageRecords.map((record) => (
                          <TableRow key={record.id}>
                            <TableCell>{record.model_name}</TableCell>
                            <TableCell className="text-red-600">-{record.points_used}</TableCell>
                            <TableCell>{record.description || '-'}</TableCell>
                            <TableCell>{formatDate(record.created_at)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-gray-500">暂无使用记录</p>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* 积分调整对话框 */}
        <Dialog open={showDistributeDialog} onOpenChange={setShowDistributeDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>调整用户积分</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {users.find(u => u.id === distributeUserId)?.phone === '13824085362' ? (
                <>
                  <div>
                    <Label>当前负责人积分</Label>
                    <p className="text-lg font-semibold text-purple-600">{admin?.credits || 0}</p>
                  </div>
                  <div>
                    <Label htmlFor="distributeAmount">调整数量</Label>
                    <Input
                      id="distributeAmount"
                      type="number"
                      value={distributeAmount}
                      onChange={(e) => setDistributeAmount(parseInt(e.target.value) || 0)}
                      placeholder="输入积分数量"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      onClick={() => distributeCredits('add')}
                      className="flex-1"
                      disabled={distributeAmount <= 0}
                    >
                      增加 {distributeAmount}
                    </Button>
                    <Button 
                      variant="destructive"
                      onClick={() => distributeCredits('subtract')}
                      className="flex-1"
                      disabled={distributeAmount <= 0 || (admin?.credits || 0) < distributeAmount}
                    >
                      扣减 {distributeAmount}
                    </Button>
                  </div>
                  <Button 
                    variant="outline"
                    onClick={() => {
                      setShowDistributeDialog(false);
                      setDistributeAmount(0);
                      setDistributeUserId(null);
                    }}
                    className="w-full"
                  >
                    取消
                  </Button>
                </>
              ) : (
                <>
                  <div>
                    <Label>用户当前积分</Label>
                    <p className="text-2xl font-bold text-purple-600">
                      {users.find(u => u.id === distributeUserId)?.credits || 0}
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="distributeAmount">调整数量</Label>
                    <Input
                      id="distributeAmount"
                      type="number"
                      value={distributeAmount}
                      onChange={(e) => setDistributeAmount(parseInt(e.target.value) || 0)}
                      placeholder="输入积分数量"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      onClick={() => distributeCredits('add')}
                      className="flex-1"
                      disabled={distributeAmount <= 0}
                    >
                      增加 {distributeAmount}
                    </Button>
                    <Button 
                      variant="destructive"
                      onClick={() => distributeCredits('subtract')}
                      className="flex-1"
                      disabled={distributeAmount <= 0 || (users.find(u => u.id === distributeUserId)?.credits || 0) < distributeAmount}
                    >
                      扣减 {distributeAmount}
                    </Button>
                  </div>
                  <Button 
                    variant="outline"
                    onClick={() => {
                      setShowDistributeDialog(false);
                      setDistributeAmount(0);
                      setDistributeUserId(null);
                    }}
                    className="w-full"
                  >
                    取消
                  </Button>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* #111 新增：编辑剩余配额对话框 */}
        <Dialog open={showEditQuotaDialog} onOpenChange={(open) => {
          setShowEditQuotaDialog(open);
          if (open && admin) {
            setEditQuotaValue(admin.remainingQuota);
          }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>编辑剩余配额</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                用于查看是否有错误返还导致该值变为负数。初始值为 0。
              </div>
              <div>
                <Label htmlFor="editQuotaValue">剩余配额数值</Label>
                <Input
                  id="editQuotaValue"
                  type="number"
                  value={editQuotaValue}
                  onChange={(e) => setEditQuotaValue(parseInt(e.target.value) || 0)}
                  placeholder="输入剩余配额数值"
                />
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={() => updateRemainingQuota(editQuotaValue)}
                  className="flex-1"
                >
                  保存
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setShowEditQuotaDialog(false)}
                  className="flex-1"
                >
                  取消
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        
        {/* Toast 通知组件 */}
        <Toaster />
      </div>
    </div>
  );
}

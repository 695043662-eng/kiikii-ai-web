'use client';

import { useState, useEffect } from 'react';
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
  Save,
  X,
  GripVertical,
  Sun,
  Moon
} from 'lucide-react';

interface User {
  id: string;
  nickname: string;
  phone: string;
  credits: number;              // 普通积分
  supplyQuota?: number;         // 供应配额（仅管理员有）
  supplierCredits?: number;     // 供应商原始积分（仅管理员有，用于显示）
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
  totalQuota: number;         // 供应总配额（供应商积分÷100，不变动）
  remainingQuota: number;     // 剩余配额（总配额 - 所有用户积分总和）
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
  item_name: string;
  points_used: number;
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
  description: string | null;
  is_active: boolean;
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
  const [redeemKeys, setRedeemKeys] = useState<RedeemKey[]>([]);
  const [showGenerateKeyDialog, setShowGenerateKeyDialog] = useState(false);
  const [newKeyCredits, setNewKeyCredits] = useState(100);
  const [newKeyCount, setNewKeyCount] = useState(1);
  const [generatedKeys, setGeneratedKeys] = useState<RedeemKey[]>([]);
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchPhone, setSearchPhone] = useState('');
  const [searchNickname, setSearchNickname] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showUserDialog, setShowUserDialog] = useState(false);
  const [showAddUserDialog, setShowAddUserDialog] = useState(false);
  const [showAddCreditsDialog, setShowAddCreditsDialog] = useState(false);
  const [showDistributeDialog, setShowDistributeDialog] = useState(false);
  const [distributeUserId, setDistributeUserId] = useState<string | null>(null);
  const [distributeAmount, setDistributeAmount] = useState(0);
  const [activeTab, setActiveTab] = useState('users');

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
  const [newUser, setNewUser] = useState({ nickname: '', phone: '', credits: 0, password: '' });
  const [addCreditsAmount, setAddCreditsAmount] = useState(0);
  
  // 后台独立的日夜模式（不与前端互通）
  const [adminDarkMode, setAdminDarkMode] = useState(false);
  
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

  useEffect(() => {
    // 检查登录状态
    const checkLogin = async () => {
      try {
        // 先尝试从 API 获取用户信息（基于 cookie）
        const res = await fetch('/api/user/info');
        const data = await res.json();
        
        if (data.success && data.user) {
          setCurrentUser(data.user);
          fetchData();
        } else {
          // 如果 API 检查失败，尝试 localStorage
          const userStr = localStorage.getItem('user');
          if (!userStr) {
            router.push('/login?redirect=/linjiaqi');
            return;
          }
          try {
            const user = JSON.parse(userStr);
            setCurrentUser(user);
          } catch {
            router.push('/login?redirect=/linjiaqi');
            return;
          }
          fetchData();
        }
      } catch (error) {
        console.error('检查登录状态失败:', error);
        router.push('/login?redirect=/linjiaqi');
      }
    };
    
    checkLogin();
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('user');
    router.push('/login');
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      // 获取管理员信息
      const adminRes = await fetch('/api/admin/credits');
      const adminData = await adminRes.json();
      setAdmin(adminData.data || null);
      
      // 获取用户列表
      const usersRes = await fetch('/api/users');
      const usersData = await usersRes.json();
      setUsers(usersData.data || []);
      
      // 尝试获取其他数据
      const [rechargeRes, exchangeRes, pointsRes] = await Promise.all([
        fetch('/api/recharge'),
        fetch('/api/exchange'),
        fetch('/api/points'),
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
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  // 获取充值套餐列表
  const fetchPackages = async () => {
    try {
      const res = await fetch('/api/admin/packages');
      const data = await res.json();
      setPackages(data.data || []);
    } catch (error) {
      console.error('Error fetching packages:', error);
    }
  };

  // 获取模型积分配置列表
  const fetchModelCreditsConfigs = async () => {
    try {
      const res = await fetch('/api/admin/model-credits');
      const data = await res.json();
      setModelCreditsConfigs(data.data || []);
    } catch (error) {
      console.error('Error fetching model credits configs:', error);
    }
  };

  // 保存模型积分配置
  const saveModelConfig = async () => {
    if (!newModelConfig.model_key || !newModelConfig.model_name || newModelConfig.credits === undefined) {
      alert('请填写必填字段');
      return;
    }

    try {
      const url = '/api/admin/model-credits';
      const method = editingModelConfig ? 'PUT' : 'POST';
      const body = editingModelConfig 
        ? { id: editingModelConfig.id, ...newModelConfig }
        : newModelConfig;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
        fetchModelCreditsConfigs();
        alert(editingModelConfig ? '更新成功' : '添加成功');
      } else {
        alert(data.error || '操作失败');
      }
    } catch (error) {
      console.error('Error saving model config:', error);
      alert('操作失败');
    }
  };

  // 删除模型积分配置
  const deleteModelConfig = async (id: number) => {
    if (!confirm('确定要删除这个配置吗？')) return;

    try {
      const res = await fetch(`/api/admin/model-credits?id=${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (data.success) {
        fetchModelCreditsConfigs();
        alert('删除成功');
      } else {
        alert(data.error || '删除失败');
      }
    } catch (error) {
      console.error('Error deleting model config:', error);
      alert('删除失败');
    }
  };

  // 保存套餐
  const savePackage = async () => {
    if (!newPackage.name || !newPackage.price || !newPackage.credits) {
      alert('请填写必填字段');
      return;
    }

    try {
      const url = editingPackage ? `/api/admin/packages` : '/api/admin/packages';
      const method = editingPackage ? 'PUT' : 'POST';
      const body = editingPackage 
        ? { id: editingPackage.id, ...newPackage }
        : newPackage;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
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
        alert(editingPackage ? '更新成功' : '添加成功');
      } else {
        alert(data.error || '操作失败');
      }
    } catch (error) {
      console.error('Error saving package:', error);
      alert('操作失败');
    }
  };

  // 删除套餐
  const deletePackage = async (id: number) => {
    if (!confirm('确定要删除这个套餐吗？')) return;

    try {
      const res = await fetch(`/api/admin/packages?id=${id}`, { method: 'DELETE' });
      const data = await res.json();

      if (data.success) {
        fetchPackages();
        alert('删除成功');
      } else {
        alert(data.error || '删除失败');
      }
    } catch (error) {
      console.error('Error deleting package:', error);
      alert('删除失败');
    }
  };

  // 格式化价格（分转元）
  const formatPrice = (price: number) => {
    return (price / 100).toFixed(1);
  };

  // 格式化积分
  const formatCredits = (credits: number) => {
    if (credits >= 10000) {
      return `${(credits / 10000).toFixed(0)}万`;
    }
    return credits.toLocaleString();
  };

  // 获取兑换码列表
  const fetchRedeemKeys = async (status?: string) => {
    try {
      const url = status 
        ? `/api/admin/redeem-keys?status=${status}`
        : '/api/admin/redeem-keys';
      const res = await fetch(url);
      const data = await res.json();
      setRedeemKeys(data.data || []);
    } catch (error) {
      console.error('Error fetching redeem keys:', error);
    }
  };

  // 获取 API 配置（新版）
  const fetchApiConfig = async () => {
    try {
      const res = await fetch('/api/admin/api-config');
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
      const res = await fetch('/api/admin/api-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, id, data }),
      });
      const result = await res.json();
      if (result.success) {
        fetchApiConfig();
        alert('更新成功');
      } else {
        alert(result.error || '更新失败');
      }
    } catch (error) {
      console.error('Error updating API config:', error);
      alert('更新失败');
    }
  };

  // 切换模型启用状态
  const toggleModelActive = async (id: number, isActive: boolean) => {
    await updateApiConfig('api_models', id, { is_active: isActive });
  };

  // 生成兑换码
  const generateRedeemKeys = async () => {
    try {
      const res = await fetch('/api/admin/redeem-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credits: newKeyCredits,
          count: newKeyCount,
        }),
      });
      const data = await res.json();
      
      if (data.success) {
        setGeneratedKeys(data.data || []);
        fetchRedeemKeys();
        alert(data.message);
      } else {
        alert(data.error || '生成失败');
      }
    } catch (error) {
      console.error('Error generating redeem keys:', error);
      alert('生成失败');
    }
  };

  // 删除兑换码
  const deleteRedeemKey = async (id: number) => {
    if (!confirm('确定要删除这个兑换码吗？')) return;
    
    try {
      const res = await fetch('/api/admin/redeem-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      
      if (data.success) {
        fetchRedeemKeys();
        alert('删除成功');
      } else {
        alert(data.error || '删除失败');
      }
    } catch (error) {
      console.error('Error deleting redeem key:', error);
      alert('删除失败');
    }
  };

  // 复制兑换码
  const copyKeyCode = async (keyCode: string, keyId: number) => {
    try {
      await navigator.clipboard.writeText(keyCode);
      setCopiedKeyId(keyId);
      setTimeout(() => setCopiedKeyId(null), 2000);
    } catch {
      alert('复制失败');
    }
  };

  const searchUsers = async () => {
    try {
      const params = new URLSearchParams();
      if (searchPhone) params.append('phone', searchPhone);
      if (searchNickname) params.append('nickname', searchNickname);
      
      const res = await fetch(`/api/users?${params}`);
      const data = await res.json();
      setUsers(data.data || []);
    } catch (error) {
      console.error('Error searching users:', error);
    }
  };

  const fetchUserDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/users/${id}`);
      const data = await res.json();
      setSelectedUser(data.data);
      setShowUserDialog(true);
    } catch (error) {
      console.error('Error fetching user detail:', error);
    }
  };

  const createUser = async () => {
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      if (data.data) {
        setNewUser({ nickname: '', phone: '', credits: 0, password: '' });
        setShowAddUserDialog(false);
        fetchData();
      } else {
        alert(data.error || '创建失败');
      }
    } catch (error) {
      console.error('Error creating user:', error);
    }
  };

  const deleteUser = async (id: string) => {
    if (!confirm('确定要删除这个用户吗？')) return;
    
    try {
      await fetch(`/api/users/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (error) {
      console.error('Error deleting user:', error);
    }
  };

  const distributeCredits = async (operation: 'add' | 'subtract' | 'deduct' = 'add') => {
    if (!distributeUserId || distributeAmount <= 0) return;
    
    const targetUser = users.find(u => u.id === distributeUserId);
    const isAdmin = targetUser?.phone === process.env.NEXT_PUBLIC_ADMIN_PHONE;
    
    try {
      if (isAdmin || operation === 'deduct') {
        // 管理员：划扣配额
        const res = await fetch('/api/admin/distribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: distributeUserId, amount: distributeAmount, operation: 'deduct' }),
        });
        const data = await res.json();
        if (data.success) {
          setDistributeAmount(0);
          setDistributeUserId(null);
          setShowDistributeDialog(false);
          fetchData();
          alert(`成功划扣 ${distributeAmount} 配额`);
        } else {
          alert(data.error || '划扣失败');
        }
      } else {
        // 普通用户：增加或扣减积分
        const res = await fetch('/api/admin/distribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: distributeUserId, amount: distributeAmount, operation }),
        });
        const data = await res.json();
        if (data.success) {
          setDistributeAmount(0);
          setDistributeUserId(null);
          setShowDistributeDialog(false);
          fetchData();
          alert(operation === 'add' 
            ? `成功增加 ${distributeAmount} 积分给用户` 
            : `成功扣减 ${distributeAmount} 积分`);
        } else {
          alert(data.error || '操作失败');
        }
      }
    } catch (error) {
      console.error('Error distributing credits:', error);
      alert('操作失败');
    }
  };

  const updateAdminCredits = async (amount: number, operation: 'deduct') => {
    try {
      // 获取管理员用户ID
      const adminUser = users.find(u => u.phone === process.env.NEXT_PUBLIC_ADMIN_PHONE);
      if (!adminUser?.id) {
        alert('管理员账户未找到');
        return;
      }

      const res = await fetch('/api/admin/distribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: adminUser.id, amount, operation: 'deduct' }),
      });
      const data = await res.json();
      if (data.success) {
        setAddCreditsAmount(0);
        setShowAddCreditsDialog(false);
        fetchData();
        alert(`成功划扣 ${amount} 配额`);
      } else {
        alert(data.error || '操作失败');
      }
    } catch (error) {
      console.error('Error updating admin credits:', error);
      alert('操作失败');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN');
  };

  if (loading) {
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
        backgroundColor: '#111827',
        '--background': '0 0% 7%',
        '--foreground': '0 0% 95%',
        '--card': '0 0% 10%',
        '--card-foreground': '0 0% 95%',
        '--muted': '0 0% 15%',
        '--muted-foreground': '0 0% 65%',
        '--border': '0 0% 20%',
        '--input': '0 0% 20%',
        '--ring': '217 91% 60%',
      } as React.CSSProperties : {
        backgroundColor: '#f9fafb',
        '--background': '0 0% 100%',
        '--foreground': '0 0% 7%',
        '--card': '0 0% 100%',
        '--card-foreground': '0 0% 7%',
        '--muted': '0 0% 96%',
        '--muted-foreground': '0 0% 45%',
        '--border': '0 0% 90%',
        '--input': '0 0% 90%',
        '--ring': '217 91% 60%',
      } as React.CSSProperties}
    >
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">极梦AI 后台管理</h1>
            <p className="mt-2 text-muted-foreground">用户数据管理系统</p>
          </div>
          <div className="flex items-center gap-4">
            {/* 日夜模式切换 */}
            <button
              onClick={() => setAdminDarkMode(!adminDarkMode)}
              className={`p-2 rounded-lg transition-colors ${adminDarkMode ? 'bg-gray-800 text-yellow-400 hover:bg-gray-700' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
              title={adminDarkMode ? '切换到日间模式' : '切换到夜间模式'}
            >
              {adminDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            {currentUser && (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">{currentUser.nickname || '用户'}</p>
                  <p className="text-xs text-muted-foreground">{currentUser.phone}</p>
                </div>
                <Button variant="outline" size="sm" onClick={handleLogout} className="flex items-center gap-2">
                  <LogOut className="h-4 w-4" />
                  退出登录
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* 管理员信息卡片 */}
        {admin && (
          <Card className={`mb-6 border-purple-200 ${adminDarkMode ? 'bg-gradient-to-r from-purple-900/50 to-pink-900/50' : 'bg-gradient-to-r from-purple-50 to-pink-50'}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className={`flex items-center gap-2 ${adminDarkMode ? 'text-purple-300' : 'text-purple-700'}`}>
                  <Crown className="h-5 w-5" />
                  管理员账户
                </CardTitle>
                <Dialog open={showAddCreditsDialog} onOpenChange={setShowAddCreditsDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      划扣配额
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>划扣供应配额</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>供应总配额</Label>
                          <p className="text-xl font-bold text-blue-600">{admin.totalQuota}</p>
                        </div>
                        <div>
                          <Label>剩余配额</Label>
                          <p className="text-xl font-bold text-green-600">{admin.remainingQuota}</p>
                        </div>
                      </div>
                      <div>
                        <Label>当前负责人积分</Label>
                        <p className="text-lg font-semibold text-purple-600">{admin.credits}</p>
                      </div>
                      <div>
                        <Label htmlFor="creditsAmount">划扣数量</Label>
                        <Input
                          id="creditsAmount"
                          type="number"
                          value={addCreditsAmount}
                          onChange={(e) => setAddCreditsAmount(parseInt(e.target.value) || 0)}
                          placeholder="输入划扣数量"
                        />
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <AlertCircle className="h-4 w-4" />
                        划扣后剩余配额减少，负责人积分增加
                      </div>
                      <Button 
                        onClick={() => updateAdminCredits(addCreditsAmount, 'deduct')}
                        className="w-full"
                        disabled={addCreditsAmount <= 0 || (admin.remainingQuota || 0) < addCreditsAmount}
                      >
                        确认划扣 {addCreditsAmount} 配额
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <div>
                  <Label className="text-sm text-muted-foreground">手机号</Label>
                  <p className="font-semibold text-foreground">{admin.phone}</p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">用户名</Label>
                  <p className="font-semibold text-foreground">负责人</p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">供应总配额</Label>
                  <p className="font-semibold text-2xl text-blue-600 flex items-center gap-2">
                    <Coins className="h-6 w-6" />
                    {admin.totalQuota}
                  </p>
                  {admin.supplierCredits !== undefined && (
                    <p className="text-xs mt-1 text-muted-foreground">
                      供应商原始: {admin.supplierCredits.toLocaleString()}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">剩余配额</Label>
                  <p className="font-semibold text-2xl text-green-600 flex items-center gap-2">
                    <Coins className="h-6 w-6" />
                    {admin.remainingQuota}
                  </p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">负责人积分</Label>
                  <p className="font-semibold text-2xl text-purple-600 flex items-center gap-2">
                    <Coins className="h-6 w-6" />
                    {admin.credits}
                  </p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">状态</Label>
                  <p>
                    <Badge variant={admin.is_active !== false ? 'default' : 'destructive'}>
                      {admin.is_active !== false ? '正常' : '禁用'}
                    </Badge>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className={`grid w-full grid-cols-8 mb-6 ${adminDarkMode ? 'bg-gray-800' : ''}`}>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              用户管理
            </TabsTrigger>
            <TabsTrigger value="packages" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              充值套餐
            </TabsTrigger>
            <TabsTrigger value="model-credits" className="flex items-center gap-2">
              <Coins className="h-4 w-4" />
              积分配置
            </TabsTrigger>
            <TabsTrigger value="redeem-keys" className="flex items-center gap-2">
              <Ticket className="h-4 w-4" />
              兑换码
            </TabsTrigger>
            <TabsTrigger value="api-keys" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              API密钥
            </TabsTrigger>
            <TabsTrigger value="recharge" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              充值记录
            </TabsTrigger>
            <TabsTrigger value="exchange" className="flex items-center gap-2">
              <Gift className="h-4 w-4" />
              兑换记录
            </TabsTrigger>
            <TabsTrigger value="points" className="flex items-center gap-2">
              <Coins className="h-4 w-4" />
              积分使用
            </TabsTrigger>
          </TabsList>

          {/* 用户管理 */}
          <TabsContent value="users">
            <Card className={adminDarkMode ? 'bg-gray-800 border-gray-700' : ''}>
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
                      <TableHead>剩余积分</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>创建时间</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user, index) => (
                      <TableRow key={user.id || `admin-${index}`} className={user.phone === process.env.NEXT_PUBLIC_ADMIN_PHONE ? 'bg-purple-50' : ''}>
                        <TableCell className="font-mono text-xs">{user.id ? `${String(user.id).slice(0, 8)}...` : '供应商'}</TableCell>
                        <TableCell>
                          {user.phone === process.env.NEXT_PUBLIC_ADMIN_PHONE ? (
                            <span className="flex items-center gap-1">
                              <Crown className="h-4 w-4 text-purple-500" />
                              负责人
                            </span>
                          ) : (
                            user.nickname || '-'
                          )}
                        </TableCell>
                        <TableCell>{user.phone}</TableCell>
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
                                setDistributeUserId(user.id);
                                setShowDistributeDialog(true);
                              }}
                            >
                              <Coins className="h-4 w-4" />
                            </Button>
                            {user.phone !== process.env.NEXT_PUBLIC_ADMIN_PHONE && (
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
            <Card className={adminDarkMode ? 'bg-gray-800 border-gray-700' : ''}>
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
                            <p className="text-gray-500 text-xs">¥{(pkg.price / pkg.credits).toFixed(5)}/积分</p>
                            <span className="text-green-600 text-xs">省 ¥{formatPrice(pkg.savings)}</span>
                          </div>
                        ) : (
                          <p className="text-gray-500 text-xs">¥{(pkg.price / pkg.credits).toFixed(5)}/积分</p>
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
            <Card className={adminDarkMode ? 'bg-gray-800 border-gray-700' : ''}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>模型积分消耗配置</CardTitle>
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
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>模型标识</TableHead>
                      <TableHead>模型名称</TableHead>
                      <TableHead>消耗积分</TableHead>
                      <TableHead>描述</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modelCreditsConfigs.map((config) => (
                      <TableRow key={config.id}>
                        <TableCell className="font-mono">{config.model_key}</TableCell>
                        <TableCell>{config.model_name}</TableCell>
                        <TableCell>
                          <span className="font-bold text-blue-600">{config.credits}</span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{config.description || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={config.is_active ? 'default' : 'secondary'}>
                            {config.is_active ? '启用' : '禁用'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingModelConfig(config);
                                setNewModelConfig({
                                  model_key: config.model_key,
                                  model_name: config.model_name,
                                  credits: config.credits,
                                  description: config.description,
                                  is_active: config.is_active,
                                });
                                setShowModelConfigDialog(true);
                              }}
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => deleteModelConfig(config.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {modelCreditsConfigs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                          暂无配置，点击"添加配置"创建
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

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
            <Card className={adminDarkMode ? 'bg-gray-800 border-gray-700' : ''}>
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
                                  alert('已复制所有兑换码');
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
                            disabled={newKeyCredits <= 0 || newKeyCount < 1 || newKeyCount > 100}
                          >
                            生成 {newKeyCount} 个兑换码
                          </Button>
                          <Button 
                            variant="outline"
                            onClick={() => {
                              setShowGenerateKeyDialog(false);
                              setGeneratedKeys([]);
                              setNewKeyCredits(100);
                              setNewKeyCount(1);
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
                <div className="flex gap-2 mb-4">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => fetchRedeemKeys()}
                  >
                    全部
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => fetchRedeemKeys('unused')}
                  >
                    未使用
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => fetchRedeemKeys('used')}
                  >
                    已使用
                  </Button>
                </div>
                
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>兑换码</TableHead>
                      <TableHead>积分</TableHead>
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
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          暂无兑换码
                        </TableCell>
                      </TableRow>
                    ) : (
                      redeemKeys.map((key) => (
                        <TableRow key={key.id} className={key.status === 'used' ? 'bg-muted/50' : ''}>
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

          {/* 充值记录 */}
          <TabsContent value="recharge">
            <Card className={adminDarkMode ? 'bg-gray-800 border-gray-700' : ''}>
              <CardHeader>
                <CardTitle>充值记录</CardTitle>
              </CardHeader>
              <CardContent>
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
                    <AlertDescription>
                      暂无充值记录。充值记录功能正在配置中，请稍后再试。
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 兑换记录 */}
          <TabsContent value="exchange">
            <Card className={adminDarkMode ? 'bg-gray-800 border-gray-700' : ''}>
              <CardHeader>
                <CardTitle>兑换记录</CardTitle>
              </CardHeader>
              <CardContent>
                {exchangeRecords.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>用户</TableHead>
                        <TableHead>兑换物品</TableHead>
                        <TableHead>消耗积分</TableHead>
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
                          <TableCell>{record.item_name}</TableCell>
                          <TableCell>
                            <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                              <Coins className="h-3 w-3" />
                              -{record.points_used}
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
                    <AlertDescription>
                      暂无兑换记录。兑换记录功能正在配置中，请稍后再试。
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 积分使用记录 */}
          <TabsContent value="points">
            <Card className={adminDarkMode ? 'bg-gray-800 border-gray-700' : ''}>
              <CardHeader>
                <CardTitle>积分使用记录</CardTitle>
              </CardHeader>
              <CardContent>
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
                    <AlertDescription>
                      暂无积分使用记录。积分使用记录功能正在配置中，请稍后再试。
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* API配置中心 */}
          <TabsContent value="api-keys">
            <Card className={adminDarkMode ? 'bg-gray-800 border-gray-700' : ''}>
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
                        <TableHead>状态</TableHead>
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
                                 config.service_type === 'video_generation' ? '视频生成' : '智能分割'}
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
                            <TableCell>
                              <Badge variant={config.is_active ? 'default' : 'secondary'}>
                                {config.is_active ? '启用' : '禁用'}
                              </Badge>
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
                                      alert(`该接口下有 ${modelCount} 个模型，请先删除模型再删除接口`);
                                      return;
                                    }
                                    if (confirm(`确定删除接口 "${config.name}" 吗？`)) {
                                      await fetch(`/api/admin/api-config?table=api_configs&id=${config.id}`, { method: 'DELETE' });
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
                          <TableHead className="w-[50px]">启用</TableHead>
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
                            // 计算积分范围
                            const creditsList = model.parameters?.resolutions?.map((r: any) => r.credits) || [];
                            const minCredits = Math.min(...creditsList);
                            const maxCredits = Math.max(...creditsList);
                            const creditsDisplay = creditsList.length > 0 
                              ? (minCredits === maxCredits ? `${minCredits}` : `${minCredits}~${maxCredits}`)
                              : '-';
                            
                            return (
                              <TableRow key={model.id} className={!model.is_active ? 'opacity-50' : ''}>
                                <TableCell>
                                  <input
                                    type="checkbox"
                                    checked={model.is_active}
                                    onChange={(e) => toggleModelActive(model.id, e.target.checked)}
                                    className="w-4 h-4"
                                  />
                                </TableCell>
                                <TableCell className="font-mono">{model.model_id}</TableCell>
                                <TableCell className="font-medium">{model.model_name}</TableCell>
                                <TableCell className="text-muted-foreground text-sm max-w-[150px] truncate">{model.description || '-'}</TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {model.parameters?.resolutions?.slice(0, 3).map((r: any, i: number) => (
                                      <Badge key={i} variant="secondary" className="text-xs">{r.label}</Badge>
                                    ))}
                                    {model.parameters?.resolutions?.length > 3 && (
                                      <span className="text-xs text-muted-foreground">+{model.parameters.resolutions.length - 3}</span>
                                    )}
                                    {(!model.parameters?.resolutions || model.parameters.resolutions.length === 0) && (
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
                                          await fetch(`/api/admin/api-config?table=api_models&id=${model.id}`, { method: 'DELETE' });
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
                              onChange={(e) => setEditingConfig({
                                ...editingConfig,
                                data: { ...editingConfig.data, model_id: e.target.value }
                              })}
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
                          alert('请填写模型 ID 和模型名称');
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
                      await fetch('/api/admin/api-config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
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
              {users.find(u => u.id === distributeUserId)?.phone === process.env.NEXT_PUBLIC_ADMIN_PHONE ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>供应总配额</Label>
                      <p className="text-xl font-bold text-blue-600">{admin?.totalQuota || 0}</p>
                    </div>
                    <div>
                      <Label>剩余配额</Label>
                      <p className="text-xl font-bold text-green-600">{admin?.remainingQuota || 0}</p>
                    </div>
                  </div>
                  <div>
                    <Label>当前负责人积分</Label>
                    <p className="text-lg font-semibold text-purple-600">{admin?.credits || 0}</p>
                  </div>
                  <div>
                    <Label htmlFor="distributeAmount">划扣数量</Label>
                    <Input
                      id="distributeAmount"
                      type="number"
                      value={distributeAmount}
                      onChange={(e) => setDistributeAmount(parseInt(e.target.value) || 0)}
                      placeholder="输入要划扣的配额数量"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <AlertCircle className="h-4 w-4" />
                    划扣后剩余配额减少，负责人积分增加
                  </div>
                  <Button 
                    onClick={() => distributeCredits('deduct')}
                    className="w-full"
                    disabled={distributeAmount <= 0 || (admin?.remainingQuota || 0) < distributeAmount}
                  >
                    确认划扣 {distributeAmount} 配额
                  </Button>
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
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>供应总配额</Label>
                      <p className="text-lg font-semibold text-blue-600">{admin?.totalQuota || 0}</p>
                    </div>
                    <div>
                      <Label>剩余配额</Label>
                      <p className="text-lg font-semibold text-green-600">{admin?.remainingQuota || 0}</p>
                    </div>
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
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <AlertCircle className="h-4 w-4" />
                    增加从剩余配额扣除，扣减将返还到剩余配额
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      onClick={() => distributeCredits('add')}
                      className="flex-1"
                      disabled={distributeAmount <= 0 || (admin?.remainingQuota || 0) < distributeAmount}
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
      </div>
    </div>
  );
}

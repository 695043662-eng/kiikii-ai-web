// 元素类型
export type ElementType = 'rectangle' | 'circle' | 'ellipse' | 'image' | 'line' | 'path' | 'imageGenerator' | 'videoGenerator' | 'group' | 'text';

// 画布元素
export interface CanvasElement {
  id: string;
  type: ElementType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  // 变换属性
  flipH?: boolean; // 水平翻转
  flipV?: boolean; // 垂直翻转
  // 滤镜和调整
  filter?: string; // 滤镜名称
  adjustments?: { brightness?: number; contrast?: number; saturation?: number }; // 调整参数
  // 图片特有
  imageUrl?: string;
  imageKey?: string; // 对象存储 key（持久化）
  dbId?: string; // IndexedDB key（本地图片持久化）
  aspectRatio?: number; // 原始宽高比 width/height
  sourceType?: 'generate' | 'video' | 'canvas' | 'upload' | 'split'; // 来源类型
  sourcePrompt?: string; // 来源提示词
  isCropped?: boolean; // 是否为裁剪后的图片
  // 生成状态
  generationStatus?: 'generating' | 'submitted' | 'recovering' | 'completed' | 'failed' | 'expired';
  generationError?: string; // 失败原因：'失败' 或 '违规' 或 '恢复失败'
  // 【干净数据结构】三个独立字段，不使用字符串拼接
  generationClientId?: string; // 前端生成的 clientId（创建时确定，不变）
  generationIndex?: number;    // 图片索引（创建时确定，不变）
  generationTaskId?: string;   // 后端返回的 actualTaskId（收到 start 事件后更新）
  isLoading?: boolean; // 图片加载中状态（从 COS 恢复时）
  // 路径特有
  pathData?: string;
  path?: { x: number; y: number }[]; // 画笔路径点
  pathD?: string; // SVG path d 属性
  bubbleTailDirection?: 'left' | 'right'; // 气泡尾巴方向
  originalWidth?: number; // 原始宽度（用于画笔路径缩放）
  originalHeight?: number; // 原始高度（用于画笔路径缩放）
  // 文字特有 - 星流AI标准
  textContent?: string; // 文字内容
  fontSize?: number; // 字号
  fontFamily?: string; // 字体
  color?: string; // 文字颜色
  // 文字样式
  fontWeight?: 'normal' | 'bold'; // 字重
  fontStyle?: 'normal' | 'italic'; // 字体样式（斜体）
  textDecoration?: 'none' | 'underline' | 'line-through'; // 文字装饰
  textAlign?: 'left' | 'center' | 'right' | 'justify'; // 对齐方式
  lineHeight?: number; // 行高（倍数）
  charSpacing?: number; // 字间距
  textBackgroundColor?: string; // 文字背景色
  // 组特有
  groupChildIds?: string[]; // 组内子元素ID列表
  groupId?: string; // 所属组ID（子元素使用）
}

// 工具类型
export type ToolType = 'select' | 'hand' | 'rectangle' | 'circle' | 'line' | 'pen' | 'image' | 'annotation' | 'text'
  | 'shape-rectangle' | 'shape-circle' | 'shape-triangle' | 'shape-star'
  | 'shape-bubble' | 'shape-arrow-left' | 'shape-arrow-right';

// 标注类型
export type AnnotationType = 'comment' | 'highlight' | 'sketch';

// 标注状态
export type AnnotationStatus = 'pending' | 'processing' | 'completed';

// 画布标注 - ChatCanvas 核心功能
export interface CanvasAnnotation {
  id: string;
  type: AnnotationType;
  position: { x: number; y: number };
  content: string;
  targetElementId?: string; // 关联的画布元素 ID
  timestamp: number;
  status: AnnotationStatus;
  author?: 'user' | 'assistant';
  // 高亮标注特有
  highlightColor?: string;
  highlightArea?: { x: number; y: number; width: number; height: number };
  // 草图标注特有
  sketchData?: string; // SVG path data
}

// 历史记录
export interface HistoryState {
  elements: CanvasElement[];
  selectedIds: string[];
}

// 消息
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  timestamp: number;
  // 发送到对话的元素信息
  elementId?: string;
  elementType?: string;
  elementSrc?: string;
  // 生成状态
  isGenerating?: boolean;
  // 用户消息的参考图和规格信息
  referenceImages?: string[]; // 参考图 URL 列表（用于显示）
  referenceImageKeys?: string[]; // 🔧 #040 新增：参考图 COS key（用于持久化）
  // 助手消息的生成图
  imageUrlKey?: string; // 🔧 #041 新增：生成图 COS key（用于持久化）
  specs?: {
    model: string;
    ratio: string;
    resolution: string;
    count: number;
  };
}

// 面板状态
export interface PanelState {
  layers: boolean;
  styles: boolean;
  components: boolean;
}

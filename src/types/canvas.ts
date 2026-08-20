// 元素类型
export type ElementType = 'rectangle' | 'circle' | 'ellipse' | 'image' | 'image-stack' | 'video' | 'line' | 'path' | 'imageGenerator' | 'videoGenerator' | 'text' | 'generate-panel';

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
  zIndex?: number; // #608 层叠顺序（替代数组重排，避免 DOM 大规模移动导致重栅格化）
  // 变换属性
  flipH?: boolean; // 水平翻转
  flipV?: boolean; // 垂直翻转
  // 滤镜和调整
  filter?: string; // 滤镜名称
  adjustments?: { brightness?: number; contrast?: number; saturation?: number }; // 调整参数
  // 图片特有
  imageUrl?: string;
  imageKey?: string; // 对象存储 key（持久化）
  providerUrl?: string; // #525 混合架构：服务商原始URL（优先渲染，过期后fallback代理URL）
  dbId?: string; // IndexedDB key（本地图片持久化）
  aspectRatio?: number; // 原始宽高比 width/height
  sourceType?: 'generate' | 'video' | 'canvas' | 'upload' | 'split'; // 来源类型
  sourcePrompt?: string; // 来源提示词
  isCropped?: boolean; // 是否为裁剪后的图片
  naturalWidth?: number; // 图片实际宽度（原始分辨率）
  naturalHeight?: number; // 图片实际高度（原始分辨率）
  // 生成状态
  generationStatus?: 'generating' | 'submitted' | 'recovering' | 'completed' | 'failed' | 'expired';
  generationProgress?: number; // #7xx 视频生成进度（0-100）
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
  // 引用生成面板特有
  sourceId?: string; // 来源节点ID（从哪个图片连线过来）- 旧版单源，兼容保留
  sourceIds?: string[]; // 👑 多源模式：来源节点ID数组（支持多图连接）
  targetType?: string; // 目标类型：文本、图片、视频、音频
  llmEnabled?: boolean; // #346 是否启用语言大模型（文本类型专用）
  // #347 面板类型区分
  panelType?: 'image' | 'text' | 'video'; // 面板类型，未标记默认为 'image'
  // #313 新增：generate-panel 局部参数（节点化数据）
  panelModel?: string; // 选中的模型
  panelRatio?: string; // 选中的比例
  panelResolution?: string; // 选中的分辨率
  panelQuality?: string; // #523 选中的品质（T8Star GPT 模型专用）
  panelCount?: number; // 生成数量
  panelPrompt?: string; // 提示词
  // #365 图片栈特有
  imageUrls?: string[]; // 图片 URL 数组（多张图片堆叠）
  imageKeys?: string[]; // 图片 Key 数组（持久化）
  providerUrls?: string[]; // #525 混合架构：服务商原始URL数组（优先渲染）
  activeIndex?: number; // 当前首图索引
  isStackExpanded?: boolean; // 是否展开堆叠
  showBottomPanel?: boolean; // 是否显示底部面板
  // #视频生成特有
  videoDuration?: number; // 视频时长（秒）：5, 10, 15, 20
  videoAspectRatio?: string; // 视频比例：'16:9', '9:16', '1:1'
  videoSize?: string; // 视频尺寸：'small', 'large'
  videoUrls?: string[]; // 视频 URL 数组
  videoKeys?: string[]; // 视频 Key 数组（持久化）
  // 上传视频特有
  videoUrl?: string; // 上传视频的播放 URL（blob URL 或签名 URL）
  videoKey?: string; // 上传视频的对象存储 key（持久化）
  thumbnailUrl?: string; // #628 视频首帧缩略图 URL（用于 poster 属性）
  thumbnailKey?: string; // #629 缩略图的对象存储 key（持久化）
  // #680 视频进度管道：占位符生成进度（0-100），同步到底层 CanvasRoseCurve
  progress?: number;
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
  // #655 视频占位符进度
  isVideoPlaceholder?: boolean;  // 视频占位符标记
  videoProgress?: number;        // 视频进度 0-100
  videoUrl?: string;             // 视频完成后的 URL
}

// 面板状态
export interface PanelState {
  layers: boolean;
  styles: boolean;
  components: boolean;
}

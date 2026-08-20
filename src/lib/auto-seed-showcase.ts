/**
 * #821 展示区 + 轮播图 自动种子数据脚本
 * 
 * 问题：生产数据库 canvas_config 表中 showcase_card / carousel 数据为空，
 * 导致主页 /api/showcase 和 /api/carousel 返回空数组。
 * 
 * 解决方案：
 * 1. 检查 canvas_config 中是否有 showcase_card 数据
 * 2. 如果为空，自动插入种子数据
 * 3. 所有操作幂等（先查后插），可安全重复执行
 * 
 * 连接方式：pg 直连 Supabase PostgreSQL（与 auto-migrate-819.ts 一致）
 * 限制：沙盒环境无 IPv6 出口，直连 Supabase 失败 → 自动跳过
 *       生产服务器有 IPv6，启动时自动完成种子数据插入
 */

import { Client } from 'pg';

// ====== 展示卡片种子数据 ======
const SHOWCASE_SEED_DATA = [
  {
    config_key: 'card-custom-1782992348997-68tzn4',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 1,
    extra_data: {
      tag: '电商营销',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1782992344755-63t147fbh9d.png&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'gpt-image-2',
      builtInPrompt: '618狂购节主题，暖红橙色调，3D卡通潮玩风格。背景为卡通商业街场景，两侧是红黄配色的店铺建筑，上方是红底大字标题"618狂购节"，搭配品牌标识"DUIYOU"。画面中心是一个活力时尚的3D卡通女孩IP，浅棕长发、穿棕黄夹克与牛仔短裙，面带笑容向前奔跑，伸手递出一张金色"¥200优惠"券，动作充满动感。画面周围飘散红包、金币、钞票元素，整体氛围热闹活泼。整体色调以红、橙、黄为主，光影明亮温暖，充满元气满满的购物狂欢氛围，4K高清，细节精致，8K商业质感。',
      builtInVideoUrl: null,
      referenceImages: null,
      builtInResolution: '4k',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-21',
    config_type: 'showcase_card',
    title: '日系清新风饮品海报',
    content: '柔和治愈米白+暖粉色调',
    is_enabled: true,
    sort_order: 2,
    extra_data: {
      tag: '商业海报',
      likes: 756,
      category: 'marketing',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783772883988-lqk4865aail.png&assetType=perm',
      aspectRatio: 0.7,
      builtInModel: 'gpt-image-2',
      builtInPrompt: '日系清新风饮品海报，整体为柔和治愈的米白+暖粉色调。画面中心是一位穿着白色亚麻上衣的年轻女生，闭眼微笑，双手举着打开瓶盖的产品凑近嘴边饮用，姿态放松惬意。前景中央是一瓶产品主体，周围摆放着新鲜的桃子、菠萝果肉与气泡装饰，背景虚化绿植与柔和光影。画面左侧是手写体与印刷体结合的主题文案，搭配英文说明，下方是产品卖点图标。整体风格清新明亮，充满夏日清爽感，4K高清，细节精致，商业级饮品海报质感',
      referenceImages: ['/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783772896831-si9127nljq9.png&assetType=perm'],
      builtInReferenceImage: null,
      displayReferenceImage: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783772896831-si9127nljq9.png&assetType=perm',
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1782975657530-f8ommo',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 3,
    extra_data: {
      tag: '玩法合集',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1782975651506-blzt4ikxdob.mp4&assetType=perm',
      aspectRatio: 0.5897435897435898,
      builtInModel: 'veo3-fast',
      builtInPrompt: '画面主体正对镜头，以第一人称视角（POV）将一只手直直伸向镜头，然后缓慢将手收回。主体的头部微微向一侧转动，随后转回并与镜头产生直接的眼神交汇。主体的边缘有轻微的自然微风动态。镜头运动：缓慢且平滑的后拉运镜（Dolly out）。严格保持输入图像的原始背景、光影和艺术风格。伸出的手上带有电影级的动态模糊。',
      builtInVideoUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1782975651506-blzt4ikxdob.mp4&assetType=perm',
      referenceImages: ['/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1782975655786-78y5fqs1x2r.webp&assetType=perm'],
      builtInResolution: '1080p',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1782990867551-a1ckjh',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 4,
    extra_data: {
      tag: 'IP设计',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1782990864165-k5ydoc6ly4q.png&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'gpt-image-2',
      builtInPrompt: '【核心参数】 - 比例：9:16竖屏 - 画质帧率：4K超高清，60fps，丝滑流畅 - 风格质感：超写实3D毛绒黏土Q版手办，软fufu棉花糖体积感，OC渲染，暖光柔焦光影，线条软乎乎带弧度，人物发丝有毛茸茸的发光光晕，镜头轻微自然晃动，第一人称POV视角，全程脸部特写 - 音效：无背景音乐，仅保留软萌的呼吸声、轻微的布料摩擦声和小声的"嗯？"气音 - 首帧：以提供的图片为视频第一帧，保留小女孩的造型、服饰与睁大眼睛、嘴巴微张的惊讶表情 【5秒分镜脚本】 0-1s（首帧）：画面固定为图片里小女孩站在木凳上、睁着大眼睛、嘴巴微张的样子，表情像刚发现新大陆一样好奇。"嗯？" 1-3s：她突然把肉乎乎的小脸蛋整个紧紧贴向镜头，圆滚滚的脸颊把镜头挤得微微变形，然后调皮地闭上一只眼睛，只用另一只亮晶晶的大眼睛使劲偷看，像在偷偷观察镜头外的东西，偷感拉满，又怂又萌。 3-5s：她偷看几秒后，又带着点心虚，快速把脸往后缩了一点点，脸颊还带着被镜头压出的红印，眼睛却还是忍不住偷瞄，嘴巴轻轻抿成小月牙，软萌到心都化了，主体元素经过重新设计，细节与构图做轻微变化，无作者署名，无水印，无真实品牌名',
      builtInVideoUrl: null,
      referenceImages: null,
      builtInResolution: '4k',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1782998509463-rucwqh',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 5,
    extra_data: {
      tag: '玩法合集',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1782998506834-n7ntkhpa8g.mp4&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'veo3-fast',
      builtInPrompt: null,
      builtInVideoUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1782998506834-n7ntkhpa8g.mp4&assetType=perm',
      referenceImages: null,
      builtInResolution: '720p',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1782992605501-ilmhjs',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 6,
    extra_data: {
      tag: '电商营销',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1782992601754-2wvgxdq4ya2.png&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'gpt-image-2',
      builtInPrompt: '母亲节主题3D卡通盲盒手办海报。画面正中是一个可爱3D卡通女孩手办，站在粉色礼盒上，穿浅蓝连衣裙配白花头饰，双手捧着一大束粉色康乃馨递向镜头。背景是梦幻粉色花海，空中飘落花瓣和蝴蝶，两侧是粉蓝包装的精致礼盒。上方是圆润卡通大字"妈妈，我爱你！"，下方是英文"Happy Mother\'s Day"和蝴蝶结装饰。整体色调为粉、浅蓝、白，光影柔和温馨，充满母爱温情与少女心，4K高清，细节精致，8K商业质感。',
      builtInVideoUrl: null,
      referenceImages: null,
      builtInResolution: '4k',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1782992465994-p97f01',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 7,
    extra_data: {
      tag: '电商营销',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1782992461727-06bmnrve9djh.png&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'gpt-image-2',
      builtInPrompt: '3D卡通潮玩风格宠物领养日活动海报。画面正中是一个圆圆胖胖的橘猫手办，头顶戴迷你领结，坐在礼物盒上，好奇地歪头看着一只小柯基犬手办，两者之间有爱心冒出。背景是蓝绿色气球和彩带装饰，上方是圆润卡通大字"领养代替购买"，搭配可爱爪印图案。两侧摆放不同造型的猫咪和狗狗手办，下方是活动信息文字区。整体色调为浅蓝绿+暖橙粉，光影明亮温暖，充满可爱与治愈感，4K高清，细节精致，8K商业质感。',
      builtInVideoUrl: null,
      referenceImages: null,
      builtInResolution: '4k',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1782992890227-xorq2z',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 8,
    extra_data: {
      tag: '电商营销',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1782992888140-0xvk7geuhfj.png&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'gpt-image-2',
      builtInPrompt: '3D卡通潮玩风格618超级宠粉日海报。画面正中是一个活泼时尚的3D卡通女孩IP，扎着高马尾，穿白色T恤配浅蓝牛仔短裤，踩着滑板从右侧飞驰而来，一只手举起比出胜利手势。她身后拖出一条彩色飘带，飘带上写着"超级宠粉日"。背景是蓝粉配色的大型直播间场景，上方悬挂"618"立体大字，两侧飘着爱心和星星弹幕。画面下方是产品展示区和"¥0元抽大奖"按钮装饰。整体色调为蓝粉+白，光影明亮充满活力，4K高清，细节精致，8K商业质感。',
      builtInVideoUrl: null,
      referenceImages: null,
      builtInResolution: '4k',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1783015080579-hgbc9k',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 9,
    extra_data: {
      tag: '插画设计',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783015079137-33r83hht70a.png&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'gpt-image-2',
      builtInPrompt: '吉卜力风格插画，夏日乡间小路，两侧是金黄稻田和蓝天白云，远处是青山和日本乡村木屋，一位扎马尾的少女骑自行车从画面左侧穿过，裙摆随微风飘扬，整体画面温暖明亮，充满夏日清新感，吉卜力标志性色彩风格，4K高清，细节精致。',
      builtInVideoUrl: null,
      referenceImages: null,
      builtInResolution: '4k',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1783015194088-lav7q4',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 10,
    extra_data: {
      tag: '插画设计',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783015190020-iz848uk2v0t.png&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'gpt-image-2',
      builtInPrompt: '新海诚风格插画，黄昏时分的东京街头，天空呈现出标志性的绚丽晚霞（橙红、粉紫渐变），云层细腻而壮观，光束穿透云层洒落。街道上有电车驶过，街边是便利店和居酒屋，行人撑着透明伞。画面中心是一位穿校服的少女，站在天桥上望向远方，头发被晚风吹起。整体光影梦幻唯美，新海诚标志性色彩风格，4K高清，细节精致。',
      builtInVideoUrl: null,
      referenceImages: null,
      builtInResolution: '4k',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1783015330422-cgyumg',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 11,
    extra_data: {
      tag: '插画设计',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783015327307-b1ubb4gldxr.png&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'gpt-image-2',
      builtInPrompt: '赛博朋克风格插画，未来城市夜景，霓虹灯牌林立的亚洲风格街道，全息广告在空中漂浮，雨后路面反射出五彩光芒。街道上有小型飞行器穿梭，行人穿着科技感十足的外套。画面中心是一位短发女孩，戴荧光耳机，手持发光饮料杯，背景是巨大的全息猫咪广告牌。整体色调为蓝紫+粉红+霓虹绿，赛博朋克标志色彩风格，4K高清，细节精致。',
      builtInVideoUrl: null,
      referenceImages: null,
      builtInResolution: '4k',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1783079480188-fu5n5s',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 12,
    extra_data: {
      tag: '玩法合集',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783079477210-edv1ib1cs7.mp4&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'veo3-fast',
      builtInPrompt: null,
      builtInVideoUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783079477210-edv1ib1cs7.mp4&assetType=perm',
      referenceImages: null,
      builtInResolution: '720p',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1783105666974-jaobgz',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 13,
    extra_data: {
      tag: '玩法合集',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783105663027-d7wul7bo13f.mp4&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'veo3-fast',
      builtInPrompt: null,
      builtInVideoUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783105663027-d7wul7bo13f.mp4&assetType=perm',
      referenceImages: null,
      builtInResolution: '720p',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1783486431487-elksxg',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 14,
    extra_data: {
      tag: '玩法合集',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783486296528-flrju3i79q.mp4&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'veo3-fast',
      builtInPrompt: null,
      builtInVideoUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783486296528-flrju3i79q.mp4&assetType=perm',
      referenceImages: null,
      builtInResolution: '720p',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1783487356748-7vi1mu',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 15,
    extra_data: {
      tag: '玩法合集',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783487306848-mbiug83xrd.mp4&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'veo3-fast',
      builtInPrompt: null,
      builtInVideoUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783487306848-mbiug83xrd.mp4&assetType=perm',
      referenceImages: null,
      builtInResolution: '720p',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1783528932580-83z1qe',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 16,
    extra_data: {
      tag: '玩法合集',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783528930524-bwamyo20f7.mp4&assetType=perm',
      aspectRatio: 0.7472924187725631,
      builtInModel: 'veo3-fast',
      builtInPrompt: null,
      builtInVideoUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783528930524-bwamyo20f7.mp4&assetType=perm',
      referenceImages: null,
      builtInResolution: '720p',
      builtInAspectRatio: '3:4',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1783528984954-e159gh',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 17,
    extra_data: {
      tag: '玩法合集',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783528984048-qs1bncmd86k.mp4&assetType=perm',
      aspectRatio: 0.5625,
      builtInModel: 'veo3-fast',
      builtInPrompt: null,
      builtInVideoUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783528984048-qs1bncmd86k.mp4&assetType=perm',
      referenceImages: null,
      builtInResolution: '720p',
      builtInAspectRatio: '9:16',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1782998545715-du6w8s',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 18,
    extra_data: {
      tag: '插画设计',
      likes: 0,
      category: 'creative',
      gridSpan: 2,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1782998543898-t9g6g9jhe4.png&assetType=perm',
      aspectRatio: 1.7777777777777777,
      builtInModel: 'gpt-image-2',
      builtInPrompt: '2026童趣芒种节气活动海报，扁平肌理插画风格。画面主体是分块田园，黄绿橙三色田野交错，白色小路蜿蜒。五名卡通孩童正在田间劳作：浇水、插秧、搬石头，动作天真活泼。左侧是圆润卡通大字"童趣芒种 感知节气"；右侧是英文"GRAIN IN BEARD"、活动时间地点信息与寄语文案。整体以明亮黄绿为主色调，肌理质感柔和，充满童真与田园生机，适合亲子节气活动宣传，高清插画质感。',
      builtInVideoUrl: null,
      referenceImages: null,
      builtInResolution: '4k',
      builtInAspectRatio: '16:9',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
  {
    config_key: 'card-custom-1783529059859-xlszec',
    config_type: 'showcase_card',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 19,
    extra_data: {
      tag: '玩法合集',
      likes: 0,
      category: 'creative',
      gridSpan: 1,
      imageUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783529057868-gwlqi0bnh1r.mp4&assetType=perm',
      aspectRatio: 0.7392344497607656,
      builtInModel: 'veo3-fast',
      builtInPrompt: null,
      builtInVideoUrl: '/api/canvas/image?key=dev%2Fcanvas%2F2026-07%2F1783529057868-gwlqi0bnh1r.mp4&assetType=perm',
      referenceImages: null,
      builtInResolution: '720p',
      builtInAspectRatio: '3:4',
      builtInReferenceImage: null,
      displayReferenceImage: null,
      status: 'approved',
      source_type: 'admin_upload',
    },
  },
];

// ====== 轮播图种子数据 ======
const CAROUSEL_SEED_DATA = [
  {
    config_key: '/carousel-defaults/2.jpg',
    config_type: 'carousel',
    title: '智能视频生成',
    content: '文字变视频，一键创作',
    is_enabled: true,
    sort_order: 1,
    extra_data: {
      tag: '新功能',
      mediaType: 'image',
    },
  },
  {
    config_key: 'dev/canvas/2026-06/1782703539313-waqhnvfiu7i.mp4',
    config_type: 'carousel',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 2,
    extra_data: {
      tag: '',
      mediaType: 'video',
    },
  },
  {
    config_key: 'dev/canvas/2026-07/1783487648231-u6je2pk5wc.webp',
    config_type: 'carousel',
    title: '',
    content: '',
    is_enabled: true,
    sort_order: 3,
    extra_data: {
      tag: '',
      mediaType: 'image',
    },
  },
];

// ====== 构建连接字符串 ======
function buildConnectionString(): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;

  if (!supabaseUrl || !dbPassword) {
    console.log('[SeedShowcase] 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_DB_PASSWORD，跳过种子数据');
    return null;
  }

  const match = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!match) {
    console.log('[SeedShowcase] 无法从 SUPABASE_URL 提取 project ref:', supabaseUrl);
    return null;
  }

  const ref = match[1];
  return `postgresql://postgres:${encodeURIComponent(dbPassword)}@db.${ref}.supabase.co:5432/postgres`;
}

// ====== 执行种子数据插入 ======
export async function runSeedShowcase(): Promise<{ success: boolean; message: string; details: string[] }> {
  const details: string[] = [];

  const connStr = buildConnectionString();
  if (!connStr) {
    return {
      success: false,
      message: '缺少数据库连接配置，跳过展示区种子数据',
      details: ['需要在 .env.local 中设置 SUPABASE_DB_PASSWORD'],
    };
  }

  let client: Client | null = null;
  try {
    console.log('[SeedShowcase] 尝试连接 Supabase 数据库...');
    client = new Client({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });

    await client.connect();
    details.push('数据库连接成功');

    // Step 1: 检查是否已有展示卡片数据
    const showcaseCheck = await client.query(
      "SELECT COUNT(*) as cnt FROM canvas_config WHERE config_type = 'showcase_card'"
    );
    const showcaseCount = Number(showcaseCheck.rows[0].cnt);

    if (showcaseCount > 0) {
      details.push(`展示卡片已有 ${showcaseCount} 条数据，跳过种子数据插入`);
      console.log(`[SeedShowcase] 展示卡片已有 ${showcaseCount} 条，跳过`);
    } else {
      // Step 2: 插入展示卡片种子数据（使用 INSERT ... SELECT WHERE NOT EXISTS 实现幂等）
      console.log('[SeedShowcase] 插入展示卡片种子数据...');
      let insertedShowcase = 0;

      for (const card of SHOWCASE_SEED_DATA) {
        try {
          await client.query(
            `INSERT INTO canvas_config (config_key, config_type, title, content, is_enabled, sort_order, extra_data)
             SELECT $1, $2, $3, $4, $5, $6, $7
             WHERE NOT EXISTS (
               SELECT 1 FROM canvas_config WHERE config_key = $1 AND config_type = $2
             )`,
            [
              card.config_key,
              card.config_type,
              card.title,
              card.content,
              card.is_enabled,
              card.sort_order,
              JSON.stringify(card.extra_data),
            ]
          );
          insertedShowcase++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          details.push(`展示卡片 ${card.config_key} 插入失败: ${msg.substring(0, 100)}`);
        }
      }
      details.push(`展示卡片: 插入 ${insertedShowcase} 条`);
    }

    // Step 3: 检查是否已有轮播图数据
    const carouselCheck = await client.query(
      "SELECT COUNT(*) as cnt FROM canvas_config WHERE config_type = 'carousel'"
    );
    const carouselCount = Number(carouselCheck.rows[0].cnt);

    if (carouselCount > 0) {
      details.push(`轮播图已有 ${carouselCount} 条数据，跳过种子数据插入`);
      console.log(`[SeedShowcase] 轮播图已有 ${carouselCount} 条，跳过`);
    } else {
      // Step 4: 插入轮播图种子数据（使用 INSERT ... SELECT WHERE NOT EXISTS 实现幂等）
      console.log('[SeedShowcase] 插入轮播图种子数据...');
      let insertedCarousel = 0;

      for (const item of CAROUSEL_SEED_DATA) {
        try {
          await client.query(
            `INSERT INTO canvas_config (config_key, config_type, title, content, is_enabled, sort_order, extra_data)
             SELECT $1, $2, $3, $4, $5, $6, $7
             WHERE NOT EXISTS (
               SELECT 1 FROM canvas_config WHERE config_key = $1 AND config_type = $2
             )`,
            [
              item.config_key,
              item.config_type,
              item.title,
              item.content,
              item.is_enabled,
              item.sort_order,
              JSON.stringify(item.extra_data),
            ]
          );
          insertedCarousel++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          details.push(`轮播图 ${item.config_key} 插入失败: ${msg.substring(0, 100)}`);
        }
      }
      details.push(`轮播图: 插入 ${insertedCarousel} 条`);
    }

    // Step 5: 验证
    const finalShowcase = await client.query(
      "SELECT COUNT(*) as cnt FROM canvas_config WHERE config_type = 'showcase_card'"
    );
    const finalCarousel = await client.query(
      "SELECT COUNT(*) as cnt FROM canvas_config WHERE config_type = 'carousel'"
    );
    details.push(`验证: 展示卡片 ${finalShowcase.rows[0].cnt} 条, 轮播图 ${finalCarousel.rows[0].cnt} 条`);

    console.log('[SeedShowcase] 种子数据完成!', details.join(' | '));

    return {
      success: true,
      message: '#821 展示区+轮播图种子数据完成',
      details,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[SeedShowcase] 种子数据失败:', msg);
    details.push(`错误: ${msg.substring(0, 200)}`);
    return {
      success: false,
      message: `#821 种子数据失败: ${msg.substring(0, 100)}`,
      details,
    };
  } finally {
    if (client) {
      try { await client.end(); } catch (_) { /* ignore */ }
    }
  }
}

// ====== 检查是否需要执行种子数据 ======
export async function checkSeedNeeded(): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;

  if (!supabaseUrl || !dbPassword) {
    console.log('[SeedShowcase] 缺少数据库密码配置，跳过检查');
    return false;
  }

  const connStr = buildConnectionString();
  if (!connStr) return false;

  let client: Client | null = null;
  try {
    client = new Client({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });
    await client.connect();

    // 检查展示卡片数量
    const showcaseCheck = await client.query(
      "SELECT COUNT(*) as cnt FROM canvas_config WHERE config_type = 'showcase_card'"
    );
    const showcaseCount = Number(showcaseCheck.rows[0].cnt);

    if (showcaseCount > 0) {
      console.log(`[SeedShowcase] 展示卡片已有 ${showcaseCount} 条，无需种子数据`);
      return false;
    }

    // 检查轮播图数量
    const carouselCheck = await client.query(
      "SELECT COUNT(*) as cnt FROM canvas_config WHERE config_type = 'carousel'"
    );
    const carouselCount = Number(carouselCheck.rows[0].cnt);

    if (carouselCount > 0) {
      console.log(`[SeedShowcase] 轮播图已有 ${carouselCount} 条，无需种子数据`);
      return false;
    }

    console.log('[SeedShowcase] 展示卡片和轮播图均为空，需要执行种子数据');
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('[SeedShowcase] 检查种子数据状态失败（可能是IPv6限制）:', msg.substring(0, 100));
    return false;
  } finally {
    if (client) {
      try { await client.end(); } catch (_) { /* ignore */ }
    }
  }
}

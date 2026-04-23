'use client';

import React from 'react';

// HSB 转 HEX
function hsbToHex(h: number, s: number, b: number): string {
  const sNorm = s / 100;
  const bNorm = b / 100;
  const c = bNorm * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = bNorm - c;
  let r = 0, g = 0, bl = 0;
  
  if (h < 60) { r = c; g = x; bl = 0; }
  else if (h < 120) { r = x; g = c; bl = 0; }
  else if (h < 180) { r = 0; g = c; bl = x; }
  else if (h < 240) { r = 0; g = x; bl = c; }
  else if (h < 300) { r = x; g = 0; bl = c; }
  else { r = c; g = 0; bl = x; }
  
  const toHex = (v: number) => {
    const hex = Math.round((v + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

// HEX 转 HSB
function hexToHSB(hex: string): { h: number; s: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
      case g: h = ((b - r) / d + 2) * 60; break;
      case b: h = ((r - g) / d + 4) * 60; break;
    }
  }
  
  return { h: Math.round(h), s: Math.round(s * 100), b: Math.round(v * 100) };
}

interface PenToolbarProps {
  penSize: number;
  setPenSize: (size: number) => void;
  penColor: string;
  setPenColor: (color: string) => void;
  penHue: number;
  setPenHue: (hue: number) => void;
  penSaturation: number;
  setPenSaturation: (sat: number) => void;
  penBrightness: number;
  setPenBrightness: (bright: number) => void;
  penOpacity: number;
  setPenOpacity: (opacity: number) => void;
  showColorPicker: boolean;
  setShowColorPicker: (show: boolean) => void;
}

export default function PenToolbar({
  penSize,
  setPenSize,
  penColor,
  setPenColor,
  penHue,
  setPenHue,
  penSaturation,
  setPenSaturation,
  penBrightness,
  setPenBrightness,
  penOpacity,
  setPenOpacity,
  showColorPicker,
  setShowColorPicker,
}: PenToolbarProps) {
  // 更新颜色从 HSB
  const updateColorFromHSB = (h: number, s: number, b: number) => {
    setPenColor(hsbToHex(h, s, b));
  };
  
  // 计算 hue 对应的纯色
  const penHueColor = hsbToHex(penHue, 100, 100);
  
  return (
    <div 
      data-toolbar="true"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg shadow-md px-4 py-2"
      style={{ pointerEvents: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 粗细滑动条 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">粗细</span>
        <input
          type="range"
          min="1"
          max="20"
          value={penSize}
          onChange={(e) => setPenSize(Number(e.target.value))}
          className="w-24 h-1 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
        <span className="text-xs text-gray-600 dark:text-gray-300 w-6 text-center">{penSize}</span>
      </div>
      
      {/* 分隔线 */}
      <div className="w-px h-6 bg-gray-200 dark:bg-gray-600" />
      
      {/* 颜色选择按钮 */}
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowColorPicker(!showColorPicker);
          }}
          className="w-8 h-8 rounded-lg border-2 border-gray-200 dark:border-gray-600 hover:border-blue-400 transition-all flex items-center justify-center"
          style={{ backgroundColor: penColor }}
          title="选择颜色"
        >
          <svg 
            width="14" 
            height="14" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke={penColor === '#ffffff' || penColor === '#ffff00' || penColor === '#eab308' || penColor === '#22c55e' || penColor === '#00ff00' ? '#333' : '#fff'} 
            strokeWidth="2"
            className="drop-shadow-sm"
          >
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
          </svg>
        </button>
        
        {/* 调色面板 */}
        {showColorPicker && (
          <div 
            className="absolute top-full left-1/2 -translate-x-1/2 mt-2 p-3 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 z-50 w-[240px]"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* 主色彩预览区 - 渐变选择 */}
            <div 
              className="w-full h-32 rounded-lg cursor-crosshair relative mb-3 overflow-hidden"
              style={{
                background: `linear-gradient(to bottom, transparent, #000), 
                             linear-gradient(to right, #fff, ${penHueColor})`
              }}
              onMouseDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const handleMove = (moveEvent: MouseEvent) => {
                  const x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
                  const y = Math.max(0, Math.min(1, (moveEvent.clientY - rect.top) / rect.height));
                  const saturation = Math.round(x * 100);
                  const brightness = Math.round((1 - y) * 100);
                  setPenSaturation(saturation);
                  setPenBrightness(brightness);
                  updateColorFromHSB(penHue, saturation, brightness);
                };
                handleMove(e.nativeEvent as MouseEvent);
                const handleUp = () => {
                  document.removeEventListener('mousemove', handleMove as any);
                  document.removeEventListener('mouseup', handleUp);
                };
                document.addEventListener('mousemove', handleMove as any);
                document.addEventListener('mouseup', handleUp);
              }}
            >
              {/* 选中位置指示器 */}
              <div 
                className="absolute w-4 h-4 border-2 border-white rounded-full shadow-lg pointer-events-none"
                style={{ 
                  left: `${penSaturation}%`, 
                  top: `${100 - penBrightness}%`,
                  transform: 'translate(-50%, -50%)',
                  backgroundColor: penColor
                }}
              />
            </div>
            
            {/* 色相选择条 */}
            <div className="mb-3">
              <div 
                className="w-full h-3 rounded-lg cursor-pointer relative"
                style={{
                  background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)'
                }}
                onMouseDown={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const handleMove = (moveEvent: MouseEvent) => {
                    const x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
                    const hue = Math.round(x * 360);
                    setPenHue(hue);
                    updateColorFromHSB(hue, penSaturation, penBrightness);
                  };
                  handleMove(e.nativeEvent as MouseEvent);
                  const handleUp = () => {
                    document.removeEventListener('mousemove', handleMove as any);
                    document.removeEventListener('mouseup', handleUp);
                  };
                  document.addEventListener('mousemove', handleMove as any);
                  document.addEventListener('mouseup', handleUp);
                }}
              >
                {/* 色相指示器 */}
                <div 
                  className="absolute w-3 h-3 bg-white border-2 border-gray-400 rounded-full shadow pointer-events-none"
                  style={{ 
                    left: `${penHue / 360 * 100}%`, 
                    top: '50%',
                    transform: 'translate(-50%, -50%)'
                  }}
                />
              </div>
            </div>
            
            {/* 明度/透明度选择条 */}
            <div className="mb-3">
              <div 
                className="w-full h-3 rounded-lg cursor-pointer relative"
                style={{
                  background: `linear-gradient(to right, ${penColor}, transparent)`,
                  backgroundColor: '#f0f0f0',
                  backgroundImage: 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%)',
                  backgroundSize: '8px 8px'
                }}
                onMouseDown={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const handleMove = (moveEvent: MouseEvent) => {
                    const x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
                    setPenOpacity(Math.round((1 - x) * 100));
                  };
                  handleMove(e.nativeEvent as MouseEvent);
                  const handleUp = () => {
                    document.removeEventListener('mousemove', handleMove as any);
                    document.removeEventListener('mouseup', handleUp);
                  };
                  document.addEventListener('mousemove', handleMove as any);
                  document.addEventListener('mouseup', handleUp);
                }}
              >
                {/* 透明度指示器 */}
                <div 
                  className="absolute w-3 h-3 bg-white border-2 border-gray-400 rounded-full shadow pointer-events-none"
                  style={{ 
                    left: `${(1 - penOpacity / 100) * 100}%`, 
                    top: '50%',
                    transform: 'translate(-50%, -50%)'
                  }}
                />
              </div>
            </div>
            
            {/* 底部功能区 */}
            <div className="flex items-center justify-between gap-2">
              {/* 左侧：重置按钮 + 预设色 */}
              <div className="flex items-center gap-1">
                {/* 重置按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPenColor('#000000');
                    setPenHue(0);
                    setPenSaturation(0);
                    setPenBrightness(0);
                  }}
                  className="w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-100"
                  title="重置颜色"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="4" y1="4" x2="20" y2="20"/>
                  </svg>
                </button>
                {/* 预设色 */}
                {['#000000', '#ffffff', '#00ff00', '#9955ff', '#e6ddff'].map((color) => (
                  <button
                    key={color}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPenColor(color);
                      const { h, s, b } = hexToHSB(color);
                      setPenHue(h);
                      setPenSaturation(s);
                      setPenBrightness(b);
                    }}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${
                      penColor.toLowerCase() === color.toLowerCase() 
                        ? 'border-blue-500 scale-110' 
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                    style={{ 
                      backgroundColor: color,
                      boxShadow: color === '#ffffff' ? 'inset 0 0 0 1px rgba(0,0,0,0.1)' : undefined
                    }}
                  />
                ))}
              </div>
              
              {/* 右侧：HEX输入 + 透明度 */}
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={penColor}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                      setPenColor(val);
                      if (val.length === 7) {
                        const { h, s, b } = hexToHSB(val);
                        setPenHue(h);
                        setPenSaturation(s);
                        setPenBrightness(b);
                      }
                    }
                  }}
                  className="w-16 px-1 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 导出工具函数供外部使用
export { hexToHSB, hsbToHex };

'use client';

import React from 'react';
import { CanvasElement } from '@/types/canvas';

// 字体列表
const fontFamilies = [
  { name: '默认', value: 'PingFang SC, Microsoft YaHei, sans-serif' },
  { name: '黑体', value: 'SimHei, Heiti SC, sans-serif' },
  { name: '宋体', value: 'SimSun, Songti SC, serif' },
  { name: '楷体', value: 'KaiTi, KaiTi_GB2312, serif' },
  { name: '仿宋', value: 'FangSong, FangSong_GB2312, serif' },
  { name: 'Arial', value: 'Arial, sans-serif' },
  { name: 'Times', value: 'Times New Roman, serif' },
  { name: 'Courier', value: 'Courier New, monospace' },
  { name: 'Georgia', value: 'Georgia, serif' },
  { name: 'Verdana', value: 'Verdana, sans-serif' },
];

// 字号列表
const fontSizes = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 96, 120];

// 预设颜色
const presetColors = [
  '#000000', '#333333', '#666666', '#999999', '#CCCCCC', '#FFFFFF',
  '#FF0000', '#FF6600', '#FFCC00', '#00CC00', '#0066FF', '#9900FF',
  '#FF00FF', '#00CCCC', '#FF6666', '#66CC66', '#6666FF', '#FF66FF',
];

// 样式按钮组件
const StyleButton = ({ 
  active, 
  onClick, 
  children, 
  title 
}: { 
  active?: boolean; 
  onClick: () => void; 
  children: React.ReactNode;
  title: string;
}) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    title={title}
    style={{
      width: 32,
      height: 32,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: 'none',
      background: active ? 'rgba(0, 122, 255, 0.15)' : 'transparent',
      borderRadius: 6,
      cursor: 'pointer',
      color: active ? '#007AFF' : '#333',
      transition: 'all 0.15s ease',
    }}
  >
    {children}
  </button>
);

// 分隔线
const Divider = () => (
  <div style={{ width: 1, height: 24, backgroundColor: '#E5E5E5', margin: '0 4px' }} />
);

interface TextToolbarProps {
  selectedTextEl: CanvasElement;
  onUpdateElement: (id: string, updates: Partial<CanvasElement>) => void;
  onDeleteElement: (id: string) => void;
  toolbarCenterX: number;
  toolbarTopY: number;
}

export default function TextToolbar({
  selectedTextEl,
  onUpdateElement,
  onDeleteElement,
  toolbarCenterX,
  toolbarTopY,
}: TextToolbarProps) {
  return (
    <div 
      className="absolute z-[200]"
      data-text-toolbar="true"
      data-toolbar="true"
      style={{ 
        left: toolbarCenterX, 
        top: toolbarTopY,
        transform: 'translate(-50%, 0)',
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => { 
        e.stopPropagation(); 
        e.preventDefault();
        e.nativeEvent.stopImmediatePropagation?.();
      }}
      onClick={(e) => { 
        e.stopPropagation(); 
        e.nativeEvent.stopImmediatePropagation?.();
      }}
      onPointerDown={(e) => { 
        e.stopPropagation(); 
        e.nativeEvent.stopImmediatePropagation?.();
      }}
    >
      <div 
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '6px 8px',
          background: 'linear-gradient(180deg, #FFFFFF 0%, #FAFAFA 100%)',
          borderRadius: 12,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08)',
          border: '1px solid rgba(0, 0, 0, 0.06)',
          whiteSpace: 'nowrap',
        }}
      >
        {/* 字体选择 */}
        <select
          value={selectedTextEl.fontFamily || 'PingFang SC, Microsoft YaHei, sans-serif'}
          onChange={(e) => {
            onUpdateElement(selectedTextEl.id, { fontFamily: e.target.value });
          }}
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #E5E5E5',
            fontSize: 13,
            background: '#FFF',
            cursor: 'pointer',
            minWidth: 90,
            outline: 'none',
          }}
        >
          {fontFamilies.map(font => (
            <option key={font.value} value={font.value}>{font.name}</option>
          ))}
        </select>
        
        <Divider />
        
        {/* 字号选择 */}
        <select
          value={selectedTextEl.fontSize || 24}
          onChange={(e) => {
            const newFontSize = Number(e.target.value);
            onUpdateElement(selectedTextEl.id, { fontSize: newFontSize });
          }}
          style={{
            padding: '6px 8px',
            borderRadius: 6,
            border: '1px solid #E5E5E5',
            fontSize: 13,
            background: '#FFF',
            cursor: 'pointer',
            width: 65,
            outline: 'none',
          }}
        >
          {fontSizes.map(size => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
        
        <Divider />
        
        {/* 粗体 */}
        <StyleButton
          active={selectedTextEl.fontWeight === 'bold'}
          onClick={() => {
            onUpdateElement(selectedTextEl.id, { 
              fontWeight: selectedTextEl.fontWeight === 'bold' ? 'normal' : 'bold' 
            });
          }}
          title="粗体"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/>
          </svg>
        </StyleButton>
        
        {/* 斜体 */}
        <StyleButton
          active={selectedTextEl.fontStyle === 'italic'}
          onClick={() => {
            onUpdateElement(selectedTextEl.id, { 
              fontStyle: selectedTextEl.fontStyle === 'italic' ? 'normal' : 'italic' 
            });
          }}
          title="斜体"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/>
          </svg>
        </StyleButton>
        
        {/* 下划线 */}
        <StyleButton
          active={selectedTextEl.textDecoration === 'underline'}
          onClick={() => {
            const current = selectedTextEl.textDecoration;
            let newValue: 'none' | 'underline' | 'line-through' = 'none';
            if (current !== 'underline') newValue = 'underline';
            onUpdateElement(selectedTextEl.id, { textDecoration: newValue });
          }}
          title="下划线"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z"/>
          </svg>
        </StyleButton>
        
        {/* 删除线 */}
        <StyleButton
          active={selectedTextEl.textDecoration === 'line-through'}
          onClick={() => {
            const current = selectedTextEl.textDecoration;
            let newValue: 'none' | 'underline' | 'line-through' = 'none';
            if (current !== 'line-through') newValue = 'line-through';
            onUpdateElement(selectedTextEl.id, { textDecoration: newValue });
          }}
          title="删除线"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z"/>
          </svg>
        </StyleButton>
        
        <Divider />
        
        {/* 左对齐 */}
        <StyleButton
          active={selectedTextEl.textAlign === 'left' || !selectedTextEl.textAlign}
          onClick={() => {
            onUpdateElement(selectedTextEl.id, { textAlign: 'left' });
          }}
          title="左对齐"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z"/>
          </svg>
        </StyleButton>
        
        {/* 居中对齐 */}
        <StyleButton
          active={selectedTextEl.textAlign === 'center'}
          onClick={() => {
            onUpdateElement(selectedTextEl.id, { textAlign: 'center' });
          }}
          title="居中"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z"/>
          </svg>
        </StyleButton>
        
        {/* 右对齐 */}
        <StyleButton
          active={selectedTextEl.textAlign === 'right'}
          onClick={() => {
            onUpdateElement(selectedTextEl.id, { textAlign: 'right' });
          }}
          title="右对齐"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 21h18v-2H3v2zm6-4h12v-2H9v2zm-6-4h18v-2H3v2zm6-4h12V7H9v2zM3 3v2h18V3H3z"/>
          </svg>
        </StyleButton>
        
        <Divider />
        
        {/* 文字颜色 */}
        <div style={{ position: 'relative' }}>
          <div 
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              cursor: 'pointer',
              background: 'transparent',
            }}
            title="文字颜色"
          >
            <div style={{ position: 'relative' }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: selectedTextEl.color || '#000' }}>A</span>
              <div 
                style={{ 
                  position: 'absolute', 
                  bottom: -3, 
                  left: -2, 
                  right: -2, 
                  height: 3, 
                  borderRadius: 2,
                  backgroundColor: selectedTextEl.color || '#000' 
                }} 
              />
            </div>
          </div>
          <input
            type="color"
            value={selectedTextEl.color || '#000000'}
            onChange={(e) => {
              onUpdateElement(selectedTextEl.id, { color: e.target.value });
            }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 32,
              height: 32,
              opacity: 0,
              cursor: 'pointer',
            }}
          />
        </div>
        
        {/* 预设颜色 */}
        <div 
          style={{ 
            display: 'flex', 
            gap: 2, 
            padding: '4px 6px',
            background: '#F5F5F5',
            borderRadius: 8,
          }}
        >
          {presetColors.slice(0, 8).map(color => (
            <button
              key={color}
              onClick={() => {
                onUpdateElement(selectedTextEl.id, { color });
              }}
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                backgroundColor: color,
                border: selectedTextEl.color === color ? '2px solid #007AFF' : '1px solid rgba(0,0,0,0.1)',
                cursor: 'pointer',
                boxShadow: selectedTextEl.color === color ? '0 0 0 2px rgba(0,122,255,0.2)' : 'none',
              }}
              title={color}
            />
          ))}
        </div>
        
        <Divider />
        
        {/* 删除 */}
        <button 
          onClick={(e) => { 
            e.stopPropagation(); 
            onDeleteElement(selectedTextEl.id);
          }}
          title="删除"
          style={{ 
            width: 32,
            height: 32,
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            border: 'none', 
            background: 'transparent', 
            borderRadius: 6, 
            cursor: 'pointer', 
            color: '#FF3B30',
            transition: 'background-color 0.15s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 59, 48, 0.1)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// 导出工具栏常量供外部使用
export const TEXT_TOOLBAR_HEIGHT = 48;
export const TEXT_TOOLBAR_GAP = 35; // 增加间距到35px，确保工具栏在Fabric.js选中框（cornerSize=12）上方，不遮挡文字
export const TEXT_TOOLBAR_WIDTH = 520;

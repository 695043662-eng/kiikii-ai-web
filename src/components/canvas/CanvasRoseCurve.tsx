'use client';

import { useEffect, useRef, memo, useState, useCallback } from 'react';

interface CanvasRoseCurveProps {
  color?: string;
  className?: string;
  showDetail?: boolean;
  gradientBg?: boolean;
  /** #678 外部进度覆盖（0-100），传入后覆盖内部循环的进度条宽度和百分比数字，动画不变 */
  externalProgress?: number;
}

/**
 * 画布页面专用玫瑰曲线动画
 * - 用 ResizeObserver 获取容器尺寸，按比例计算所有元素大小（与原占位符一致）
 * - 容器太小时自动隐藏细节
 */
const CanvasRoseCurve = memo(function CanvasRoseCurve({ color = '#e84393', className = '', showDetail = false, gradientBg = true, externalProgress }: CanvasRoseCurveProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const pctRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<SVGCircleElement[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState({ minDim: 200, w: 200, h: 200 });
  // #690 修复：用 ref 桥接 externalProgress，避免 useEffect 闭包锁死初始值
  const externalProgressRef = useRef(externalProgress);
  externalProgressRef.current = externalProgress;

  const updateSizes = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    // 用 offsetWidth/offsetHeight 获取布局尺寸（不受父级 transform 缩放影响）
    setSizes({
      minDim: Math.min(el.offsetWidth, el.offsetHeight),
      w: el.offsetWidth,
      h: el.offsetHeight,
    });
  }, []);

  // 监听容器大小变化
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    updateSizes();
    const observer = new ResizeObserver(updateSizes);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateSizes]);

  // 按比例计算样式（与原占位符一致：minDim * 比例）
  const { minDim, w, h } = sizes;
  const svgSize = Math.max(20, minDim * 0.45);          // SVG 占最小边 45%
  const titleFont = Math.max(7, minDim * 0.04);          // 标题字号 占 4%
  const subFont = Math.max(5, minDim * 0.025);          // 副标题字号 占 2.5%
  const pctFont = Math.max(7, minDim * 0.042);          // 百分比字号 占 4.2%（原2.8%，放大50%）
  const barHeight = Math.max(1, minDim * 0.008);        // 进度条高度 占 0.8%
  const barWidth = Math.max(24, w * 0.44);              // 进度条宽度 占容器宽 44%
  const gap = Math.max(2, minDim * 0.02);               // 间距 占 2%
  const showSubText = minDim > 80;                       // 太小隐藏副标题
  const showDetailSection = showDetail && minDim > 50;   // 极小时隐藏所有细节

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const group = svg.querySelector('#canvas-rose-group') as SVGGElement;
    const path = svg.querySelector('#canvas-rose-path') as SVGPathElement;
    const fill = fillRef.current;
    const pct = pctRef.current;
    if (!group || !path) return;

    path.setAttribute('stroke', color);

    const NS = 'http://www.w3.org/2000/svg';
    const particles: SVGCircleElement[] = [];
    const particleCount = 64;
    for (let i = 0; i < particleCount; i++) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('fill', color);
      group.appendChild(c);
      particles.push(c);
    }
    particlesRef.current = particles;

    const cfg = {
      trailSpan: 0.28,
      durationMs: 24000,  // 进度条周期 24秒（改慢1倍，原12000）
      rotationDurationMs: 20000,
      pulseDurationMs: 3200,
      roseA: 9.2,
      roseABoost: 0.6,
      roseBreathBase: 0.72,
      roseBreathBoost: 0.28,
      roseK: 5,
      roseScale: 3.0,
    };

    function rosePoint(p: number, d: number) {
      const t = p * Math.PI * 2;
      const a = cfg.roseA + d * cfg.roseABoost;
      const r = a * (cfg.roseBreathBase + d * cfg.roseBreathBoost) * Math.cos(Math.round(cfg.roseK) * t);
      return { x: 50 + Math.cos(t) * r * cfg.roseScale, y: 50 + Math.sin(t) * r * cfg.roseScale };
    }

    function norm(p: number) { return ((p % 1) + 1) % 1; }

    function ds(t: number) {
      const p = (t % cfg.pulseDurationMs) / cfg.pulseDurationMs;
      return 0.55 + ((Math.sin(p * Math.PI * 2 + 0.55) + 1) / 2) * 0.45;
    }

    function rot(t: number) {
      return -((t % cfg.rotationDurationMs) / cfg.rotationDurationMs) * 360;
    }

    function bp(d: number, s: number) {
      const pts: string[] = [];
      for (let i = 0; i <= s; i++) {
        const pt = rosePoint(i / s, d);
        pts.push((i === 0 ? 'M' : 'L') + ' ' + pt.x.toFixed(2) + ' ' + pt.y.toFixed(2));
      }
      return pts.join(' ');
    }

    const st = performance.now();

    function animate() {
      const t = performance.now() - st;
      const p = (t % cfg.durationMs) / cfg.durationMs;
      const d = ds(t);

      group.setAttribute('transform', 'rotate(' + rot(t) + ' 50 50)');
      path.setAttribute('d', bp(d, 360));

      for (let i = 0; i < particleCount; i++) {
        const to = i / (particleCount - 1);
        const pt = rosePoint(norm(p - to * cfg.trailSpan), d);
        const f = Math.pow(1 - to, 0.5);
        particles[i].setAttribute('cx', pt.x.toFixed(2));
        particles[i].setAttribute('cy', pt.y.toFixed(2));
        particles[i].setAttribute('r', (0.8 + f * 2.2).toFixed(2));
        particles[i].setAttribute('opacity', (0.1 + f * 0.9).toFixed(3));
      }

      // #690 修复：从 ref 读取最新 externalProgress，避免闭包锁死
      const latestProgress = externalProgressRef.current;
      if (fill) fill.style.width = (latestProgress !== undefined ? latestProgress : p * 100) + '%';
      if (pct) pct.textContent = (latestProgress !== undefined ? Math.round(latestProgress) : Math.round(p * 100)) + '%';

      animRef.current = requestAnimationFrame(animate);
    }

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      particles.forEach(p => p.remove());
    };
  }, [color]);

  return (
    <div ref={wrapperRef} className={`w-full h-full flex flex-col items-center justify-center relative overflow-hidden ${className}`} style={{ contain: 'strict' }}>
      {/* 渐变闪烁光效 - 直接放在组件内部 */}
      {gradientBg && (
      <div style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
      }}>
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '50%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(147, 197, 253, 0.3), transparent)',
          animation: 'canvasRoseShimmer 2.5s ease-in-out infinite',
        }} />
      </div>
      )}
      {/* 玫瑰曲线 */}
      <div style={{ width: svgSize, height: svgSize, position: 'relative', flexShrink: 0 }}>
        {/* 光晕 - 超出容器范围 */}
        {/* #604 核弹拆除：删除 blur(25px) 模糊滤镜，避免高频 RAF + blur 蹂躏 Chrome 图层合并引擎 */}
        <div
          className="absolute pointer-events-none"
          style={{
            inset: '-20%',
            background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
            opacity: 0.15,  // 略微降低不透明度补偿模糊效果
          }}
        />
        <svg ref={svgRef} viewBox="0 0 100 100" fill="none" className="w-full h-full overflow-visible relative z-[1]">
          <g id="canvas-rose-group">
            <path id="canvas-rose-path" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" />
          </g>
        </svg>
      </div>
      {/* 文字+进度条 - 按比例自适应 */}
      {showDetailSection && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap, marginTop: minDim * 0.06, position: 'relative', zIndex: 1, width: '100%', overflow: 'hidden' }}>
          <div style={{ color, fontSize: titleFont, fontWeight: 'normal', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '80%' }}>Loading</div>
          {showSubText && (
            <div style={{ color, fontSize: subFont, letterSpacing: '0.2em', textTransform: 'uppercase' as const, textAlign: 'center', opacity: 0.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '90%' }}>Rose Curve Animation</div>
          )}
          <div style={{ width: barWidth, height: barHeight, borderRadius: barHeight, overflow: 'hidden', background: `${color}18` }}>
            <div ref={fillRef} style={{ height: '100%', borderRadius: barHeight, background: color, width: '0%', transition: 'width 0.3s ease' }} />
          </div>
          <div ref={pctRef} style={{ color, fontSize: pctFont, opacity: 0.45, fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>0%</div>
        </div>
      )}
    </div>
  );
});

export default CanvasRoseCurve;

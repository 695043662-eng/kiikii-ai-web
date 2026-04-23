'use client';

import { useEffect, useRef, memo } from 'react';

interface RoseCurveProps {
  color?: string;
  className?: string;
  mini?: boolean;
  showDetail?: boolean;
}

const RoseCurveAnimation = memo(function RoseCurveAnimation({ color = '#e84393', className = '', mini = false, showDetail = false }: RoseCurveProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const pctRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<SVGCircleElement[]>([]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const group = svg.querySelector('#rose-group') as SVGGElement;
    const path = svg.querySelector('#rose-path') as SVGPathElement;
    const fill = fillRef.current;
    const pct = pctRef.current;
    if (!group || !path) return;

    path.setAttribute('stroke', color);

    // Create particles
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
      durationMs: 12000,
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

      if (fill) fill.style.width = (p * 100) + '%';
      if (pct) pct.textContent = Math.round(p * 100) + '%';

      animRef.current = requestAnimationFrame(animate);
    }

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      particles.forEach(p => p.remove());
    };
  }, [color]);

  if (mini) {
    return (
      <div className={`flex flex-col items-center justify-center w-full h-full ${className}`}>
        <div className="relative w-full flex-1 min-h-0 flex items-center justify-center">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
              opacity: 0.15,
              filter: 'blur(15px)',
            }}
          />
          <svg ref={svgRef} viewBox="0 0 100 100" fill="none" className="w-[80%] h-[80%] overflow-visible relative z-[1]">
            <g id="rose-group">
              <path id="rose-path" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" />
            </g>
          </svg>
        </div>
        {showDetail && (
          <div className="flex flex-col items-center gap-0.5 relative z-[1] px-1 pb-1 w-full">
            <div className="text-[9px] font-bold truncate w-full text-center" style={{ color: color }}>Loading</div>
            <div className="w-[80%] h-[1.5px] rounded-full overflow-hidden" style={{ background: `${color}18` }}>
              <div ref={fillRef} className="h-full rounded-full" style={{ background: color, width: '0%', transition: 'width 0.3s ease' }} />
            </div>
            <div ref={pctRef} className="text-[8px]" style={{ color: color, opacity: 0.35, fontVariantNumeric: 'tabular-nums' }}>0%</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center w-full h-full ${className}`}>
      <div className="relative w-full max-w-[320px] aspect-square flex items-center justify-center">
        {/* 光晕 */}
        <div
          className="absolute inset-[-20%] pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
            opacity: 0.2,
            filter: 'blur(25px)',
          }}
        />
        <svg ref={svgRef} viewBox="0 0 100 100" fill="none" className="w-full h-full overflow-visible relative z-[1]">
          <g id="rose-group">
            <path id="rose-path" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" />
          </g>
        </svg>
      </div>
      <div className="flex flex-col items-center gap-1 relative z-[1] mt-3">
        <div className="text-lg font-bold" style={{ color: color }}>Loading</div>
        <div className="text-[10px] tracking-[0.2em] uppercase" style={{ color: color, opacity: 0.4 }}>Rose Curve Animation</div>
      </div>
      <div className="w-full max-w-[200px] h-[2px] rounded-full overflow-hidden mt-2 relative z-[1]" style={{ background: `${color}18` }}>
        <div ref={fillRef} className="h-full rounded-full" style={{ background: color, width: '0%', transition: 'width 0.3s ease' }} />
      </div>
      <div ref={pctRef} className="text-[10px] mt-1 relative z-[1]" style={{ color: color, opacity: 0.35, fontVariantNumeric: 'tabular-nums' }}>0%</div>
    </div>
  );
});

export default RoseCurveAnimation;

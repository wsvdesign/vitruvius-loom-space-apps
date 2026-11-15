/* Parallax: where the visitor is looking, roughly. Pointer position (or device tilt on a phone/iPad),
   eased, in −1…1 on each axis. Written to CSS variables --px / --py for the glass layers, and read
   directly by the 3D scenes so the world moves a little against the glass. */

export const look = { x: 0, y: 0 };

export function startParallax() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const target = { x: 0, y: 0 };
  let raf = 0;
  const root = document.documentElement;

  const onMove = (e: PointerEvent) => {
    target.x = (e.clientX / window.innerWidth) * 2 - 1;
    target.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  const onTilt = (e: DeviceOrientationEvent) => {
    if (e.gamma == null || e.beta == null) return;
    target.x = Math.max(-1, Math.min(1, e.gamma / 25));
    target.y = Math.max(-1, Math.min(1, (e.beta - 45) / 25));
  };
  const tick = () => {
    const k = reduce.matches ? 1 : 0.08;
    const tx = reduce.matches ? 0 : target.x;
    const ty = reduce.matches ? 0 : target.y;
    const dx = tx - look.x;
    const dy = ty - look.y;
    // settle instead of creeping forever: saves work and lets things hold still
    if (Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005) {
      look.x += dx * k;
      look.y += dy * k;
      root.style.setProperty('--px', look.x.toFixed(4));
      root.style.setProperty('--py', look.y.toFixed(4));
    }
    raf = requestAnimationFrame(tick);
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('deviceorientation', onTilt, { passive: true });
  tick();
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('deviceorientation', onTilt);
  };
}

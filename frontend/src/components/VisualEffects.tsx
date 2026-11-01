import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";

const preferenceKey = "afterbuy.visual-effects";

export function VisualEffects() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(preferenceKey) !== "off";
    } catch {
      return true;
    }
  });
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const trail = useRef<HTMLDivElement>(null);
  const active = enabled && !reduced;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.visualEffects = active ? "on" : "off";
    try {
      localStorage.setItem(preferenceKey, enabled ? "on" : "off");
    } catch {
      /* Private browsing may disable storage. */
    }
    return () => {
      delete document.documentElement.dataset.visualEffects;
    };
  }, [enabled, active]);

  useEffect(() => {
    if (!active || !trail.current) return;
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const layer = trail.current;
    const dots = Array.from(layer.children) as HTMLElement[];
    const positions = dots.map(() => ({ x: 0, y: 0 }));
    let target = { x: 0, y: 0 };
    let frame = 0;
    let initialized = false;
    let card: HTMLElement | null = null;
    let previousTime = 0;
    const clearCard = () => {
      card?.removeAttribute("data-pointer-lit");
      card = null;
    };
    const draw = (time: number) => {
      const elapsed = Math.min(previousTime ? time - previousTime : 16.7, 40);
      previousTime = time;
      let moving = false;
      positions.forEach((position, index) => {
        const follow = 1 - Math.exp(-elapsed / (45 + index * 40));
        position.x += (target.x - position.x) * follow;
        position.y += (target.y - position.y) * follow;
        dots[index].style.transform =
          `translate3d(${position.x}px, ${position.y}px, 0)`;
        if (
          Math.abs(target.x - position.x) + Math.abs(target.y - position.y) >
          0.3
        )
          moving = true;
      });
      // Stop requesting frames as soon as the trail settles.
      frame = moving ? requestAnimationFrame(draw) : 0;
    };
    const hide = () => {
      layer.removeAttribute("data-visible");
      clearCard();
      cancelAnimationFrame(frame);
      frame = 0;
      initialized = false;
      previousTime = 0;
    };
    const move = (event: PointerEvent) => {
      if (!pointer.matches || event.pointerType !== "mouse") {
        hide();
        return;
      }
      target = { x: event.clientX, y: event.clientY };
      if (!initialized) {
        positions.forEach((p) => {
          p.x = target.x;
          p.y = target.y;
        });
        initialized = true;
      }
      layer.dataset.visible = "true";
      const next =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(
              ".metric, .product-card, .dashboard-hero, .getting-started",
            )
          : null;
      if (next !== card) {
        clearCard();
        card = next;
      }
      if (card) {
        const bounds = card.getBoundingClientRect();
        card.style.setProperty(
          "--pointer-x",
          `${event.clientX - bounds.left}px`,
        );
        card.style.setProperty(
          "--pointer-y",
          `${event.clientY - bounds.top}px`,
        );
        card.dataset.pointerLit = "true";
      }
      if (!frame) {
        previousTime = 0;
        frame = requestAnimationFrame(draw);
      }
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("blur", hide);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    document.documentElement.addEventListener("pointerleave", hide);
    document.addEventListener("visibilitychange", hide);
    pointer.addEventListener("change", hide);
    return () => {
      hide();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("blur", hide);
      window.removeEventListener("scroll", hide, true);
      document.documentElement.removeEventListener("pointerleave", hide);
      document.removeEventListener("visibilitychange", hide);
      pointer.removeEventListener("change", hide);
    };
  }, [active]);

  return (
    <>
      <button
        className="icon-button effects-toggle"
        aria-label="Visual effects"
        aria-pressed={active}
        disabled={reduced}
        title={
          reduced
            ? "Reduced motion is enabled on your device"
            : active
              ? "Turn off visual effects"
              : "Turn on visual effects"
        }
        onClick={() => setEnabled((value) => !value)}
      >
        <Sparkles size={18} />
      </button>
      {active &&
        createPortal(
          <div ref={trail} className="pointer-trail" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>,
          document.body,
        )}
    </>
  );
}

import { useCallback } from 'react';
import { useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'motion/react';

const SPOTLIGHT_SIZE = 224;

/** Tracks a soft pointer highlight without routing pointer movement through React state. */
export function usePointerSpotlight() {
  const reduceMotion = useReducedMotion();
  const targetX = useMotionValue(-SPOTLIGHT_SIZE / 2);
  const targetY = useMotionValue(-SPOTLIGHT_SIZE / 2);
  const x = useSpring(targetX, { type: 'spring', duration: 0.5, bounce: 0.2 });
  const y = useSpring(targetY, { type: 'spring', duration: 0.5, bounce: 0.2 });
  const transform = useMotionTemplate`translate3d(${x}px, ${y}px, 0)`;

  const onPointerMove = useCallback((event) => {
    if (reduceMotion || event.pointerType !== 'mouse') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    targetX.set(event.clientX - bounds.left - SPOTLIGHT_SIZE / 2);
    targetY.set(event.clientY - bounds.top - SPOTLIGHT_SIZE / 2);
    event.currentTarget.dataset.pointerActive = 'true';
  }, [reduceMotion, targetX, targetY]);

  const onPointerLeave = useCallback((event) => {
    delete event.currentTarget.dataset.pointerActive;
  }, []);

  return { transform, onPointerMove, onPointerLeave };
}

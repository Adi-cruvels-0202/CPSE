import React, { useEffect, useState } from 'react';

/**
 * LiquidGlass SVG Filter — provides refractive glass effect via SVG displacement.
 * Automatically falls back to CSS backdrop-filter blur on non-Chromium browsers.
 * Renders an invisible SVG filter definition that glass CSS classes reference.
 */
export default function LiquidGlass() {
  const [supportsRefraction, setSupportsRefraction] = useState(false);

  useEffect(() => {
    // Feature detect: Chromium supports backdrop-filter with SVG filter reference
    const isChromium = !!(window as any).chrome;
    setSupportsRefraction(isChromium);

    if (isChromium) {
      document.documentElement.classList.add('glass-refraction');
    }
  }, []);

  return (
    <svg
      width="0"
      height="0"
      style={{ position: 'absolute', pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <defs>
        <filter id="liquid-glass-filter" x="-10%" y="-10%" width="120%" height="120%">
          {/* Create a turbulence pattern for subtle displacement */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.015"
            numOctaves="3"
            seed="2"
            result="noise"
          />
          {/* Displace the source graphic using the noise pattern */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={supportsRefraction ? 6 : 0}
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced"
          />
          {/* Gaussian blur for frosted effect */}
          <feGaussianBlur in="displaced" stdDeviation="1" result="blurred" />
          {/* Composite with original */}
          <feMerge>
            <feMergeNode in="blurred" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'inverse' | 'mono';
  className?: string;
}

const sizes = {
  sm: 'text-md',
  md: 'text-xl',
  lg: 'text-2xl',
  xl: 'text-4xl',
};

export default function Logo({ size = 'md', variant = 'default', className = '' }: LogoProps) {
  const fontSize = sizes[size];
  const navyColor = variant === 'inverse' ? '#F3E4C9' : variant === 'mono' ? 'currentColor' : '#0A2947';
  const brownColor = variant === 'inverse' ? '#FFFFFF' : variant === 'mono' ? 'currentColor' : '#8B5E3C';

  return (
    <span
      className={`brand ${className}`}
      style={{ fontFamily: "'Stardom', sans-serif", fontSize: `calc(var(--${fontSize}) * 1.25)`, display: 'inline-flex', alignItems: 'baseline', gap: '1px', lineHeight: 1 }}
      aria-label="Merchant One"
    >
      <span style={{ color: navyColor }}>Merchant</span>
      <span style={{ color: brownColor }}>&nbsp;One</span>
    </span>
  );
}

import React from 'react';
import { Image } from '@/components/ui/image';

export const BRAND_ICON = '/brand-icon.png';

export default function BrandLogo({ size = 36, showSubtitle = true, subtitle = 'AI电影提示词增强工作台', titleClass = 'font-semibold text-base', className = '' }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Image
        src={BRAND_ICON}
        alt="影词模方"
        className="shrink-0 rounded-[10px] ring-1 ring-black/5"
        style={{ width: size, height: size }}
      />
      <div className="leading-none">
        <span className={`${titleClass} tracking-tight`}>影词模方</span>
        {showSubtitle && <p className="text-[10px] text-muted-foreground mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}
import { BrandClaude } from 'pulsoicon-react/icons/brand-claude';
import { BrandDeepseek } from 'pulsoicon-react/icons/brand-deepseek';
import { BrandGemini } from 'pulsoicon-react/icons/brand-gemini';
import { BrandGrok } from 'pulsoicon-react/icons/brand-grok';
import { BrandKimi } from 'pulsoicon-react/icons/brand-kimi';
import { BrandOpenai } from 'pulsoicon-react/icons/brand-openai';
import { BrandOpencode } from 'pulsoicon-react/icons/brand-opencode';
import { BrandQwen } from 'pulsoicon-react/icons/brand-qwen';
import { ChevronRight } from 'pulsoicon-react/icons/chevron-right';
import type { ProviderId } from '@inova/core/types';

type BadgeSize = 16 | 18 | 20 | 24 | 28;

const ICON_SIZE: Record<BadgeSize, number> = {
  16: 11,
  18: 13,
  20: 14,
  24: 17,
  28: 20,
};

function ProviderGlyph({ provider, size }: { provider: ProviderId | null; size: number }) {
  switch (provider) {
    case 'claude':
      return <BrandClaude size={size} strokeWidth={2} />;
    case 'codex':
      return <BrandOpenai size={size} strokeWidth={1.8} />;
    case 'gemini':
      return <BrandGemini size={size} strokeWidth={1.9} />;
    case 'deepseek':
      return <BrandDeepseek size={size} strokeWidth={1.8} />;
    case 'kimi':
      return <BrandKimi size={size} strokeWidth={1.9} />;
    case 'grok':
      return <BrandGrok size={size} strokeWidth={1.9} />;
    case 'qwen':
      return <BrandQwen size={size} strokeWidth={1.9} />;
    case 'opencode':
      return <BrandOpencode size={size} strokeWidth={1.9} />;
    case null:
      return <ChevronRight size={size} strokeWidth={2} />;
  }
}

export function ProviderBadge(props: { provider: ProviderId | null; size?: BadgeSize }) {
  const { provider, size = 20 } = props;
  return (
    <span
      aria-hidden="true"
      className={`provider-badge provider-badge-${size} provider-${provider ?? 'none'}`}
    >
      <ProviderGlyph provider={provider} size={ICON_SIZE[size]} />
    </span>
  );
}

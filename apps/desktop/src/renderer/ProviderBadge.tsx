import type { ProviderId } from '@inova/core/types';
import { PROVIDER_LETTER } from './provider-meta';

export function ProviderBadge(props: {
  provider: ProviderId | null;
  size?: 16 | 18 | 20 | 24 | 28;
}) {
  const { provider, size = 20 } = props;
  return (
    <span
      aria-hidden="true"
      className={`provider-badge provider-badge-${size} provider-${provider ?? 'none'}`}
    >
      {provider ? PROVIDER_LETTER[provider] : '›'}
    </span>
  );
}

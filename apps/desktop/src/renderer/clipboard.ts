export const COPY_FAILED_MESSAGE = 'Não foi possível copiar para a área de transferência.';

export async function copyToClipboard(input: {
  text: string;
  onError: (message: string) => void;
}): Promise<void> {
  try {
    await navigator.clipboard.writeText(input.text);
  } catch (error: unknown) {
    console.error('inova: clipboard write failed', error);
    input.onError(COPY_FAILED_MESSAGE);
  }
}

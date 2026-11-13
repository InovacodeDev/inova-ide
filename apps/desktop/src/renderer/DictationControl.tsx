import { useEffect, useRef } from 'react';
import { MicIcon } from './icons';
import { ANALYSER_FFT_SIZE, type Dictation } from './useDictation';
import { barHeights, WAVEFORM_BARS } from './waveform';

const CANVAS_WIDTH = 80;
const CANVAS_HEIGHT = 20;
const BAR_GAP = 2;
const REST_LEVELS = new Array<number>(WAVEFORM_BARS).fill(0);

function drawBars(input: {
  context: CanvasRenderingContext2D;
  heights: readonly number[];
  color: string;
  ratio: number;
}) {
  const { context, heights, color, ratio } = input;
  const width = CANVAS_WIDTH * ratio;
  const height = CANVAS_HEIGHT * ratio;
  const gap = BAR_GAP * ratio;
  const barWidth = (width - gap * (heights.length - 1)) / heights.length;
  context.clearRect(0, 0, width, height);
  context.fillStyle = color;
  heights.forEach((level, index) => {
    const barHeight = Math.max(2 * ratio, level * height);
    context.fillRect(index * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight);
  });
}

function VoiceWaveform({ getLevels }: { getLevels: Dictation['getLevels'] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d') ?? null;
    if (canvas === null || context === null) return undefined;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = CANVAS_WIDTH * ratio;
    canvas.height = CANVAS_HEIGHT * ratio;
    const color = getComputedStyle(canvas).color;
    const samples = new Uint8Array(ANALYSER_FFT_SIZE);
    let frame = 0;
    const tick = () => {
      const heights = getLevels(samples)
        ? barHeights({ samples, bars: WAVEFORM_BARS })
        : REST_LEVELS;
      drawBars({ context, heights, color, ratio });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getLevels]);

  return (
    <canvas
      ref={canvasRef}
      className="chat-waveform"
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      aria-hidden="true"
    />
  );
}

function ListeningIcon() {
  return (
    <span className="chat-listening" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

export function DictationControl({ dictation }: { dictation: Dictation }) {
  const recording = dictation.phase === 'recording';
  const label = recording ? 'Parar ditado e transcrever' : 'Ditar mensagem';
  return (
    <>
      {recording ? <VoiceWaveform getLevels={dictation.getLevels} /> : null}
      <button
        type="button"
        className={recording ? 'chat-mic chat-mic-recording' : 'chat-mic'}
        aria-label={label}
        title={label}
        aria-pressed={recording}
        disabled={dictation.phase !== 'idle' && !recording}
        onClick={dictation.toggle}
      >
        {recording ? <ListeningIcon /> : <MicIcon size={16} />}
      </button>
    </>
  );
}

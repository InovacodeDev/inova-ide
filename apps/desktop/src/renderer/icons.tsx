import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
}

interface FrameProps extends IconProps {
  strokeWidth?: number;
  round?: boolean;
  children: ReactNode;
}

function Frame({ size = 16, strokeWidth = 1.6, round = true, children }: FrameProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap={round ? 'round' : undefined}
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function LogoIcon({ size }: IconProps) {
  return (
    <Frame size={size} strokeWidth={2.2}>
      <path d="M3.5 7l5 5-5 5" />
      <path d="M11.5 12h3M14.5 12l4.5-5.5M14.5 12h5.5M14.5 12l4.5 5.5" />
    </Frame>
  );
}

export function PlusIcon({ size }: IconProps) {
  return (
    <Frame size={size} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </Frame>
  );
}

export function ChatIcon({ size }: IconProps) {
  return (
    <Frame size={size} round={false}>
      <path d="M4 12a8 8 0 1 1 3.5 6.6L4 20l1.2-3.6A8 8 0 0 1 4 12z" />
    </Frame>
  );
}

export function GridIcon({ size }: IconProps) {
  return (
    <Frame size={size} round={false}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Frame>
  );
}

export function KeyIcon({ size }: IconProps) {
  return (
    <Frame size={size}>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8-8M16 7l2 2M14 9l2 2" />
    </Frame>
  );
}

export function FolderIcon({ size }: IconProps) {
  return (
    <Frame size={size} round={false}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Frame>
  );
}

export function CheckIcon({ size }: IconProps) {
  return (
    <Frame size={size} strokeWidth={2.4}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Frame>
  );
}

export function AlertIcon({ size }: IconProps) {
  return (
    <Frame size={size} strokeWidth={1.8}>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17v.5" />
    </Frame>
  );
}

export function StopIcon({ size }: IconProps) {
  return (
    <Frame size={size} round={false}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Frame>
  );
}

export function SendIcon({ size }: IconProps) {
  return (
    <Frame size={size} strokeWidth={2.2}>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </Frame>
  );
}

export function TerminalIcon({ size }: IconProps) {
  return (
    <Frame size={size}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M7 10l3 2.5L7 15M12.5 15H17" />
    </Frame>
  );
}

export function CloseIcon({ size }: IconProps) {
  return (
    <Frame size={size} strokeWidth={2}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Frame>
  );
}

export function FileIcon({ size }: IconProps) {
  return (
    <Frame size={size} round={false}>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
    </Frame>
  );
}

export function PencilIcon({ size }: IconProps) {
  return (
    <Frame size={size}>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
    </Frame>
  );
}

export function ChevronDownIcon({ size }: IconProps) {
  return (
    <Frame size={size} strokeWidth={2}>
      <path d="M7 10l5 5 5-5" />
    </Frame>
  );
}

export function ChevronRightIcon({ size }: IconProps) {
  return (
    <Frame size={size}>
      <path d="M10 7l5 5-5 5" />
    </Frame>
  );
}

export function ArchiveIcon({ size }: IconProps) {
  return (
    <Frame size={size}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4" />
    </Frame>
  );
}

export function TrashIcon({ size }: IconProps) {
  return (
    <Frame size={size}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </Frame>
  );
}

export function RefreshIcon({ size }: IconProps) {
  return (
    <Frame size={size}>
      <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" />
    </Frame>
  );
}

export function CopyIcon({ size }: IconProps) {
  return (
    <Frame size={size}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Frame>
  );
}

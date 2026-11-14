import { Archive } from 'pulsoicon-react/icons/archive';
import { CodeXml } from 'pulsoicon-react/icons/code-xml';
import { FileText } from 'pulsoicon-react/icons/file-text';
import { Image } from 'pulsoicon-react/icons/image';
import { Italic } from 'pulsoicon-react/icons/italic';
import { Link } from 'pulsoicon-react/icons/link';
import { List } from 'pulsoicon-react/icons/list';
import { ListOrdered } from 'pulsoicon-react/icons/list-ordered';
import { Minus } from 'pulsoicon-react/icons/minus';
import { Paperclip } from 'pulsoicon-react/icons/paperclip';
import { Pilcrow } from 'pulsoicon-react/icons/pilcrow';
import { Quote } from 'pulsoicon-react/icons/quote';
import { SquareCode } from 'pulsoicon-react/icons/square-code';
import { Strikethrough } from 'pulsoicon-react/icons/strikethrough';
import { Underline } from 'pulsoicon-react/icons/underline';
import { ArrowLeftRight } from 'pulsoicon-react/icons/arrow-left-right';
import { ArrowRight } from 'pulsoicon-react/icons/arrow-right';
import { Check } from 'pulsoicon-react/icons/check';
import { ChevronDown } from 'pulsoicon-react/icons/chevron-down';
import { ChevronRight } from 'pulsoicon-react/icons/chevron-right';
import { Clock } from 'pulsoicon-react/icons/clock';
import { Copy } from 'pulsoicon-react/icons/copy';
import { Download } from 'pulsoicon-react/icons/download';
import { ExternalLink } from 'pulsoicon-react/icons/external-link';
import { Eye } from 'pulsoicon-react/icons/eye';
import { File } from 'pulsoicon-react/icons/file';
import { Folder } from 'pulsoicon-react/icons/folder';
import { GitBranch } from 'pulsoicon-react/icons/git-branch';
import { GitCompare } from 'pulsoicon-react/icons/git-compare';
import { GitFork } from 'pulsoicon-react/icons/git-fork';
import { Inbox } from 'pulsoicon-react/icons/inbox';
import { Key } from 'pulsoicon-react/icons/key';
import { LayoutGrid } from 'pulsoicon-react/icons/layout-grid';
import { ListTodo } from 'pulsoicon-react/icons/list-todo';
import { Lock } from 'pulsoicon-react/icons/lock';
import { MessageCircle } from 'pulsoicon-react/icons/message-circle';
import { Mic } from 'pulsoicon-react/icons/mic';
import { Pencil } from 'pulsoicon-react/icons/pencil';
import { PanelLeftClose } from 'pulsoicon-react/icons/panel-left-close';
import { PanelLeftOpen } from 'pulsoicon-react/icons/panel-left-open';
import { Play } from 'pulsoicon-react/icons/play';
import { Plus } from 'pulsoicon-react/icons/plus';
import { RefreshCw } from 'pulsoicon-react/icons/refresh-cw';
import { RotateCcw } from 'pulsoicon-react/icons/rotate-ccw';
import { Settings } from 'pulsoicon-react/icons/settings';
import { Shield } from 'pulsoicon-react/icons/shield';
import { ShieldAlert } from 'pulsoicon-react/icons/shield-alert';
import { ShieldCheck } from 'pulsoicon-react/icons/shield-check';
import { SlidersHorizontal } from 'pulsoicon-react/icons/sliders-horizontal';
import { Square } from 'pulsoicon-react/icons/square';
import { Terminal } from 'pulsoicon-react/icons/terminal';
import { ThumbsDown } from 'pulsoicon-react/icons/thumbs-down';
import { ThumbsUp } from 'pulsoicon-react/icons/thumbs-up';
import { Trash } from 'pulsoicon-react/icons/trash';
import { TriangleAlert } from 'pulsoicon-react/icons/triangle-alert';
import { X } from 'pulsoicon-react/icons/x';
import { Zap } from 'pulsoicon-react/icons/zap';

interface IconProps {
  size?: number;
}

export function LogoIcon({ size = 28 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect className="logo-tile" width="32" height="32" rx="8" />
      <path className="logo-prompt" d="M7.5 10l6 6-6 6" />
      <path className="logo-spark" d="M17 16h3.5M20.5 16l4.5-5.5M20.5 16h5.5M20.5 16l4.5 5.5" />
    </svg>
  );
}

export function PlusIcon({ size = 16 }: IconProps) {
  return <Plus size={size} strokeWidth={2} aria-hidden="true" />;
}

export function ChatIcon({ size = 16 }: IconProps) {
  return <MessageCircle size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function GridIcon({ size = 16 }: IconProps) {
  return <LayoutGrid size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function KeyIcon({ size = 16 }: IconProps) {
  return <Key size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function FolderIcon({ size = 16 }: IconProps) {
  return <Folder size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function CheckIcon({ size = 16 }: IconProps) {
  return <Check size={size} strokeWidth={2.2} aria-hidden="true" />;
}

export function AlertIcon({ size = 16 }: IconProps) {
  return <TriangleAlert size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function StopIcon({ size = 16 }: IconProps) {
  return <Square size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function StopFilledIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="1" y="1" width="10" height="10" rx="2" />
    </svg>
  );
}

export function SendIcon({ size = 16 }: IconProps) {
  return <ArrowRight size={size} strokeWidth={2.1} aria-hidden="true" />;
}

export function MicIcon({ size = 16 }: IconProps) {
  return <Mic size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function TerminalIcon({ size = 16 }: IconProps) {
  return <Terminal size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function CloseIcon({ size = 16 }: IconProps) {
  return <X size={size} strokeWidth={2} aria-hidden="true" />;
}

export function FileIcon({ size = 16 }: IconProps) {
  return <File size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function PencilIcon({ size = 16 }: IconProps) {
  return <Pencil size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function ChevronDownIcon({ size = 16 }: IconProps) {
  return <ChevronDown size={size} strokeWidth={2} aria-hidden="true" />;
}

export function ChevronRightIcon({ size = 16 }: IconProps) {
  return <ChevronRight size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function ArchiveIcon({ size = 16 }: IconProps) {
  return <Archive size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function TrashIcon({ size = 16 }: IconProps) {
  return <Trash size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function ThumbUpIcon({ size = 16 }: IconProps) {
  return <ThumbsUp size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function ThumbDownIcon({ size = 16 }: IconProps) {
  return <ThumbsDown size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function RefreshIcon({ size = 16 }: IconProps) {
  return <RefreshCw size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function CopyIcon({ size = 16 }: IconProps) {
  return <Copy size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function ExternalLinkIcon({ size = 16 }: IconProps) {
  return <ExternalLink size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function ShieldIcon({ size = 16 }: IconProps) {
  return <Shield size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function ShieldCheckIcon({ size = 16 }: IconProps) {
  return <ShieldCheck size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function ShieldAlertIcon({ size = 16 }: IconProps) {
  return <ShieldAlert size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function EyeIcon({ size = 16 }: IconProps) {
  return <Eye size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function LockIcon({ size = 16 }: IconProps) {
  return <Lock size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function ListTodoIcon({ size = 16 }: IconProps) {
  return <ListTodo size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function ZapIcon({ size = 16 }: IconProps) {
  return <Zap size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function GitBranchIcon({ size = 16 }: IconProps) {
  return <GitBranch size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function RotateCcwIcon({ size = 16 }: IconProps) {
  return <RotateCcw size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function PlayIcon({ size = 16 }: IconProps) {
  return <Play size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function InboxIcon({ size = 16 }: IconProps) {
  return <Inbox size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function GitForkIcon({ size = 16 }: IconProps) {
  return <GitFork size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function SwitchIcon({ size = 16 }: IconProps) {
  return <ArrowLeftRight size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function ClockIcon({ size = 16 }: IconProps) {
  return <Clock size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function CompareIcon({ size = 16 }: IconProps) {
  return <GitCompare size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function SidebarCollapseIcon({ size = 16 }: IconProps) {
  return <PanelLeftClose size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function SidebarExpandIcon({ size = 16 }: IconProps) {
  return <PanelLeftOpen size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function DownloadIcon({ size = 16 }: IconProps) {
  return <Download size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function SettingsIcon({ size = 16 }: IconProps) {
  return <Settings size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function SlidersIcon({ size = 16 }: IconProps) {
  return <SlidersHorizontal size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function PaperclipIcon({ size = 16 }: IconProps) {
  return <Paperclip size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function ImageIcon({ size = 16 }: IconProps) {
  return <Image size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function FileTextIcon({ size = 16 }: IconProps) {
  return <FileText size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function BoldIcon({ size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
    </svg>
  );
}

export function ItalicIcon({ size = 16 }: IconProps) {
  return <Italic size={size} strokeWidth={1.9} aria-hidden="true" />;
}

export function UnderlineIcon({ size = 16 }: IconProps) {
  return <Underline size={size} strokeWidth={1.9} aria-hidden="true" />;
}

export function StrikethroughIcon({ size = 16 }: IconProps) {
  return <Strikethrough size={size} strokeWidth={1.9} aria-hidden="true" />;
}

export function PilcrowIcon({ size = 16 }: IconProps) {
  return <Pilcrow size={size} strokeWidth={1.9} aria-hidden="true" />;
}

export function LinkIcon({ size = 16 }: IconProps) {
  return <Link size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function ListOrderedIcon({ size = 16 }: IconProps) {
  return <ListOrdered size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function ListBulletIcon({ size = 16 }: IconProps) {
  return <List size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function QuoteIcon({ size = 16 }: IconProps) {
  return <Quote size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function InlineCodeIcon({ size = 16 }: IconProps) {
  return <CodeXml size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function CodeBlockIcon({ size = 16 }: IconProps) {
  return <SquareCode size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function DividerIcon({ size = 16 }: IconProps) {
  return <Minus size={size} strokeWidth={1.8} aria-hidden="true" />;
}

import { Icon } from './Icon';
import type { ImgHTMLAttributes } from 'react';

type IconProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'>;

// ===== Custom SVG Icons (from /public/icons/) =====

// Main Navigation
export const HomeIcon = (props: IconProps) => <Icon name="dashboard" {...props} />;
export const PipelineIcon = (props: IconProps) => <Icon name="kanban" {...props} />;
export const ProjectsIcon = (props: IconProps) => <Icon name="project" {...props} />;
export const ProjectIcon = (props: IconProps) => <Icon name="project" {...props} />;
export const TasksIcon = (props: IconProps) => <Icon name="task" {...props} />;
export const TaskIcon = (props: IconProps) => <Icon name="task" {...props} />;
export const RevenueIcon = (props: IconProps) => <Icon name="revenue" {...props} />;
export const UsersIcon = (props: IconProps) => <Icon name="users" {...props} />;
export const ChartIcon = (props: IconProps) => <Icon name="chart" {...props} />;

// UI Actions
export const PlusIcon = (props: IconProps) => <Icon name="plus" {...props} />;
export const EditIcon = (props: IconProps) => <Icon name="edit" {...props} />;
export const TrashIcon = (props: IconProps) => <Icon name="trash" {...props} />;
export const CloseIcon = (props: IconProps) => <Icon name="close" {...props} />;
export const SearchIcon = (props: IconProps) => <Icon name="search" {...props} />;
export const UploadIcon = (props: IconProps) => <Icon name="upload" {...props} />;
export const RefreshIcon = (props: IconProps) => <Icon name="refresh" {...props} />;
export const LoaderIcon = (props: IconProps) => <Icon name="loader" {...props} />;

// Arrows & Chevrons
export const ArrowUpIcon = (props: IconProps) => <Icon name="arrrow-up" {...props} />; // Note: typo in filename
export const ArrowDownIcon = (props: IconProps) => <Icon name="arrow-down" {...props} />;
export const ArrowLeftIcon = (props: IconProps) => <Icon name="arrowleft" {...props} />;
export const ArrowRightIcon = (props: IconProps) => <Icon name="arrow-right" {...props} />;
export const ChevronDownIcon = (props: IconProps) => <Icon name="arrow-down" {...props} />; // Using arrow-down
export const ChevronUpIcon = (props: IconProps) => <Icon name="arrrow-up" {...props} />; // Using arrow-up
export const ChevronLeftIcon = (props: IconProps) => <Icon name="arrowleft" {...props} />; // Using arrow-left
export const ChevronRightIcon = (props: IconProps) => <Icon name="arrow-right" {...props} />; // Using arrow-right

// User & Auth
export const ProfileIcon = (props: IconProps) => <Icon name="profile" {...props} />;
export const UserIcon = (props: IconProps) => <Icon name="profile" {...props} />; // Using profile
export const UserPlusIcon = (props: IconProps) => <Icon name="userplus" {...props} />;
export const LogoutIcon = (props: IconProps) => <Icon name="logout" {...props} />;
export const LockIcon = (props: IconProps) => <Icon name="lock" {...props} />;

// Theme & Settings
export const MoonIcon = (props: IconProps) => <Icon name="moon" {...props} />;
export const SunIcon = (props: IconProps) => <Icon name="sun" {...props} />;
export const SettingsIcon = (props: IconProps) => <Icon name="setting" {...props} />;
export const PanelLeftIcon = (props: IconProps) => <Icon name="panel-left" {...props} />;
export const PanelRightIcon = (props: IconProps) => <Icon name="panel-right" {...props} />;

// Communication & Content
export const MailIcon = (props: IconProps) => <Icon name="mail" {...props} />;
export const HashIcon = (props: IconProps) => <Icon name="hash" {...props} />;

// Forms & Input
export const CalendarIcon = (props: IconProps) => <Icon name="calendar" {...props} />;
export const EyeIcon = (props: IconProps) => <Icon name="eye" {...props} />;

// Alerts & Status
export const AlertCircleIcon = (props: IconProps) => <Icon name="alert-circle" {...props} />;
export const InfoIcon = (props: IconProps) => <Icon name="info" {...props} />;
export const CheckSquareIcon = (props: IconProps) => <Icon name="checkmark" {...props} />;

// Finance
export const WalletIcon = (props: IconProps) => <Icon name="wallet" {...props} />;
export const CoinsIcon = (props: IconProps) => <Icon name="coins" {...props} />;
export const EuroIcon = (props: IconProps) => <Icon name="euro" {...props} />;
export const DollarIcon = (props: IconProps) => <Icon name="euro" {...props} />; // Using euro instead of dollar

// Business
export const BuildingIcon = (props: IconProps) => <Icon name="building" {...props} />;
export const PackageIcon = (props: IconProps) => <Icon name="package" {...props} />;
export const TargetIcon = (props: IconProps) => <Icon name="target" {...props} />;

// Charts & Analytics
export const PieChartIcon = (props: IconProps) => <Icon name="revenue" {...props} />; // Revenue breakdown
export const TrendingUpIcon = (props: IconProps) => <Icon name="chart" {...props} />; // MRR trend
export const PercentIcon = (props: IconProps) => <Icon name="percent" {...props} />;

// Actions
export const DownloadIcon = (props: IconProps) => <Icon name="download" {...props} />;
export const MaximizeIcon = (props: IconProps) => <Icon name="maximize" {...props} />;
export const MinimizeIcon = (props: IconProps) => <Icon name="minimize" {...props} />;

// ===== Lucide Icons (fallback for missing custom icons) =====
export {
  // Missing custom icons - still using Lucide
  EyeOff as EyeOffIcon,
  FolderGit2 as FolderGitIcon,
  FolderOpen as FolderOpenIcon,
  Home as HomeIconLucide,
  LogIn as LoginIcon,
  MoreHorizontal as MoreHorizontalIcon,

  // Other commonly used Lucide icons
  BarChart3 as AnalyticsIcon,
  FileText as ReportsIcon,
  ShoppingBag as OrdersIcon,
  Box as InventoryIcon,
  CreditCard as PaymentsIcon,
  Megaphone as CampaignsIcon,
  Tag as PromotionsIcon,
  Ticket as TicketsIcon,
  MessageSquare as MessagesIcon,
  BookOpen as KnowledgeBaseIcon,
  ShieldCheck as RolesIcon,
  Settings as SettingsIconLucide,
  Menu as MenuIcon,
  Bell as NotificationIcon,
  CheckCircle as CheckCircleIcon,
  Clock as ClockIcon,
  List as ListIcon,
  Filter as FilterIcon,
  SortAsc as SortAscIcon,
  SortDesc as SortDescIcon,
  Share2 as ShareIcon,
  Copy as CopyIcon,
  Check as CheckIcon,
  HelpCircle as HelpIcon,
  ExternalLink as ExternalLinkIcon,
  Link as LinkIcon,
  Paperclip as AttachmentIcon,
  Image as ImageIcon,
  File as FileIcon,
  Folder as FolderIcon,
  Star as StarIcon,
  Heart as HeartIcon,
  Bookmark as BookmarkIcon,
  Flag as FlagIcon,
  AtSign as MentionIcon,
  Send as SendIcon,
  Reply as ReplyIcon,
  Forward as ForwardIcon,
  Archive as ArchiveIcon,
  Inbox as InboxIcon,
  TrendingDown as TrendingDownIcon,
  Activity as ActivityIcon,
  BarChart as BarChartIcon,
  LineChart as LineChartIcon,
} from 'lucide-react';

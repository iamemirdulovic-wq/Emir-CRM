/**
 * Icons.
 *
 * The approved design pulls Lucide from a CDN. We bundle it instead: this is an
 * installable PWA used by agents on phones, and a blocked icon host once made
 * every icon render as raw ligature text. Bundled icons always draw, work
 * offline, and cost nothing at runtime.
 *
 * Names are the design's own kebab-case `data-lucide` values, so porting a
 * screen from design/emir-crm-design.html is a straight substitution:
 *
 *   <i data-lucide="kanban"></i>   ->   <Icon name="kanban" />
 *
 * Lucide gives every glyph a `lucide` class, which base.css sizes to 18px at
 * stroke 1.9 and individual components override.
 *
 * Generated from the design file; add a name here when a screen needs one.
 */
import type { SVGProps } from 'react';
import {
  Activity, AlarmClock, AlertCircle, AlertTriangle, ArrowDownLeft, ArrowLeft, ArrowRight,
  ArrowUp, ArrowUpRight, BadgeCheck, Ban, Banknote, BarChart3, Bell, BellRing, Brain, Briefcase,
  Building, Building2, Calculator, CalendarCheck, CalendarCheck2, CalendarDays, CalendarPlus,
  Camera, Check, CheckCheck, CheckCircle2, CheckSquare, ChevronDown, ChevronLeft, ChevronRight,
  ChevronUp, Circle, CircleAlert, CircleCheck, CircleX, Clock, Clock3, Crown, Download,
  ExternalLink, Eye, EyeOff, Facebook, FileBadge, FileBarChart, FileCheck2, FileDown, FileUp,
  FileOutput, FileSignature, FileSpreadsheet, FileText, Filter, Flame, Gauge, GitCompare, Globe,
  GripVertical, HandCoins, Hourglass, IdCard, Inbox, Info, Instagram, Kanban, KeyRound,
  Landmark, Layers, LayoutDashboard, LayoutGrid, LayoutTemplate, Lightbulb, Link, List, Loader2,
  LogOut, Mail, MapPin, Megaphone, Menu, MessageCircle, MessageSquare, MessageSquareHeart,
  Minus, Monitor, Moon, MoreHorizontal, Paperclip, Pencil, Phone, PhoneOutgoing, PieChart, Play,
  PencilLine, Plus, Radar, Radio, Receipt, RefreshCw, Repeat, Save, Scale, ScanLine, Search, Send, Settings,
  Shield, ShieldCheck, ShoppingBag, Sparkles, SquarePen, Stamp, Star, StickyNote, Sun, Target,
  Timer, ToggleLeft, Trash2, TrendingUp, Trophy, Umbrella, Upload, User, UserCheck, UserPlus,
  UserX, Users, UsersRound, Wallet, X, Zap,
} from 'lucide-react';

const ICONS = {
  'activity': Activity, 'alarm-clock': AlarmClock, 'alert-circle': AlertCircle,
  'alert-triangle': AlertTriangle, 'arrow-down-left': ArrowDownLeft, 'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight, 'arrow-up': ArrowUp, 'arrow-up-right': ArrowUpRight,
  'badge-check': BadgeCheck, 'ban': Ban, 'banknote': Banknote, 'bar-chart-3': BarChart3,
  'bell': Bell, 'bell-ring': BellRing, 'brain': Brain, 'briefcase': Briefcase,
  'building': Building, 'building-2': Building2, 'calculator': Calculator,
  'calendar-check': CalendarCheck, 'calendar-check-2': CalendarCheck2,
  'calendar-days': CalendarDays, 'calendar-plus': CalendarPlus, 'camera': Camera,
  'check': Check, 'check-check': CheckCheck, 'check-circle-2': CheckCircle2,
  'check-square': CheckSquare, 'chevron-down': ChevronDown, 'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight, 'chevron-up': ChevronUp, 'circle': Circle,
  'circle-alert': CircleAlert, 'circle-check': CircleCheck, 'circle-x': CircleX, 'clock': Clock,
  'clock-3': Clock3, 'crown': Crown, 'download': Download, 'external-link': ExternalLink,
  'eye': Eye, 'eye-off': EyeOff, 'facebook': Facebook, 'file-badge': FileBadge,
  'file-bar-chart': FileBarChart, 'file-check-2': FileCheck2, 'file-down': FileDown, 'file-up': FileUp,
  'file-output': FileOutput, 'file-signature': FileSignature,
  'file-spreadsheet': FileSpreadsheet, 'file-text': FileText, 'filter': Filter, 'flame': Flame,
  'gauge': Gauge, 'git-compare': GitCompare, 'globe': Globe, 'grip-vertical': GripVertical,
  'hand-coins': HandCoins, 'hourglass': Hourglass, 'id-card': IdCard, 'inbox': Inbox,
  'info': Info, 'instagram': Instagram, 'kanban': Kanban, 'key-round': KeyRound,
  'landmark': Landmark, 'layers': Layers, 'layout-dashboard': LayoutDashboard,
  'layout-grid': LayoutGrid, 'layout-template': LayoutTemplate, 'lightbulb': Lightbulb,
  'link': Link, 'list': List, 'loader-2': Loader2, 'log-out': LogOut, 'mail': Mail,
  'map-pin': MapPin, 'megaphone': Megaphone, 'menu': Menu, 'message-circle': MessageCircle,
  'message-square': MessageSquare, 'message-square-heart': MessageSquareHeart, 'minus': Minus,
  'monitor': Monitor, 'moon': Moon, 'more-horizontal': MoreHorizontal, 'paperclip': Paperclip,
  'pencil': Pencil, 'pencil-line': PencilLine, 'phone': Phone, 'phone-outgoing': PhoneOutgoing, 'pie-chart': PieChart,
  'play': Play, 'plus': Plus, 'radar': Radar, 'radio': Radio, 'receipt': Receipt,
  'refresh-cw': RefreshCw, 'repeat': Repeat, 'save': Save, 'scale': Scale,
  'scan-line': ScanLine, 'search': Search, 'send': Send, 'settings': Settings, 'shield': Shield,
  'shield-check': ShieldCheck, 'shopping-bag': ShoppingBag, 'sparkles': Sparkles,
  'square-pen': SquarePen, 'stamp': Stamp, 'star': Star, 'sticky-note': StickyNote, 'sun': Sun,
  'target': Target, 'timer': Timer, 'toggle-left': ToggleLeft, 'trash-2': Trash2,
  'trending-up': TrendingUp, 'trophy': Trophy, 'umbrella': Umbrella, 'upload': Upload,
  'user': User, 'user-check': UserCheck, 'user-plus': UserPlus, 'user-x': UserX, 'users': Users,
  'users-round': UsersRound, 'wallet': Wallet, 'x': X, 'zap': Zap,
} as const;

export type IconName = keyof typeof ICONS;

/** Every icon name, for tests and for the icon gallery in Settings. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'ref'> {
  name: IconName;
  /** Overrides the 18px default from the stylesheet. */
  size?: number;
}

export function Icon({ name, size, ...rest }: IconProps) {
  const Glyph = ICONS[name];
  // An unknown name is a typo, not a runtime condition worth a fallback glyph.
  if (!Glyph) throw new Error(`Unknown icon: ${name}`);
  const dimensions = size === undefined ? {} : { width: size, height: size };
  return <Glyph aria-hidden focusable={false} {...dimensions} {...rest} />;
}

/**
 * Small, dependency-free i18n. The UI is RTL-ready: choosing Arabic flips
 * `dir` on <html>, which mirrors the whole Tailwind layout.
 */

export type Locale = 'en' | 'ar';

const STRINGS = {
  en: {
    signIn: 'Sign in',
    email: 'Email',
    password: 'Password',
    rememberMe: 'Remember me',
    signOut: 'Sign out',
    board: 'Board',
    inbox: 'Inbox',
    contacts: 'Contacts',
    projects: 'Projects',
    offers: 'Sales offers',
    templates: 'Templates',
    reports: 'Reports',
    team: 'Team',
    lists: 'Lists',
    campaigns: 'Campaigns',
    pool: 'Lead pool',
    search: 'Search',
    mine: 'Mine',
    unassigned: 'Unassigned',
    all: 'All',
    unread: 'Unread',
    send: 'Send',
    note: 'Internal note',
    loading: 'Loading…',
    noResults: 'Nothing here yet',
    windowOpen: 'Reply window open',
    windowClosed: 'Window closed — templates only',
    changePassword: 'Change your password',
    currentPassword: 'Current password',
    newPassword: 'New password',
    save: 'Save',
    cancel: 'Cancel',
    leadScore: 'Lead score',
    stage: 'Stage',
    owner: 'Owner',
    budget: 'Budget',
    project: 'Project',
    source: 'Source',
    tasks: 'Tasks',
    activity: 'Activity',
    markLost: 'Mark lost',
    lostReason: 'Lost reason',
    required: 'Required',
    dashboard: 'Dashboard',
    pipeline: 'Pipeline',
    automations: 'Automations',
    settings: 'Settings',
    signInSubtitle: 'Use the email and password your admin gave you.',
    signInHeadline: 'Every lead answered in seconds.',
    signInBlurb:
      'Meta, Google, website and WhatsApp leads in one board, with one inbox for your whole team.',
    keepSignedIn: 'Keep me signed in',
    forgotPassword: 'Forgot your password? Ask your admin to reset it.',
    addLead: 'Add lead',
    available: 'Available for new leads',
    open: 'Open',
    overdue: 'Overdue',
    today: 'Today',
    done: 'Done',
  },
  ar: {
    signIn: 'تسجيل الدخول',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    rememberMe: 'تذكرني',
    signOut: 'تسجيل الخروج',
    board: 'اللوحة',
    inbox: 'الرسائل',
    contacts: 'جهات الاتصال',
    projects: 'المشاريع',
    offers: 'عروض البيع',
    templates: 'القوالب',
    reports: 'التقارير',
    team: 'الفريق',
    search: 'بحث',
    mine: 'الخاصة بي',
    unassigned: 'غير مُسندة',
    all: 'الكل',
    unread: 'غير مقروءة',
    send: 'إرسال',
    note: 'ملاحظة داخلية',
    loading: 'جارٍ التحميل…',
    noResults: 'لا يوجد شيء بعد',
    windowOpen: 'نافذة الرد مفتوحة',
    windowClosed: 'النافذة مغلقة — القوالب فقط',
    changePassword: 'تغيير كلمة المرور',
    currentPassword: 'كلمة المرور الحالية',
    newPassword: 'كلمة المرور الجديدة',
    save: 'حفظ',
    cancel: 'إلغاء',
    leadScore: 'تقييم العميل',
    stage: 'المرحلة',
    owner: 'المسؤول',
    budget: 'الميزانية',
    project: 'المشروع',
    source: 'المصدر',
    tasks: 'المهام',
    activity: 'النشاط',
    markLost: 'تحديد كمفقود',
    lostReason: 'سبب الفقدان',
    required: 'مطلوب',
    dashboard: 'لوحة المعلومات',
    pipeline: 'المسار',
    automations: 'الأتمتة',
    settings: 'الإعدادات',
    signInSubtitle: 'استخدم البريد الإلكتروني وكلمة المرور من المسؤول.',
    signInHeadline: 'كل عميل يحصل على رد خلال ثوانٍ.',
    signInBlurb: 'عملاء ميتا وجوجل والموقع وواتساب في لوحة واحدة، مع صندوق وارد واحد لفريقك.',
    keepSignedIn: 'أبقني مسجلاً للدخول',
    forgotPassword: 'نسيت كلمة المرور؟ اطلب من المسؤول إعادة تعيينها.',
    addLead: 'إضافة عميل',
    available: 'متاح لعملاء جدد',
    open: 'مفتوحة',
    overdue: 'متأخرة',
    today: 'اليوم',
    done: 'مكتملة',
    lists: 'القوائم',
    campaigns: 'الحملات',
    pool: 'مجموعة العملاء',
  },
} as const;

export type StringKey = keyof (typeof STRINGS)['en'];

let current: Locale = (localStorage.getItem('emir.locale') as Locale) ?? 'en';

export function locale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  current = next;
  localStorage.setItem('emir.locale', next);
  applyDirection();
}

/** Arabic mirrors the entire layout through the document direction. */
export function applyDirection(): void {
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'ar' ? 'rtl' : 'ltr';
}

export function t(key: StringKey): string {
  return STRINGS[current][key] ?? STRINGS.en[key] ?? key;
}

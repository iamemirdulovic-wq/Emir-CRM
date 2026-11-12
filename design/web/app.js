/* =====================================================================================
   homes.me CRM · app.js · shared shell + behaviours (by Pixel). Do NOT fork this file.
   Every component is shown with copy-ready markup in components.html.

   PAGE SKELETON
     <title>All leads · homes.me</title>                       top-bar title = text before " · "
     <link rel="stylesheet" href="ui.css">
     <body data-page="all-leads" data-role="owner">           then <main>…</main>, then <script src="app.js"></script>

   BODY ATTRIBUTES
     data-page="all-leads"        sidebar item to highlight = the file name without .html
                                  (sub-pages map to their parent: lead→All/My leads, dashboard→Dashboard,
                                   project→Projects, settings-team→Settings … see ALIAS below)
     data-role="owner|agent|any"  owner/agent lock the role and save it (localStorage hmRole);
                                  any = use the saved role (default owner)
     data-title="Marco Bellini"   top-bar title (else document.title before " · ")
     data-sub="Wed 11 Nov · 14:55" small grey line under the title (optional)
     data-back="all-leads.html|All leads"   shows "← All leads" above the title
     data-shell="none"            no sidebar / top bar (login). Behaviours below still work.
     Owner page opened with ?as=agent shows the "Only for owners and admin" block instead of <main>.

   EXTRA THINGS IN THE TOP BAR
     <div data-topbar>…</div>     anywhere in <main>: moved into the top bar after the title
                                  e.g. <div data-topbar><div class="seg" data-seg><button class="on">Today</button><button>Week</button></div></div>

   ROLE HELPERS
     data-only="owner" | data-only="agent"    element is removed for the other role
                                  e.g. <button class="btn" data-only="owner">Export</button>

   ICONS         <i data-icon="phone"></i>   sizes: class i-sm (14) · default 18 · i-lg (22) · i-xl (28)
                 names: see ICONS below (home grid sun inbox users user clock columns swap upload download
                 calendar tasks building tag megaphone pin activity sparkles zap settings search plus bell
                 chevron-down chevron-up chevron-left chevron-right x check phone whatsapp telegram more star
                 crown edit trash moon logout eye arrow-right arrow-left arrow-up-right mail file link copy alert
                 info lock sidebar list mic play flag undo card message refresh globe wifi trophy image qr filter
                 layout target fire shield chart external help clip bookmark video laptop key)
   AVATARS       <span class="av" data-name="Rocky Khan"></span>      initials + fixed colour from the name
                 add data-status="office|late|outside|leave|absent" for the status dot · sizes xs sm lg xl

   TABS          <div class="tabs" data-tabs><button class="tab on" data-tab="notes">Notes</button>…</div>
                 <div data-panel="notes">…</div> <div data-panel="files" hidden>…</div>
                 A link to page.html#files opens that tab. Works on .seg buttons too (data-tab on them).
   SEGMENTED     <div class="seg" data-seg><button class="on">Today</button><button>Week</button></div>
                 fires "hm:change" on the .seg (event.detail.value = data-value or the text)
   OPTION CHIPS  <div class="chips" data-chips><button class="chip-opt on">Call</button>…</div>   single select
                 <div class="chips" data-chips="multi">…</div>   many · also works on .opt cards (.opt-list)
                 fires "hm:change" (detail.value / detail.values)
   SIDE PANEL    <tr data-open="#lead-panel"> … <aside class="panel" id="lead-panel">…<button data-close>
   DIALOG        <button data-open="#lost">Lost</button> … <div class="dialog" id="lost">…<button data-close>
                 Esc or a click on the dark background closes. JS: HM.open('#lost'), HM.close()
   MENU          <button data-menu="#row-menu">⋯</button> <div class="menu" id="row-menu"><a class="menu-item">…
   TWO-CLICK     <button class="btn danger" data-confirm="Tap again to delete" data-toast="Deleted">Delete</button>
                 first click turns red and shows the text for 3 s; the second click runs every other
                 attribute on the button (data-toast, data-remove, data-close, data-open, data-href)
                 and fires "hm:confirm" on it.
   TOAST         <button data-toast="Saved">Save</button>   add data-undo for an Undo button (fires "hm:undo")
                 JS: HM.toast('Lead moved to Rocky', {undo(){…}})   HM.toast('No network', {error:true})
   REMOVE        <button data-remove=".list-row">Done</button>   slides out the closest match (HM.slideOut(el))
   LINK ROW      <tr data-href="lead.html">  any element becomes a link (clicks on buttons inside are ignored)
   FILTER CHIPS  <span class="filter-chip">Agent: Rocky <button>×</button></span>   × removes it
                 <button data-clear-filters>Clear all</button>   removes every chip in the same .filters
   TABLE SELECT  <table class="table" id="t1" data-select> header: <label class="check"><input type="checkbox" data-select-all></label>
                 rows: <td class="t-check"><label class="check"><input type="checkbox"></label></td>
                 <div class="bulkbar" data-bulk="#t1"><b><span data-bulk-count>0</span> selected</b> …<button data-bulk-cancel>Cancel</button></div>
   FORMS         <form data-form data-toast="Lead saved"> fields in <div class="field">; rules on the input:
                 required · data-min="7" (min length) · data-digits (digits only) · type="email" ·
                 data-error="Write the full name." (message). Bad fields get .invalid + the message.
                 When all good: toast, closes the dialog/panel around it, fires "hm:submit".
   INLINE EDIT   <div class="kv-row" data-edit><dt>Budget</dt><dd>AED 2M</dd></div>   click → type → Enter (toast)
   COUNT-UP      <b class="num" data-count>214</b>            counts from 0 on load (keeps 1,980 style)
   COUNTDOWN     <b data-countdown="24:12" data-countdown-total="30:00" data-over="Time is over"></b>
                 live mm:ss · gets .warn under 10:00 and .over at 0 (fires "hm:timeup") ·
                 inside <div class="ring"> it also drives the ring
   SPARKLINE     <svg class="spark" data-spark="12,18,9,22,17,25,27"></svg>
   TIP           <button data-tip="Call (C)">…</button>       small dark tooltip (data-tip-pos="top")
   OPEN SEARCH   <button data-cmdk>Search</button>             opens the command palette (also Ctrl K or /)
   OPEN BELL     <button data-notif>…</button>                 opens the notification panel
   THEME / ROLE  <button data-theme-toggle>   <button data-role-switch="agent">  (already in the profile menu)

   JS HELPERS (window.HM)
     HM.role 'owner'|'agent' · HM.me {name,title} · HM.toast(text,{undo,error}) · HM.open(sel) · HM.close()
     HM.slideOut(el, cb) · HM.icon('phone') → svg string · HM.refresh(root) (run after you add HTML with
     data-icon / avatars / sparklines / data-count by script) · HM.confetti() · HM.setCheckin('in'|'out'|'outside', text or 'HH:MM')
     HM.setBadge('incoming', 2) sidebar number (0 removes it) · HM.setBadge('bell', 3) bell count
     HM.setRole('agent')

   SHORTCUTS     Ctrl K or / search · N add lead · [ sidebar · Esc close
   ===================================================================================== */
(function () {
  'use strict';
  var D = document, B = D.body, H = D.documentElement, LS;
  try { LS = window.localStorage; LS.getItem('x'); } catch (e) { LS = { getItem: function () { return null; }, setItem: function () {} }; }
  function $(s, r) { return (r || D).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || D).querySelectorAll(s)); }
  function el(html) { var t = D.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  function fire(node, name, detail) { node.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail || {} })); }

  /* ---------------- icons (24 × 24, stroke) ---------------- */
  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    grid: '<rect x="3" y="3" width="8" height="8" rx="2.2"/><rect x="13" y="3" width="8" height="5" rx="2.2"/><rect x="13" y="10" width="8" height="11" rx="2.2"/><rect x="3" y="13" width="8" height="8" rx="2.2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.8 3.1 2.6 3.5 5.2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    columns: '<rect x="3" y="4" width="5" height="16" rx="1.6"/><rect x="9.5" y="4" width="5" height="11" rx="1.6"/><rect x="16" y="4" width="5" height="7" rx="1.6"/>',
    swap: '<path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/>',
    download: '<path d="M12 4v12m-5-5 5 5 5-5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    tasks: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="m8 12.5 3 3 5.5-6.5"/>',
    building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 10h3a1 1 0 0 1 1 1v10M2.5 21h19M8 7.5h4M8 11.5h4M8 15.5h4"/>',
    tag: '<path d="M3 12.5V5a2 2 0 0 1 2-2h7.5L21 11.5 12.5 20z"/><circle cx="8" cy="8" r="1.3"/>',
    megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h3l8 4V5L8 9H5a1 1 0 0 0-1 1zM19 9.5a4 4 0 0 1 0 5M8 15v4"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    sparkles: '<path d="M10 3.5 11.8 9l5.2 1.8-5.2 1.8L10 18l-1.8-5.4L3 10.800 8.200 9zM18.500 3v4M16.500 5h4M19 16v4M17 18h4"/>',
    zap: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.800-3.800"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    bell: '<path d="M6 16.500V11a6 6 0 0 1 12 0v5.500l1.500 2h-15zM10 20.500a2.200 2.200 0 0 0 4 0"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>', 'chevron-up': '<path d="m6 15 6-6 6 6"/>',
    'chevron-left': '<path d="m15 6-6 6 6 6"/>', 'chevron-right': '<path d="m9 6 6 6-6 6"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="m5 12.500 4.500 4.500L19 7"/>',
    phone: '<path d="M5 4h3.500l1.500 4.500-2 1.500a12 12 0 0 0 6 6l1.500-2 4.500 1.500V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    whatsapp: '<path d="M20.500 11.500a8.500 8.500 0 0 1-12.600 7.400L3.500 20.500l1.600-4.300a8.500 8.500 0 1 1 15.400-4.700z"/><path d="M9 8.800c0 3 2.700 5.700 5.700 5.700"/>',
    telegram: '<path d="M21 3 10.500 13.500M21 3l-6.500 18-4-7.500L3 9.500z"/>',
    more: '<circle cx="5" cy="12" r="1.400" fill="currentColor"/><circle cx="12" cy="12" r="1.400" fill="currentColor"/><circle cx="19" cy="12" r="1.400" fill="currentColor"/>',
    star: '<path d="m12 3 2.700 5.700 6.300.800-4.600 4.300 1.200 6.200L12 17l-5.600 3 1.200-6.200L3 9.500l6.300-.800z"/>',
    crown: '<path d="M3 8l4.500 4L12 5l4.500 7L21 8l-2 10H5z"/>',
    edit: '<path d="M4 20h4l11-11-4-4L4 16zM13.500 6.500l4 4"/>',
    trash: '<path d="M4 7h16M10 3.500h4M6 7l1 12.500a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1L18 7M10 11v6M14 11v6"/>',
    moon: '<path d="M20 14.500A8.500 8.500 0 0 1 9.500 4 8.500 8.500 0 1 0 20 14.500z"/>',
    logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M15 8l4 4-4 4M19 12H9"/>',
    eye: '<path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z"/><circle cx="12" cy="12" r="3"/>',
    'arrow-right': '<path d="M5 12h14m-5-5 5 5-5 5"/>', 'arrow-left': '<path d="M19 12H5m5-5-5 5 5 5"/>',
    'arrow-up-right': '<path d="M7 17 17 7M8 7h9v9"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3.500 7.500 8.500 6 8.500-6"/>',
    file: '<path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.700 0l3-3A4 4 0 0 0 13 5.300l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.500"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    alert: '<path d="M12 4 2.500 20h19zM12 10v4.500M12 17.500v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.500v.01"/>',
    lock: '<rect x="5" y="10.500" width="14" height="10" rx="2.500"/><path d="M8 10.500V8a4 4 0 0 1 8 0v2.500"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M5.500 8.500h1M5.500 12h1"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.500 11a6.500 6.500 0 0 0 13 0M12 17.500V21"/>',
    play: '<path d="M7 4.500v15l12-7.500z"/>',
    flag: '<path d="M5 21V4M5 4h12l-2 4.500 2 4.500H5"/>',
    undo: '<path d="M8 5 4 9l4 4M4 9h10a6 6 0 0 1 0 12h-3"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.500-1.500 1.600-2 3-2s2.500.500 3 2M15 10h3M15 14h3"/>',
    message: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
    refresh: '<path d="M20 11A8 8 0 0 0 5.500 6.500L4 8M4 4v4h4M4 13a8 8 0 0 0 14.500 4.500L20 16M20 20v-4h-4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.500 2.800 3.500 5.800 3.500 9s-1 6.200-3.500 9c-2.500-2.800-3.500-5.800-3.500-9S9.500 5.800 12 3z"/>',
    wifi: '<path d="M2.500 9a14 14 0 0 1 19 0M5.500 12.500a9.500 9.500 0 0 1 13 0M8.500 16a5 5 0 0 1 7 0M12 19.500v.01"/>',
    trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H4.500v1.500A3.500 3.500 0 0 0 8 11M16 6h3.500v1.500A3.500 3.500 0 0 1 16 11M12 14v4M8.500 20.500h7"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.500" cy="9.500" r="1.800"/><path d="m4 18 5-5 3.500 3.500L16 13l4.500 4.500"/>',
    qr: '<rect x="3.500" y="3.500" width="6.500" height="6.500" rx="1.500"/><rect x="14" y="3.500" width="6.500" height="6.500" rx="1.500"/><rect x="3.500" y="14" width="6.500" height="6.500" rx="1.500"/><path d="M14 14h2.500v2.500H14zM18 18h2.500v2.500H18zM18 14h2.500M14 18.500v2"/>',
    filter: '<path d="M4 5h16l-6 7.500V19l-4 1.500v-8z"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9.500h18M9.500 9.500V20"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.200" fill="currentColor"/>',
    fire: '<path d="M12 3c1 3.500 5 5.500 5 10.500a5 5 0 0 1-10 0c0-1.800.800-3 1.800-4 .200 1.500 1 2.500 2 3C10.500 9.500 10.500 6 12 3z"/>',
    shield: '<path d="M12 3 4.500 6v5.500c0 4.500 3 8 7.500 9.500 4.500-1.500 7.500-5 7.500-9.500V6z"/>',
    chart: '<path d="M4 20V4M4 20h16M8.500 16v-5M12.500 16V8M16.500 16v-3"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.700.400-1 1-1 1.700M12 16.500v.01"/>',
    clip: '<path d="M20 11.500 12 19.500a5 5 0 0 1-7-7l8.500-8.500a3.300 3.300 0 0 1 4.700 4.700L9.800 17a1.700 1.700 0 0 1-2.400-2.400L15 7"/>',
    bookmark: '<path d="M6 3h12v18l-6-4.500L6 21z"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10.500 5-3v9l-5-3z"/>',
    laptop: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19.500h20"/>',
    key: '<circle cx="8" cy="15" r="4.500"/><path d="M11.500 11.500 20 3M16 7l3 3M13.500 9.500l2 2"/>'
  };
  function icon(n) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[n] || ICONS.info) + '</svg>';
  }
  function ic(n, cls) { return '<i data-icon="' + n + '"' + (cls ? ' class="' + cls + '"' : '') + '></i>'; }

  /* ---------------- role, theme, sidebar state ---------------- */
  var bodyRole = B.getAttribute('data-role') || 'any';
  var savedRole = LS.getItem('hmRole');
  var role = (bodyRole === 'owner' || bodyRole === 'agent') ? bodyRole : (savedRole || 'owner');
  var blocked = false;
  // Only the login page and "View as" may change the saved role. A signed-in agent who opens an owner page
  // gets the "Only for owners and admin" block; an owner who opens an agent page sees it without losing the owner role.
  if (bodyRole === 'owner' && (/[?&]as=agent/.test(location.search) || savedRole === 'agent')) { role = 'agent'; blocked = true; }
  else if ((bodyRole === 'owner' || bodyRole === 'agent') && !savedRole) LS.setItem('hmRole', role);
  var ME = role === 'owner' ? { name: 'Emir Dulovic', title: 'Founder & CEO · Owner', first: 'Emir' } : { name: 'Rocky Khan', title: 'Agent · Dubai off-plan', first: 'Rocky' };
  H.setAttribute('data-role', role);
  function setTheme(t) { H.setAttribute('data-theme', t); LS.setItem('hmTheme', t); $$('[data-theme-state]').forEach(function (n) { n.checked = t === 'dark'; }); }
  var MQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  // Auto (Settings → Appearance, key hmThemeMode='auto') follows this computer on every page
  if (LS.getItem('hmThemeMode') === 'auto' && MQ) H.setAttribute('data-theme', MQ.matches ? 'dark' : 'light');
  else H.setAttribute('data-theme', LS.getItem('hmTheme') || 'light');
  if (MQ && MQ.addEventListener) MQ.addEventListener('change', function () { if (LS.getItem('hmThemeMode') === 'auto') setTheme(MQ.matches ? 'dark' : 'light'); });
  function setSb(rail) { if (rail) H.setAttribute('data-sb', 'rail'); else H.removeAttribute('data-sb'); }
  var noShell = B.getAttribute('data-shell') === 'none';
  if (!noShell) setSb(LS.getItem('hmSb') === 'rail' || window.innerWidth < 1200);
  function setRole(r) { LS.setItem('hmRole', r); LS.setItem('hmNotifRead', ''); location.href = r === 'agent' ? 'my-day.html' : 'owner-home.html'; }

  /* ---------------- navigation data (file names from sage.md) ---------------- */
  // [key, label, icon, href, badge, badgeColour]
  var NAV = {
    owner: [
      { items: [['owner-home', 'Dashboard', 'grid', 'owner-home.html'], ['incoming', 'Incoming', 'inbox', 'incoming.html', 3, 'red']] },
      { label: 'Leads', items: [['all-leads', 'All leads', 'users', 'all-leads.html'], ['follow-ups', 'Follow-ups', 'clock', 'tasks.html#follow-ups', 9, 'red'], ['pipeline', 'Pipeline', 'columns', 'pipeline.html'], ['transfers', 'Transfers', 'swap', 'transfers.html', 1], ['import', 'Import', 'upload', 'import.html']] },
      { label: 'Plan', items: [['calendar', 'Calendar', 'calendar', 'calendar.html'], ['tasks', 'Tasks', 'tasks', 'tasks.html']] },
      { label: 'Projects', items: [['projects', 'Projects', 'building', 'projects.html'], ['sales-offers', 'Sales offers', 'tag', 'sales-offers.html']] },
      { label: 'Team', items: [['team', 'Team', 'user', 'team.html'], ['team-wall', 'Team wall', 'megaphone', 'team-wall.html'], ['attendance', 'Attendance', 'pin', 'team-attendance.html', 2], ['team-activity', 'Activity', 'activity', 'team-activity.html']] }
    ],
    agent: [
      { items: [['my-day', 'My Day', 'sun', 'my-day.html'], ['incoming', 'Incoming', 'inbox', 'incoming.html', 2]] },
      { label: 'Leads', items: [['my-leads', 'My leads', 'users', 'my-leads.html'], ['follow-ups', 'Follow-ups', 'clock', 'tasks.html#follow-ups', 1, 'red'], ['pipeline', 'Pipeline', 'columns', 'pipeline.html'], ['transfers', 'Transfers', 'swap', 'transfers.html', 1]] },
      { label: 'Plan', items: [['calendar', 'Calendar', 'calendar', 'calendar.html'], ['tasks', 'Tasks', 'tasks', 'tasks.html']] },
      { label: 'Projects', items: [['projects', 'Projects', 'building', 'projects.html'], ['sales-offers', 'Sales offers', 'tag', 'sales-offers.html']] },
      { label: 'Team', items: [['team', 'Team', 'user', 'team.html'], ['team-wall', 'Team wall', 'megaphone', 'team-wall.html'], ['attendance', 'Attendance', 'pin', 'attendance.html']] }
    ]
  };
  var LATER = [['inbox', 'Inbox', 'message', 'inbox.html'], ['email', 'Email', 'mail', 'email.html'], ['templates', 'Templates', 'layout', 'templates.html']];
  var BOTTOM = {
    owner: [['homes-ai', 'Homes AI', 'sparkles', 'homes-ai.html'], ['automations', 'Automations', 'zap', 'automations.html'], ['settings', 'Settings', 'settings', 'settings.html']],
    agent: [['homes-ai', 'Homes AI', 'sparkles', 'homes-ai.html'], ['settings', 'Settings', 'settings', 'settings.html']]
  };
  // sub-pages → the sidebar item that lights up
  var ALIAS = {
    dashboard: 'owner-home', lead: role === 'owner' ? 'all-leads' : 'my-leads', calling: 'my-leads', 'add-lead': role === 'owner' ? 'all-leads' : 'my-leads',
    project: 'projects', 'manage-projects': 'projects', 'home-banners': 'projects', 'best-of-homes': 'team',
    'team-attendance': 'attendance', 'team-live': 'team-activity', 'messaging-report': 'team-activity',
    'settings-team': 'settings', 'settings-attendance': 'settings', desks: 'settings', company: 'settings', 'ai-settings': 'settings',
    'system-health': 'settings', 'feedback-inbox': 'settings', 'install-guide': 'settings'
  };
  function activeKey() {
    var p = B.getAttribute('data-page') || '';
    if (p === 'tasks' && location.hash === '#follow-ups') return 'follow-ups';
    return ALIAS[p] || p;
  }

  /* ---------------- sidebar ---------------- */
  function navItem(it, later) {
    var b = it[4] ? '<span class="sb-badge' + (it[5] ? ' ' + it[5] : '') + '">' + it[4] + '</span>' : '';
    if (later) b = '<span class="sb-later">later</span>';
    return '<a class="sb-item' + (later ? ' later' : '') + '" data-key="' + it[0] + '" data-label="' + it[1] + (later ? ' · later' : '') + '" href="' + it[3] + '">' + ic(it[2]) + '<span class="sb-text">' + it[1] + '</span>' + b + '</a>';
  }
  function buildSidebar() {
    var h = '<aside class="sb" aria-label="Menu"><div class="sb-top"><a class="sb-logo" href="' + (role === 'owner' ? 'owner-home.html' : 'my-day.html') + '"><span class="sb-mark">' + ic('home') + '</span><b>homes<span>.</span>me</b></a>' +
      '<button class="sb-collapse" data-sb-toggle data-tip="Sidebar  [" aria-label="Collapse the sidebar">' + ic('sidebar') + '</button></div><nav class="sb-nav">';
    NAV[role].forEach(function (g) {
      h += '<div class="sb-group">' + (g.label ? '<div class="sb-label">' + g.label + '</div>' : '') + g.items.map(function (i) { return navItem(i); }).join('') + '</div>';
    });
    h += '<div class="sb-group later-group"><div class="sb-label">Later<em>not built yet</em></div><div class="sb-laterrow">' + LATER.map(function (i) { return '<a class="sb-item later" data-key="' + i[0] + '" data-label="' + i[1] + ' · later" href="' + i[3] + '">' + ic(i[2]) + '<span class="sb-text">' + i[1] + '</span></a>'; }).join('') + '</div></div>';
    h += '</nav><div class="sb-bottom">' + BOTTOM[role].map(function (i) { return navItem(i); }).join('') +
      '<button class="sb-profile" data-menu="#hm-profile-menu" aria-label="Your account"><span class="av me">' + initials(ME.name) + '</span><span class="who"><b>' + ME.name + '</b><span>' + ME.title + '</span></span>' + ic('chevron-up', 'i-sm') + '</button></div></aside>';
    B.insertBefore(el(h), B.firstChild);
    markActive();
    // collapsed sidebar: labels as floating tips (the old CSS tip was cut off by the scrolling list)
    var sbEl = $('.sb'), tip = el('<div class="sb-tip"></div>'); B.appendChild(tip);
    sbEl.addEventListener('mouseover', function (e) {
      var a = e.target.closest('.sb-item,.sb-profile'); if (!a || H.getAttribute('data-sb') !== 'rail') { tip.classList.remove('show'); return; }
      var r = a.getBoundingClientRect(), bd = $('.sb-badge', a), txt = a.getAttribute('data-label') || ME.name;
      tip.textContent = txt + (bd ? ' · ' + bd.textContent : ''); tip.style.left = (r.right + 10) + 'px'; tip.style.top = (r.top + r.height / 2) + 'px'; tip.classList.add('show');
    });
    sbEl.addEventListener('mouseleave', function () { tip.classList.remove('show'); });
    sbEl.addEventListener('click', function () { tip.classList.remove('show'); });
    // short screens: show that the list goes on
    var nav = $('.sb-nav');
    function more() { nav.classList.toggle('more', nav.scrollHeight - nav.scrollTop - nav.clientHeight > 6); nav.classList.toggle('more-up', nav.scrollTop > 6); }
    nav.addEventListener('scroll', more); window.addEventListener('resize', more); setTimeout(more, 0); setTimeout(more, 400);
    var act = $('.sb-nav .sb-item.on'); if (act && act.scrollIntoView && nav.scrollHeight > nav.clientHeight) act.scrollIntoView({ block: 'nearest' });
  }
  function markActive() {
    var k = activeKey();
    $$('.sb-item').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-key') === k); });
  }

  /* ---------------- top bar ---------------- */
  var NOTIFS = {
    owner: [
      ['crown', 'accent', 'VIP lead not called · Omar Khan', 'Bassam did not call in 30 min. The lead is back in Incoming.', '5 min', 'Give again', 'incoming.html', 1],
      ['swap', '', 'Transfer needs your approval', 'Rocky → Yuliia · Omar Khalil · stage Meeting', '12 min', 'Approve or refuse', 'transfers.html', 1],
      ['calendar', 'violet', 'Rocky asks for leave', 'Annual · 18–20 Nov · 3 days · "Family visit"', '48 min', 'Answer', 'team-attendance.html#leave', 1],
      ['trophy', 'green', 'Talha booked a unit', 'Damac Islands · AED 2.9M', '2 h', 'Open the team wall', 'team-wall.html', 1],
      ['flag', 'red', "Bug blocks Rocky's work", 'Call button fails on imported leads · 13:40', '1 h', 'Open the feedback inbox', 'feedback-inbox.html', 1],
      ['alert', 'red', 'Bassam is absent', 'No check-in and no leave. Alert at 10:00.', '4 h', 'See attendance', 'team-attendance.html', 1],
      ['shield', '', 'New sign-in · Shan', 'Chrome on Windows · Sharjah · 09:26', '5 h', 'Review', 'team-activity.html#unusual', 0],
      ['upload', '', 'Import finished · Nov_batch_C.xlsx', '208 new leads given to 6 agents.', 'Yesterday', 'Open the result', 'import.html', 0]
    ],
    agent: [
      ['crown', 'accent', 'VIP lead from Emir · Khalid Al Mansoori', 'Call within 30 min or the lead goes back.', '6 min', 'Open the VIP lead', 'my-day.html', 1],
      ['link', 'blue', 'Marco Bellini opened your brochure link', 'The Archive · opened 2 times', '18 min', 'Open the lead', 'lead.html?n=Marco%20Bellini', 1],
      ['swap', '', 'Yuliia wants to give you a lead', 'Fatima Al Zaabi · speaks Arabic · answer by 18:00', '40 min', 'Accept or refuse', 'transfers.html', 1],
      ['calendar', 'accent', 'How did the meeting go?', 'Omar Khalil · 12:00 · Office · Room 2 · answer before 21:00', '2 h', 'Answer', 'calendar.html#result', 1],
      ['clock', 'red', 'Follow-up is overdue', 'Sara Nunes · since 11:00', '3 h', 'Open follow-ups', 'tasks.html#follow-ups', 0],
      ['megaphone', '', 'Emir posted on the team wall', 'Cityscape Global · 17–19 Nov · stand B12', 'Yesterday', 'Read', 'team-wall.html', 0]
    ]
  };
  function buildTopbar() {
    var title = B.getAttribute('data-title') || (D.title.split(' · ')[0] || 'homes.me').trim();
    var sub = B.getAttribute('data-sub'), back = (B.getAttribute('data-back') || '').split('|');
    if (LS.getItem('hmNotifRead') === role) NOTIFS[role].forEach(function (n) { n[7] = 0; });
    var unread = NOTIFS[role].filter(function (n) { return n[7]; }).length;
    var st = LS.getItem('hmCheckin') || 'in';
    var pill = { 'in': ['', 'In office · 08:55'], out: ['amber', 'Check in'], outside: ['blue', 'Outside · back 15:00'] }[st] || ['', 'In office · 08:55'];
    if (LS.getItem('hmCheckinText')) pill = [pill[0], LS.getItem('hmCheckinText')];
    var h = '<header class="tb"><div class="tb-title">' +
      (back[0] ? '<a class="tb-back" href="' + back[0] + '">' + ic('arrow-left', 'i-sm') + (back[1] || 'Back') + '</a>' : '') +
      '<h1>' + title + '</h1>' + (sub && !back[0] ? '<span class="tb-sub">' + sub + '</span>' : '') + '</div><div class="tb-extra"></div>' +
      '<button class="tb-search" data-cmdk aria-label="Search">' + ic('search') + '<span>Search leads, phone, project…</span><kbd>Ctrl K</kbd></button><div class="tb-actions">' +
      (role === 'agent' ? '<a class="checkin-pill ' + pill[0] + '" id="hm-checkin" href="attendance.html">' + pill[1] + '</a>' : '') +
      '<span class="btn-split"><a class="btn dark" href="add-lead.html" data-tip="Add lead  (N)">' + ic('plus') + 'Add lead</a><button class="btn dark" data-menu="#hm-add-menu" aria-label="Add something else">' + ic('chevron-down') + '</button></span>' +
      '<button class="tb-round" data-notif data-tip="Notifications" aria-label="Notifications">' + ic('bell') + (unread ? '<span class="pip" id="hm-bell-pip">' + unread + '</span>' : '') + '</button>' +
      '<button class="tb-avatar" data-menu="#hm-profile-menu" aria-label="Your account"><span class="av me">' + initials(ME.name) + '</span></button></div></header>';
    B.insertBefore(el(h), $('main') || null);
    var extra = $('.tb-extra');
    $$('[data-topbar]').forEach(function (n) { while (n.firstChild) extra.appendChild(n.firstChild); n.remove(); });
    if (blocked) extra.style.display = 'none';

    B.appendChild(el('<div class="menu" id="hm-add-menu">' +
      '<a class="menu-item" href="add-lead.html">' + ic('user') + '<span class="grow">New lead</span><kbd>N</kbd></a>' +
      '<a class="menu-item" href="tasks.html">' + ic('tasks') + 'Task</a>' +
      '<a class="menu-item" href="tasks.html#follow-ups">' + ic('clock') + 'Follow-up</a>' +
      '<a class="menu-item" href="calendar.html#new">' + ic('calendar') + 'Meeting</a>' +
      (role === 'owner' ? '<div class="menu-sep"></div><a class="menu-item" href="import.html">' + ic('upload') + 'Import Excel</a>' : '') + '</div>'));
    B.appendChild(el('<div class="menu" id="hm-profile-menu" style="min-width:250px">' +
      '<div class="menu-head"><span class="av me lg">' + initials(ME.name) + '</span><div><b>' + ME.name + '</b><div class="small muted">' + ME.title + '</div></div></div><div class="menu-sep"></div>' +
      '<a class="menu-item" href="profile.html">' + ic('user') + 'My profile</a>' +
      '<a class="menu-item" href="digital-card.html">' + ic('card') + 'Business card</a>' +
      '<a class="menu-item" href="profile.html#security">' + ic('lock') + 'Security</a>' +
      '<a class="menu-item" href="feedback.html">' + ic('message') + 'Feedback</a><div class="menu-sep"></div>' +
      '<label class="menu-item" style="cursor:pointer">' + ic('moon') + '<span class="grow">Dark theme</span><span class="switch"><input type="checkbox" data-theme-state data-theme-toggle' + (H.getAttribute('data-theme') === 'dark' ? ' checked' : '') + '><span class="track"></span></span></label>' +
      '<button class="menu-item" data-role-switch="' + (role === 'owner' ? 'agent' : 'owner') + '">' + ic('eye') + '<span class="grow">View as ' + (role === 'owner' ? 'Agent · Rocky' : 'Owner · Emir') + '</span><span class="chip">demo</span></button>' +
      '<div class="menu-sep"></div><a class="menu-item danger" href="login.html">' + ic('logout') + 'Sign out</a></div>'));
  }
  function setCheckin(s, text) { // text is optional: HM.setCheckin('outside', 'Outside · back 16:30')
    // a bare time works too: HM.setCheckin('in', '14:55') → "In office · 14:55", ('outside', '16:30') → "Outside · back 16:30"
    if (/^\d{1,2}:\d\d$/.test(text || '')) text = s === 'in' ? 'In office · ' + text : s === 'outside' ? 'Outside · back ' + text : '';
    LS.setItem('hmCheckin', s); LS.setItem('hmCheckinText', text || '');
    var p = $('#hm-checkin'); if (!p) return;
    var m = { 'in': ['', 'In office · 08:55'], out: ['amber', 'Check in'], outside: ['blue', 'Outside · back 15:00'] }[s]; if (!m) return;
    p.className = 'checkin-pill ' + m[0]; p.textContent = text || m[1];
  }
  // HM.setBadge('incoming', 2) changes a sidebar number (0 removes it); HM.setBadge('bell', 3) changes the bell count
  function setBadge(key, n) {
    n = Math.max(0, +n || 0);
    if (key === 'bell') {
      var pip = $('#hm-bell-pip'), btn = $('.tb-round[data-notif]');
      if (!n) { if (pip) pip.remove(); return; }
      if (!pip && btn) { pip = el('<span class="pip" id="hm-bell-pip"></span>'); btn.appendChild(pip); }
      if (pip) pip.textContent = n; return;
    }
    var a = $('.sb .sb-item[data-key="' + key + '"]'); if (!a) return;
    var b = $('.sb-badge', a);
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = el('<span class="sb-badge"></span>'); a.appendChild(b); }
    b.textContent = n;
  }

  /* ---------------- notification panel ---------------- */
  function buildNotif() {
    var rows = NOTIFS[role].map(function (n) {
      return '<a class="notif' + (n[7] ? ' unread' : '') + '" href="' + n[6] + '"><span class="ic ' + n[1] + '">' + ic(n[0]) + '</span><span class="body"><b>' + n[2] + '</b><p>' + n[3] + '</p><span class="act">' + n[5] + ' →</span></span><span class="age">' + n[4] + '</span></a>';
    }).join('');
    B.appendChild(el('<aside class="panel" id="hm-notif" aria-label="Notifications"><div class="panel-head"><h2>Notifications</h2>' +
      '<button class="btn sm ghost" id="hm-mark-read">Mark all read</button><button class="btn icon sm ghost" data-close aria-label="Close">' + ic('x') + '</button></div>' +
      '<div class="panel-body">' + rows + '</div><div class="panel-foot"><a class="btn sm" href="notifications.html">See all</a><span class="grow"></span><a class="card-link" href="settings.html#notifications">Choose what reaches you ' + ic('arrow-right', 'i-sm') + '</a></div></aside>'));
    $('#hm-mark-read').addEventListener('click', function () {
      $$('#hm-notif .unread').forEach(function (n) { n.classList.remove('unread'); });
      var pip = $('#hm-bell-pip'); if (pip) pip.remove(); LS.setItem('hmNotifRead', role); toast('All marked as read');
    });
  }

  /* ---------------- command palette ---------------- */
  var CMD = [];
  function buildCmdk() {
    var leadPage = 'lead.html';
    [['Khalid Al Mansoori', '+971 50 555 0101', 'The Archive · New · VIP'], ['Marco Bellini', '+39 333 455 4821', 'The Archive · Interested'], ['Sara Nunes', '+351 91 234 5678', 'Damac Islands · Called'],
     ['Priya Shah', '+91 98765 43210', 'Valia · Interested'], ['Lucas Martin', '+33 6 12 34 56 78', 'The Archive · Interested'], ['Ahmed Hassan', '+966 50 123 4567', 'Shahrukhz · Called'],
     ['Elena Kuznetsova', '+7 912 345 67 89', 'Damac Islands · Offer'], ['Omar Khalil', '+971 50 222 3344', 'Valia · Meeting'], ['Hanna Alabbas', '+971 55 320 7788', 'The Archive · Called'],
     ['Dave Patel', '+44 7700 900 456', 'Shahrukhz · Called'], ['Bridget Cardoso', '+351 91 220 1188', 'The Archive · Interested'], ['Sami Najahi', '+971 50 410 2233', 'The Archive · New']
    ].forEach(function (l, i) { CMD.push({ g: 'Leads', t: l[0], s: l[1] + ' · ' + l[2], i: 'user', h: leadPage + '?n=' + encodeURIComponent(l[0]), recent: i < 3 }); });
    if (role === 'agent') [['Lina Rahimi', 'Free lead · in Incoming', 'incoming.html'], ['Kevin Brooks', 'Free lead · in Incoming', 'incoming.html'], ['Daniel Rossi', 'with Nelson', 'team.html'], ['Aisha Noor', 'with Talha', 'team.html'], ['Fatima Al Zaabi', 'with Yuliia · transfer request for you', 'transfers.html']].forEach(function (l) { CMD.push({ g: 'Leads', t: l[0], s: l[1], i: 'user', h: l[2] }); });
    else [['Lina Rahimi', 'Damac Islands · waits in Incoming', 'incoming.html'], ['Kevin Brooks', 'The Archive · waits in Incoming', 'incoming.html'], ['Omar Khan', 'Shahrukhz · VIP · waits in Incoming', 'incoming.html'], ['Daniel Rossi', 'The Archive · VIP · with Nelson', 'lead.html?n=Daniel%20Rossi&pr=The%20Archive&a=Nelson'], ['Aisha Noor', 'Damac Islands · VIP · with Talha', 'lead.html?n=Aisha%20Noor&pr=Damac%20Islands&a=Talha'], ['Fatima Al Zaabi', 'Valia · with Yuliia', 'lead.html?n=Fatima%20Al%20Zaabi&pr=Valia&a=Yuliia']].forEach(function (l) { CMD.push({ g: 'Leads', t: l[0], s: l[1], i: 'user', h: l[2] }); });
    [['Talha', 'Agent · Dubai off-plan'], ['Rocky Khan', 'Agent · Dubai off-plan'], ['Yuliia', 'Agent · Dubai off-plan'], ['Olga', 'Agent · Dubai off-plan'], ['Srdjan', 'Agent · Dubai off-plan'], ['Tej', 'Agent · Dubai off-plan'], ['Shan', 'Agent · Arabic desk'], ['Nelson', 'Agent · Abu Dhabi'], ['Sultan', 'Agent · Arabic desk'], ['Bassam', 'Agent · Abu Dhabi'],
     ['Emir Dulovic', 'Founder & CEO · Owner'], ['George Vanous', 'Partner · Owner'], ['Abdullah Mahi', 'Office admin']].forEach(function (p) { CMD.push({ g: 'People', t: p[0], s: p[1], i: 'users', h: 'team.html' }); });
    [['The Archive', 'Imtiaz · Business Bay · from AED 1.6M'], ['Shahrukhz', 'Danube · Sheikh Zayed Road · from AED 1.2M'], ['Damac Islands', 'Damac · Dubailand · from AED 2.7M'], ['Valia', 'Emaar · The Oasis · launching soon']
    ].forEach(function (p) { CMD.push({ g: 'Projects', t: p[0], s: p[1], i: 'building', h: 'project.html' }); });
    NAV[role].forEach(function (g) { g.items.forEach(function (i) { CMD.push({ g: 'Screens', t: i[1], s: '', i: i[2], h: i[3] }); }); });
    BOTTOM[role].forEach(function (i) { CMD.push({ g: 'Screens', t: i[1], s: '', i: i[2], h: i[3] }); });
    [['Notifications', 'bell', 'notifications.html'], ['My profile', 'user', 'profile.html'], ['Business card', 'card', 'digital-card.html'], ['Best of Homes', 'trophy', 'best-of-homes.html'], ['Feedback', 'message', 'feedback.html']]
      .concat(role === 'owner' ? [['Full dashboard', 'chart', 'dashboard.html'], ['Team & roles', 'users', 'settings-team.html'], ['Desks', 'building', 'desks.html'], ['Messaging report', 'whatsapp', 'messaging-report.html'], ['Company', 'building', 'company.html'], ['System health', 'activity', 'system-health.html']] : [['Start calling', 'phone', 'calling.html']])
      .forEach(function (s) { CMD.push({ g: 'Screens', t: s[0], s: '', i: s[1], h: s[2] }); });
    // more screens; the 4th value = extra words people may type
    [['My notification settings', 'bell', 'settings.html#notifications', 'alerts quiet hours sound'], ['Appearance · light or dark', 'moon', 'settings.html#general', 'theme sounds language'],
     ['Security · password', 'lock', 'profile.html#security', 'two-step devices'], ['Phone app · how to install', 'download', 'install-guide.html', 'iphone android notifications'],
     ['Search page', 'search', 'search.html', 'find'], ['Leave requests', 'calendar', role === 'owner' ? 'team-attendance.html#leave' : 'attendance.html#leave', 'holiday sick annual'],
     ['Inbox · later', 'message', 'inbox.html', 'whatsapp telegram chats'], ['Email · later', 'mail', 'email.html', ''], ['Templates · later', 'layout', 'templates.html', 'whatsapp messages']]
      .concat(role === 'owner' ? [['Manage projects', 'building', 'manage-projects.html', 'brochure add project hidden selling'], ['Home banners', 'image', 'home-banners.html', 'my day slides'],
        ['Attendance rules', 'pin', 'settings-attendance.html', 'wifi wi-fi shift late days off'], ['Homes AI settings', 'sparkles', 'ai-settings.html', 'budget limit'], ['Feedback inbox', 'inbox', 'feedback-inbox.html', 'bugs ideas'],
        ['Team live', 'activity', 'team-live.html', 'online now clicks'], ['Invite a person', 'plus', 'settings-team.html', 'new agent roles deactivate']] : [['Check in · my attendance', 'pin', 'attendance.html', 'office outside late']])
      .forEach(function (s) { CMD.push({ g: 'Screens', t: s[0], s: '', i: s[1], h: s[2], k: s[3] }); });
    CMD.push({ g: 'Actions', t: 'Sign out', s: '', i: 'logout', h: 'login.html' });
    CMD.push({ g: 'Actions', t: 'Add a new lead', s: 'N', i: 'plus', h: 'add-lead.html', common: 1 });
    if (role === 'owner') CMD.push({ g: 'Actions', t: 'Import Excel', s: '6 steps', i: 'upload', h: 'import.html', common: 1 });
    else CMD.push({ g: 'Actions', t: 'Start calling', s: '12 ready', i: 'phone', h: 'calling.html', common: 1 });
    CMD.push({ g: 'Actions', t: 'Ask Homes AI', s: '', i: 'sparkles', h: 'homes-ai.html', common: 1 });
    CMD.push({ g: 'Actions', t: 'Switch light / dark theme', s: '', i: 'moon', f: function () { LS.setItem('hmThemeMode', ''); setTheme(H.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }, common: 1 });
    B.appendChild(el('<div class="cmdk" id="hm-cmdk" role="dialog" aria-label="Search"><div class="cmdk-input">' + ic('search', 'i-lg') + '<input type="text" placeholder="Name, phone, project, screen" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>' +
      '<div class="cmdk-list"></div><div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span class="grow"></span><span>Any phone format works</span></div></div>'));
    var box = $('#hm-cmdk'), inp = $('input', box), list = $('.cmdk-list', box), sel = 0, cur = [];
    function digits(s) { return s.replace(/\D/g, ''); }
    function render() {
      var q = inp.value.trim().toLowerCase(), qd = digits(q), h = '', last = '';
      if (!q) cur = CMD.filter(function (c) { return c.recent; }).map(function (c) { return Object.assign({}, c, { g: 'Recent leads' }); }).concat(CMD.filter(function (c) { return c.common; }).map(function (c) { return Object.assign({}, c, { g: 'Common actions' }); }));
      else {
        // phone: 0505550101 and 00971505550101 find +971 50 555 0101 (leading 00 or 0 is dropped)
        var q0 = qd.replace(/^00/, ''), q1 = qd.replace(/^0+/, ''), isPhone = qd.length > 2 && !/[a-z]/.test(q), grp = {};
        cur = CMD.map(function (c) {
          var t = c.t.toLowerCase(), pd = digits(c.s), sc = -1;
          if (t.indexOf(q) === 0) sc = 0; else if (t.indexOf(q) > -1) sc = 1; else if ((c.s + ' ' + (c.k || '')).toLowerCase().indexOf(q) > -1) sc = 2;
          else if (isPhone && pd && (pd.indexOf(qd) > -1 || (q0.length > 2 && pd.indexOf(q0) > -1) || (q1.length > 4 && pd.indexOf(q1) > -1))) sc = 0;
          return { c: c, sc: sc };
        }).filter(function (x) { return x.sc > -1; });
        // the group with the best match comes first (typing "archive" puts the project above the leads that only mention it)
        cur.forEach(function (x) { if (grp[x.c.g] == null || x.sc < grp[x.c.g]) grp[x.c.g] = x.sc; });
        var order = ['Leads', 'People', 'Projects', 'Screens', 'Actions'];
        cur.sort(function (a, b) { return (grp[a.c.g] - grp[b.c.g]) || (order.indexOf(a.c.g) - order.indexOf(b.c.g)) || (a.sc - b.sc); });
        cur = cur.slice(0, 14).map(function (x) { return x.c; });
        if (cur.length) cur.push({ g: 'More', t: 'See all results for "' + inp.value.trim() + '"', s: '', i: 'search', h: 'search.html?q=' + encodeURIComponent(inp.value.trim()) });
      }
      if (q && !cur.length) cur = [{ g: 'Nothing found', t: 'Add "' + inp.value.trim() + '" as a new lead', s: '', i: 'plus', h: 'add-lead.html' }, { g: 'Nothing found', t: 'Ask Homes AI about "' + inp.value.trim() + '"', s: '', i: 'sparkles', h: 'homes-ai.html' }];
      if (sel >= cur.length) sel = 0;
      cur.forEach(function (c, i) {
        if (c.g !== last) { h += '<div class="cmdk-group">' + c.g + '</div>'; last = c.g; }
        h += '<div class="cmdk-item' + (i === sel ? ' sel' : '') + '" data-i="' + i + '"><span class="ic">' + icon(c.i) + '</span><span class="t"><b>' + c.t + '</b><span>' + c.s + '</span></span><span class="tag">' + (/Recent|Common|Nothing|More/.test(c.g) ? '' : c.g.replace(/s$/, '').replace('People', 'Person')) + '</span></div>';
      });
      list.innerHTML = h;
      $$('.ic svg', list).forEach(function (s) { s.style.cssText = 'width:16px;height:16px'; });
      var s = $('.sel', list); if (s) s.scrollIntoView({ block: 'nearest' });
    }
    function go(i) { var c = cur[i]; if (!c) return; closeAll(); if (c.f) c.f(); else location.href = c.h; }
    inp.addEventListener('input', function () { sel = 0; render(); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, cur.length - 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
      else if (e.key === 'Enter') go(sel);
    });
    list.addEventListener('click', function (e) { var it = e.target.closest('.cmdk-item'); if (it) go(+it.getAttribute('data-i')); });
    list.addEventListener('mousemove', function (e) { var it = e.target.closest('.cmdk-item'); if (it && +it.getAttribute('data-i') !== sel) { sel = +it.getAttribute('data-i'); $$('.cmdk-item', list).forEach(function (n) { n.classList.toggle('sel', n === it); }); } });
    box._show = function () { inp.value = ''; sel = 0; render(); void box.offsetWidth; inp.focus(); setTimeout(function () { inp.focus(); }, 80); setTimeout(function () { inp.focus(); }, 220); };
  }

  /* ---------------- overlays: scrim, panel, dialog, menu ---------------- */
  var scrim = el('<div class="scrim"></div>'); B.appendChild(scrim);
  function syncScrim() { scrim.classList.toggle('show', !!$('.panel.open,.dialog.open,.cmdk.open')); }
  function open(sel) {
    var t = typeof sel === 'string' ? $(sel) : sel; if (!t) return;
    closeMenus();
    if (t.classList.contains('dialog') || t.classList.contains('cmdk')) $$('.dialog.open,.cmdk.open').forEach(function (n) { n.classList.remove('open'); });
    if (t.classList.contains('panel')) $$('.panel.open').forEach(function (n) { n.classList.remove('open'); });
    t.classList.add('open'); if (t._show) t._show(); syncScrim(); fire(t, 'hm:open');
    return t;
  }
  function close(t) {
    if (t) t.classList.remove('open');
    else { var top = $('.cmdk.open') || $('.dialog.open') || $('.panel.open'); if (top) top.classList.remove('open'); }
    syncScrim();
  }
  function closeAll() { $$('.panel.open,.dialog.open,.cmdk.open').forEach(function (n) { n.classList.remove('open'); }); closeMenus(); syncScrim(); }
  function closeMenus() { $$('.menu.open').forEach(function (m) { m.classList.remove('open'); }); }
  function toggleMenu(btn) {
    var m = $(btn.getAttribute('data-menu')); if (!m) return;
    var was = m.classList.contains('open'); closeMenus(); if (was) return;
    m.classList.add('open'); m._src = btn;
    var r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight, x = r.right - w, y = r.bottom + 6;
    if (x < 8) x = Math.max(8, r.left);
    if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 6);
    m.style.left = x + 'px'; m.style.top = y + 'px';
  }
  scrim.addEventListener('click', closeAll);

  /* ---------------- toast ---------------- */
  var toasts = el('<div class="toasts" aria-live="polite"></div>'); B.appendChild(toasts);
  function toast(text, o) {
    o = o || {};
    var t = el('<div class="toast' + (o.error ? ' error' : '') + '"><span></span></div>'); t.firstChild.textContent = text;
    function gone() { t.classList.add('out'); setTimeout(function () { t.remove(); }, 220); }
    if (o.undo) { var u = el('<button>Undo</button>'); u.onclick = function () { gone(); o.undo(); }; t.appendChild(u); }
    if (o.error) { var x = el('<button class="x" aria-label="Close">×</button>'); x.onclick = gone; t.appendChild(x); }
    toasts.appendChild(t); while (toasts.children.length > 2) toasts.firstChild.remove();
    if (!o.error) setTimeout(gone, 5000);
    return t;
  }
  function slideOut(n, cb) {
    if (!n) return; n.style.height = n.offsetHeight + 'px'; void n.offsetHeight; n.classList.add('slide-out');
    setTimeout(function () { n.style.display = 'none'; n.classList.remove('slide-out'); n.style.height = ''; if (cb) cb(n); else n.remove(); }, 330);
  }

  /* ---------------- decorate: icons, avatars, sparklines, count-up ---------------- */
  function initials(name) { var p = name.trim().split(/\s+/); return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : (p[0][1] || ''))).toUpperCase(); }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function refresh(root) {
    root = root || D;
    $$('i[data-icon]', root).forEach(function (n) { if (!n.firstChild) n.innerHTML = icon(n.getAttribute('data-icon')); });
    $$('.av[data-name]', root).forEach(function (n) {
      if (n._done) return; n._done = 1; var nm = n.getAttribute('data-name');
      if (!n.textContent.trim()) n.textContent = initials(nm);
      if (!/\bc[1-8]\b|\bme\b/.test(n.className)) n.classList.add('c' + (hash(nm) % 8 + 1));
      if (!n.title) n.title = nm;
    });
    $$('svg[data-spark]', root).forEach(function (s) {
      if (s._done) return; s._done = 1;
      var v = s.getAttribute('data-spark').split(',').map(Number), W = s.clientWidth || 72, Hh = s.clientHeight || 22, mx = Math.max.apply(0, v), mn = Math.min.apply(0, v), rg = (mx - mn) || 1;
      if (mx === 0) s.classList.add('flat');
      var pts = v.map(function (y, i) { return [(i / (v.length - 1)) * (W - 6) + 3, Hh - 4 - ((y - mn) / rg) * (Hh - 8)]; });
      var line = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '), lp = pts[pts.length - 1];
      s.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
      s.innerHTML = '<path d="M' + line.replace(/ /g, ' L') + ' L' + (W - 3) + ',' + Hh + ' L3,' + Hh + ' Z"/><polyline points="' + line + '" vector-effect="non-scaling-stroke"/><circle cx="' + lp[0].toFixed(1) + '" cy="' + lp[1].toFixed(1) + '" r="2.4"/>';
    });
    $$('[data-count]', root).forEach(function (n) {
      if (n._done) return; n._done = 1;
      var raw = n.textContent.trim(), m = raw.match(/^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/); if (!m) return;
      var end = parseFloat(m[2].replace(/,/g, '')), dec = (m[2].split('.')[1] || '').length, comma = m[2].indexOf(',') > -1, t0 = null;
      function fmt(x) { var s = x.toFixed(dec); return comma ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s; }
      function step(ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / 600), e = 1 - Math.pow(1 - p, 3); n.textContent = m[1] + fmt(end * e) + m[3]; if (p < 1) requestAnimationFrame(step); }
      n.textContent = m[1] + fmt(0) + m[3]; requestAnimationFrame(step);
    });
    time24(root);
    $$('[data-countdown]', root).forEach(function (n) { if (n._left == null && !n.textContent.trim()) n.textContent = mmss(secs(n.getAttribute('data-countdown'))); });
    $$('.bars.grow-in', root).forEach(function (b) { setTimeout(function () { b.classList.remove('grow-in'); }, 80); });
  }

  /* ---------------- 24-hour time boxes (Abdullah): a native time field shows AM/PM on some computers ---------------- */
  function time24(root) {
    $$('input[type=time]', root || D).forEach(function (i) {
      var v = i.value, T = /^([01]?\d|2[0-3]):[0-5]\d$/;
      i.type = 'text'; i.value = v; i._ok = v; i.setAttribute('data-time', ''); i.setAttribute('inputmode', 'numeric'); i.setAttribute('maxlength', '5');
      if (!i.placeholder) i.placeholder = 'HH:MM'; if (!i.title) i.title = '24-hour clock, like 09:00 or 18:30';
      i.addEventListener('input', function () {
        var d = i.value.replace(/[^\d:]/g, ''); if (/^\d{3,4}$/.test(d)) d = d.slice(0, d.length - 2) + ':' + d.slice(-2);
        if (d !== i.value) i.value = d; if (T.test(d)) i._ok = d;
      });
      i.addEventListener('blur', function () {
        var d = i.value.trim(); if (/^\d{1,2}$/.test(d) && +d < 24) d += ':00';
        if (!T.test(d)) d = (i.required || d) ? i._ok : '';
        if (d && d.length < 5) d = '0' + d;
        if (d !== i.value) { i.value = d; i._ok = d || i._ok; fire(i, 'input'); fire(i, 'change'); }
      });
    });
  }

  /* ---------------- countdowns ---------------- */
  function secs(s) { var p = String(s).split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + (p[1] || 0); }
  function mmss(t) { var m = Math.floor(t / 60), s = t % 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
  function tick() {
    $$('[data-countdown]').forEach(function (n) {
      if (n._left == null) { n._left = secs(n.getAttribute('data-countdown')); n._total = secs(n.getAttribute('data-countdown-total') || n.getAttribute('data-countdown')); }
      else if (n._left > 0 && !n.hasAttribute('data-paused')) n._left--;
      var ring = n.closest('.ring');
      if (n._left <= 0) { if (!n._over) { n._over = 1; n.textContent = n.getAttribute('data-over') || '00:00'; n.classList.remove('warn'); n.classList.add('over'); if (ring) ring.style.setProperty('--p', 0); fire(n, 'hm:timeup'); } return; }
      n.textContent = mmss(n._left); n.classList.toggle('warn', n._left < 600);
      if (ring) ring.style.setProperty('--p', (n._left / n._total * 100).toFixed(2));
    });
  }

  /* ---------------- tabs ---------------- */
  function showTab(btn) {
    var name = btn.getAttribute('data-tab'), grp = btn.parentNode;
    $$('[data-tab]', grp).forEach(function (b) { b.classList.toggle('on', b === btn); });
    var names = $$('[data-tab]', grp).map(function (b) { return b.getAttribute('data-tab'); });
    $$('[data-panel]').forEach(function (p) { var pn = p.getAttribute('data-panel'); if (names.indexOf(pn) > -1) p.hidden = pn !== name; });
    fire(btn, 'hm:tab', { value: name });
  }
  function tabFromHash() {
    var h = location.hash.slice(1); if (!h) return;
    var b = $('[data-tab="' + h.replace(/"/g, '') + '"]'); if (b) showTab(b);
  }

  /* ---------------- table selection ---------------- */
  function syncSelect(table) {
    var boxes = $$('tbody input[type=checkbox]', table), n = 0;
    boxes.forEach(function (b) { var tr = b.closest('tr'); tr.classList.toggle('selected', b.checked); if (b.checked) n++; });
    var all = $('[data-select-all]', table); if (all) { all.checked = n > 0 && n === boxes.length; all.indeterminate = n > 0 && n < boxes.length; }
    $$('.bulkbar').forEach(function (bar) {
      if ($(bar.getAttribute('data-bulk')) !== table) return;
      bar.classList.toggle('show', n > 0); $$('[data-bulk-count]', bar).forEach(function (c) { c.textContent = n; });
    });
    fire(table, 'hm:select', { count: n });
  }

  /* ---------------- forms ---------------- */
  function validate(form) {
    var ok = true, first = null;
    $$('input,select,textarea', form).forEach(function (i) {
      var f = i.closest('.field'); if (!f || i.type === 'checkbox' || i.type === 'radio') return;
      var v = i.value.trim(), bad = false;
      if (i.required && !v) bad = true;
      if (v && i.hasAttribute('data-digits') && /\D/.test(v.replace(/[\s+()-]/g, ''))) bad = true;
      if (v && i.getAttribute('data-min') && v.replace(/\s/g, '').length < +i.getAttribute('data-min')) bad = true;
      if (v && i.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) bad = true;
      f.classList.toggle('invalid', bad);
      if (bad) {
        var e = $('.error', f); if (!e) { e = el('<span class="error"></span>'); f.appendChild(e); }
        e.textContent = i.getAttribute('data-error') || e.textContent || 'Please fill this in.';
        ok = false; if (!first) first = i;
      }
    });
    if (first) first.focus();
    return ok;
  }

  /* ---------------- inline edit (key-value rows) ---------------- */
  function editRow(row) {
    if (row.classList.contains('editing')) return;
    var dd = $('dd', row), old = dd.textContent.trim(), inp = el('<input type="text">'); inp.value = old;
    row.classList.add('editing'); dd.textContent = ''; dd.appendChild(inp); inp.focus(); inp.select();
    function done(save) {
      if (!row.classList.contains('editing')) return; row.classList.remove('editing');
      var v = inp.value.trim() || old; dd.textContent = save ? v : old;
      if (save && v !== old) { toast('Saved · ' + $('dt', row).textContent.trim() + ': ' + old + ' → ' + v, { undo: function () { dd.textContent = old; } }); fire(row, 'hm:edit', { value: v, old: old }); }
    }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
    inp.addEventListener('blur', function () { done(true); });
  }

  /* ---------------- confetti ---------------- */
  function confetti() {
    var c = el('<div style="position:fixed;inset:0;pointer-events:none;z-index:200;overflow:hidden"></div>'), cols = ['#FF5A2E', '#17A569', '#3E7BFA', '#E89B0C', '#8B5CF6', '#16151A'];
    for (var i = 0; i < 70; i++) {
      var p = D.createElement('i'), x = 50 + (Math.random() - .5) * 30, dx = (Math.random() - .5) * 90, dy = 60 + Math.random() * 50;
      p.style.cssText = 'position:absolute;left:' + x + '%;top:38%;width:8px;height:12px;border-radius:2px;background:' + cols[i % 6];
      p.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: 'translate(' + dx + 'vw,' + dy + 'vh) rotate(' + (Math.random() * 900) + 'deg)', opacity: 0 }], { duration: 1400 + Math.random() * 900, easing: 'cubic-bezier(.1,.6,.3,1)', fill: 'forwards' });
      c.appendChild(p);
    }
    B.appendChild(c); setTimeout(function () { c.remove(); }, 2500);
  }

  /* ---------------- one click handler for every data-attribute ---------------- */
  function inner(e, host) { // click landed on a control inside a clickable row/card?
    var t = e.target.closest('a,button,input,label,select,textarea,[data-open],[data-menu],[data-href]');
    return t && t !== host && host.contains(t);
  }
  D.addEventListener('click', function (e) {
    var t = e.target, n;
    if (!t.closest) return;
    if (!t.closest('.menu') && !t.closest('[data-menu]')) closeMenus();

    // two-click confirm: the first click only arms the button
    if ((n = t.closest('[data-confirm]'))) {
      if (!n._armed) {
        e.preventDefault(); e.stopPropagation();
        n._armed = 1; n._html = n.innerHTML; n.style.minWidth = n.offsetWidth + 'px'; n.textContent = n.getAttribute('data-confirm'); n.classList.add('confirming');
        n._timer = setTimeout(function () { n._armed = 0; n.innerHTML = n._html; n.classList.remove('confirming'); }, 3000);
        return;
      }
      clearTimeout(n._timer); n._armed = 0; n.innerHTML = n._html; n.classList.remove('confirming'); fire(n, 'hm:confirm');
    }
    if ((n = t.closest('[data-menu]'))) { e.preventDefault(); toggleMenu(n); return; }
    if (t.closest('.menu-item') && !t.closest('label')) setTimeout(closeMenus, 0);
    if ((n = t.closest('[data-cmdk]'))) { open('#hm-cmdk'); return; }
    if ((n = t.closest('[data-notif]'))) { open('#hm-notif'); return; }
    if ((n = t.closest('[data-sb-toggle]'))) { var rail = H.getAttribute('data-sb') !== 'rail'; setSb(rail); LS.setItem('hmSb', rail ? 'rail' : 'full'); return; }
    if ((n = t.closest('[data-theme-toggle]'))) { LS.setItem('hmThemeMode', ''); if (n.tagName === 'INPUT') setTheme(n.checked ? 'dark' : 'light'); else setTheme(H.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); return; }
    if ((n = t.closest('[data-role-switch]'))) { setRole(n.getAttribute('data-role-switch')); return; }

    if ((n = t.closest('[data-tab]'))) showTab(n);
    if ((n = t.closest('[data-seg] > *'))) {
      $$(':scope > *', n.parentNode).forEach(function (b) { b.classList.toggle('on', b === n); });
      fire(n.parentNode, 'hm:change', { value: n.getAttribute('data-value') || n.textContent.trim() });
    }
    if ((n = t.closest('[data-chips] > *')) && !n.disabled) {
      var g = n.parentNode;
      if (g.getAttribute('data-chips') === 'multi') n.classList.toggle('on');
      else $$(':scope > *', g).forEach(function (b) { b.classList.toggle('on', b === n); });
      fire(g, 'hm:change', { value: n.getAttribute('data-value') || n.textContent.trim(), values: $$(':scope > .on', g).map(function (b) { return b.getAttribute('data-value') || b.textContent.trim(); }) });
    }
    if ((n = t.closest('.filter-chip button'))) { var ch = n.closest('.filter-chip'), fl = ch.closest('.filters'); ch.remove(); if (fl) fire(fl, 'hm:filters'); return; }
    if ((n = t.closest('[data-clear-filters]'))) { var f2 = n.closest('.filters') || D; $$('.filter-chip', f2).forEach(function (c) { c.remove(); }); fire(f2 === D ? B : f2, 'hm:filters'); }
    if ((n = t.closest('[data-bulk-cancel]'))) { var tb = $(n.closest('.bulkbar').getAttribute('data-bulk')); $$('input[type=checkbox]', tb).forEach(function (b) { b.checked = false; }); syncSelect(tb); }
    if ((n = t.closest('.kv-row[data-edit]')) && !t.closest('input')) editRow(n);

    if ((n = t.closest('[data-toast]')) && n.tagName !== 'FORM' && !inner(e, n)) {
      var src = n; toast(n.getAttribute('data-toast'), n.hasAttribute('data-undo') ? { undo: function () { fire(src, 'hm:undo'); } } : null);
    }
    if ((n = t.closest('[data-remove]')) && !inner(e, n)) slideOut(n.closest(n.getAttribute('data-remove')));
    if ((n = t.closest('[data-close]'))) close(n.closest('.panel,.dialog,.cmdk'));
    if ((n = t.closest('[data-open]')) && !inner(e, n)) { e.preventDefault(); open(n.getAttribute('data-open')); }
    if ((n = t.closest('[data-href]')) && !inner(e, n) && !window.getSelection().toString()) location.href = n.getAttribute('data-href');
  });
  D.addEventListener('change', function (e) {
    var t = e.target, table = t.closest && t.closest('table[data-select]'); if (!table || t.type !== 'checkbox') return;
    if (t.hasAttribute('data-select-all')) $$('tbody input[type=checkbox]', table).forEach(function (b) { if (!b.closest('tr').hidden) b.checked = t.checked; });
    syncSelect(table);
  });
  D.addEventListener('submit', function (e) {
    var f = e.target; if (!f.matches || !f.matches('form[data-form]')) return;
    e.preventDefault();
    if (!validate(f)) return;
    if (f.getAttribute('data-toast')) toast(f.getAttribute('data-toast'));
    var ov = f.closest('.dialog,.panel'); if (ov && !f.hasAttribute('data-keep')) close(ov);
    fire(f, 'hm:submit');
  });
  D.addEventListener('input', function (e) { var f = e.target.closest && e.target.closest('.field.invalid'); if (f) f.classList.remove('invalid'); });
  D.addEventListener('keydown', function (e) {
    var typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if ($('#hm-cmdk')) open('#hm-cmdk'); return; }
    if (e.key === 'Escape') { if ($('.menu.open')) closeMenus(); else close(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || noShell) return;
    if (e.key === '/') { e.preventDefault(); open('#hm-cmdk'); }
    else if (e.key === '[') { var s = $('[data-sb-toggle]'); if (s) s.click(); }
    else if (e.key.toLowerCase() === 'n' && !$('.panel.open,.dialog.open')) location.href = 'add-lead.html';
  });
  window.addEventListener('hashchange', function () { markActive(); tabFromHash(); });
  window.addEventListener('scroll', closeMenus, true);

  /* ---------------- start ---------------- */
  window.HM = { role: role, me: ME, toast: toast, open: open, close: close, slideOut: slideOut, icon: icon, refresh: refresh, confetti: confetti, setCheckin: setCheckin, setBadge: setBadge, setRole: setRole, setTheme: setTheme, initials: initials };
  $$('[data-only]').forEach(function (n) { if (n.getAttribute('data-only') !== role) n.remove(); });
  $$('form[data-form]').forEach(function (f) { f.setAttribute('novalidate', ''); });
  if (!noShell) {
    if (blocked) {
      var m = $('main'); if (m) { m.classList.add('blocked'); m.appendChild(el('<div class="owner-only"><span class="ic">' + ic('lock', 'i-xl') + '</span><h2>Only for owners and admin</h2><p>This page is for Emir, George and Abdullah. Your own work is on My Day.</p><a class="btn primary" href="my-day.html">Go to My Day</a></div>')); }
    }
    buildSidebar(); buildTopbar(); buildNotif(); buildCmdk();
  }
  refresh(D); tabFromHash(); tick(); setInterval(tick, 1000);
  $$('table[data-select]').forEach(syncSelect);
})();

/* Team leader: keep link filters (?n=…, ?agent=…) when the host drops query strings.
   The clicked link's query is remembered for its page and restored on load. */
(function () {
  try {
    var page = (location.pathname.split('/').pop() || 'index.html');
    var k = 'hmQ:' + page, saved = sessionStorage.getItem(k);
    if (saved) { sessionStorage.removeItem(k); if (!location.search) { try { history.replaceState(null, '', location.pathname + saved + location.hash); } catch (e) {} } }
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest && ev.target.closest('a[href]'); if (!a) return;
      var h = a.getAttribute('href') || ''; var m = /^([\w-]+\.html)(\?[^#]*)/.exec(h);
      if (m) { try { sessionStorage.setItem('hmQ:' + m[1], m[2]); } catch (e) {} }
    }, true);
  } catch (e) {}
})();

/* =====================================================================================
   homes.me CRM · lead-kit.js · by Luna · loaded AFTER app.js on the lead-work pages
   (my-day, my-leads, lead, add-lead, incoming, pipeline, calling, transfers).
   It does not change app.js. It only adds the pieces these pages share:

   DATA      LK.leads (Rocky's 16 sample leads) · LK.agents (10 agents) · LK.lead('Marco Bellini')
   CALL      <button data-call="Marco Bellini|+39 333 455 4821">Call</button>
             computer: dialog with the number, a QR code to scan and a tel: link · the click is logged.
             Agent + not checked in (localStorage hmCheckin = "out") → the check-in question comes first.
             JS: LK.call(name, phone, {gate:true})        event on document: "lk:call" {name, marked}
   MESSAGE   <button data-msg="whatsapp|Marco Bellini|+39 333 455 4821">WhatsApp</button>  (or telegram)
             pick a ready message → "Open WhatsApp" → "What happened?"     event: "lk:msg" {name, app}
             (a page that asks for the result itself sets LK.skipWhat = true)
   WHAT      <button data-what="Marco Bellini|WhatsApp">What happened?</button>   event: "lk:outcome" {name, value}
   TRANSFER  <button data-transfer="Marco Bellini">Transfer</button>  right panel with the full form
             (data-transfer="" lets the agent pick the lead first)        event: "lk:transfer" {name, to, reason}
   LEAD LINK LK.url(name, {p, pr, s, a}) → "lead.html?n=…" so the lead page opens the lead that was clicked
   MEMORY    what you did in this browser tab is remembered between pages (sessionStorage):
             LK.did(name) → {text, at} or null · LK.remember(name, text) · LK.openReq[name] = open transfer request
   QR        LK.qr(text) → svg string (a drawn placeholder, not a real code)
   ===================================================================================== */
(function () {
  'use strict';
  var D = document, HM = window.HM;
  function $(s, r) { return (r || D).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || D).querySelectorAll(s)); }
  function el(h) { var t = D.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; }
  function fire(n, d) { D.dispatchEvent(new CustomEvent(n, { detail: d || {} })); }
  function first(n) { return String(n).split(' ')[0]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var LS; try { LS = window.localStorage; LS.getItem('x'); } catch (e) { LS = { getItem: function () { return null; }, setItem: function () {} }; }

  /* ---------------- sample data (sage.md section 3) ---------------- */
  var STAGE = { 'new': 'New', called: 'Called', interested: 'Interested', meeting: 'Meeting', offer: 'Offer', won: 'Won', lost: 'Lost' };
  var LEADS = [
    { n: 'Khalid Al Mansoori', p: '+971 50 555 0101', pr: 'The Archive', d: '2BR · AED 2.5M', s: 'new', nx: 'VIP · call within 24 min', red: 1, vip: 1, c: 'Dubai', t: '14:55', tabs: 'today new vip', lang: 'Arabic, English', why: 'VIP lead from Emir · 30 min to call', say: 'Good afternoon Mr Khalid, this is Rocky from homes.me. Emir asked me to call you about the show flat at The Archive.' },
    { n: 'Sara Nunes', p: '+351 91 234 5678', pr: 'Damac Islands', d: 'villa', s: 'called', nx: 'Follow-up overdue since 11:00', red: 1, c: 'Lisbon', t: '10:55', tabs: 'today overdue', lang: 'Portuguese, English', why: 'Follow-up overdue since 11:00', say: 'Hello Sara, Rocky from homes.me. You asked me to call back about the villa at Damac Islands.' },
    { n: 'Marco Bellini', p: '+39 333 455 4821', pr: 'The Archive', d: '2BR · AED 2M', s: 'interested', nx: 'Send payment plan · 15:30', c: 'Milan', t: '11:55', tabs: 'today hot', lang: 'Italian, English', why: 'Opened your brochure link 2 times', say: 'Hello Marco, I saw you opened the brochure. I can send the 60 / 40 payment plan now. Is WhatsApp fine?' },
    { n: 'Priya Shah', p: '+91 98765 43210', pr: 'Valia', d: '1BR · AED 1.4M', s: 'interested', nx: 'Call after her meeting · 16:00', c: 'Mumbai', t: '16:25', tabs: 'today hot', lang: 'Hindi, English', why: 'Asked for a call after her meeting', say: 'Hello Priya, Rocky from homes.me. Is now a good time to talk about the 1BR at Valia?' },
    { n: 'Lucas Martin', p: '+33 6 12 34 56 78', pr: 'The Archive', d: '3BR · AED 2.5M', s: 'interested', nx: 'Compare Archive and Valia · 17:15', c: 'Paris', t: '11:55', tabs: 'today hot', lang: 'French, English', why: 'Site visit today 16:30', say: 'Hello Lucas, we meet at 16:30 at The Archive sales centre. I will bring the Valia numbers to compare.' },
    { n: 'Ahmed Hassan', p: '+966 50 123 4567', pr: 'Shahrukhz', d: '1BR', s: 'called', nx: 'Best time in KSA · 19:00', c: 'Riyadh', t: '13:55', tabs: 'today', lang: 'Arabic', why: 'Best time for him is 19:00', say: 'Good afternoon Ahmed, Rocky from homes.me about the 1BR at Shahrukhz with 1% monthly.' },
    { n: 'Sami Najahi', p: '+971 50 410 2233', pr: 'The Archive', d: 'imported', s: 'new', nx: 'Goes back tomorrow 09:00', red: 1, c: 'Dubai', t: '14:55', tabs: 'today new', lang: 'Arabic, English', why: 'Imported lead · goes back tomorrow 09:00', say: 'Hello Sami, Rocky from homes.me. You asked about The Archive in Business Bay.' },
    { n: 'Neil Smith', p: '+44 7700 900 123', pr: 'Shahrukhz', d: 'imported', s: 'new', nx: 'Goes back tomorrow 09:00', red: 1, c: 'London', t: '10:55', tabs: 'today new', lang: 'English', why: 'Imported lead · goes back tomorrow 09:00', say: 'Hello Neil, Rocky from homes.me in Dubai. You asked about Shahrukhz on Sheikh Zayed Road.' },
    { n: 'Parvez Hossain', p: '+880 17 1234 5678', pr: 'The Archive', d: 'imported', s: 'new', nx: 'Not called yet', c: 'Dhaka', t: '16:55', tabs: 'today new', lang: 'Bengali, English', why: 'Not called yet', say: 'Hello Parvez, Rocky from homes.me. You asked about The Archive. Do you have two minutes?' },
    { n: 'Hanna Alabbas', p: '+971 55 320 7788', pr: 'The Archive', d: '2BR', s: 'called', nx: 'No answer twice', c: 'Dubai', t: '14:55', tabs: 'today', lang: 'Arabic, English', why: 'No answer twice · third try', say: 'Hello Hanna, Rocky from homes.me. I tried to reach you about the 2BR at The Archive.' },
    { n: 'Dave Patel', p: '+44 7700 900 456', pr: 'Shahrukhz', d: '2BR', s: 'called', nx: 'Wants the floor plan first', c: 'London', t: '10:55', tabs: 'today', lang: 'English, Hindi', why: 'Wants the floor plan first', say: 'Hello Dave, I have the 2BR floor plan for you. Can I send it on WhatsApp?' },
    { n: 'Vanessa Pecoraro', p: '+39 347 111 2222', pr: 'Al Seef', d: '1BR', s: 'called', nx: 'No next step', c: 'Rome', t: '11:55', tabs: 'nonext', lang: 'Italian, English', none: 1 },
    { n: 'Elena Kuznetsova', p: '+7 912 345 67 89', pr: 'Damac Islands', d: 'AED 4.1M', s: 'offer', nx: 'Follow-up tomorrow', c: 'Moscow', t: '13:55', tabs: 'hot', lang: 'Russian, English' },
    { n: 'Bridget Cardoso', p: '+351 91 220 1188', pr: 'The Archive', d: '2BR', s: 'interested', nx: 'No next step', c: 'Lisbon', t: '10:55', tabs: 'today nonext hot', lang: 'Portuguese, English', none: 1, why: 'No next step yet', say: 'Hello Bridget, Rocky from homes.me. Shall we plan a video call about the 2BR this week?' },
    { n: 'Omar Khalil', p: '+971 50 222 3344', pr: 'Valia', d: '2BR', s: 'meeting', nx: 'Met today 12:00', c: 'Dubai', t: '14:55', tabs: 'hot', lang: 'Arabic, English' },
    { n: 'Tom Becker', p: '', pr: 'Shahrukhz', d: 'studio', s: 'lost', nx: 'Budget too low', c: 'Berlin', t: '11:55', tabs: 'lost', lang: 'German, English' }
  ];
  // status key, text, open leads (picker numbers), languages, desk, desk max, deals, meetings, reply time
  var AGENTS = [
    { n: 'Talha', st: 'office', tx: 'In office', open: 22, lang: 'English, Urdu, Hindi', desk: 'Dubai off-plan', max: 60, deals: 7, meet: 14, reply: '3 min' },
    { n: 'Rocky', full: 'Rocky Khan', st: 'office', tx: 'In office', open: 14, lang: 'English, Arabic, Hindi', desk: 'Dubai off-plan', max: 60, deals: 4, meet: 9, reply: '5 min' },
    { n: 'Yuliia', st: 'office', tx: 'In office', open: 18, lang: 'English, Russian, Ukrainian', desk: 'Dubai off-plan', max: 60, deals: 5, meet: 11, reply: '5 min' },
    { n: 'Olga', st: 'office', tx: 'In office', open: 12, lang: 'English, Russian', desk: 'Dubai off-plan', max: 60, deals: 2, meet: 6, reply: '6 min' },
    { n: 'Srdjan', st: 'office', tx: 'In office', open: 16, lang: 'English, Serbian', desk: 'Dubai off-plan', max: 60, deals: 2, meet: 5, reply: '9 min' },
    { n: 'Tej', st: 'office', tx: 'In office', open: 11, lang: 'English, Hindi, Punjabi', desk: 'Dubai off-plan', max: 60, deals: 1, meet: 4, reply: '4 min' },
    { n: 'Shan', st: 'late', tx: 'Late · 24 min', open: 57, lang: 'English, Arabic, Urdu', desk: 'Arabic desk', max: 50, deals: 2, meet: 5, reply: '21 min' },
    { n: 'Nelson', st: 'outside', tx: 'Outside until 16:00', open: 9, lang: 'English, Portuguese', desk: 'Abu Dhabi', max: 40, deals: 3, meet: 8, reply: '12 min' },
    { n: 'Sultan', st: 'leave', tx: 'Annual leave 10–11 Nov', open: 31, lang: 'English, Arabic', desk: 'Arabic desk', max: 50, deals: 1, meet: 3, reply: '–', off: 1 },
    { n: 'Bassam', st: 'absent', tx: 'Absent today', open: 44, lang: 'English, Arabic', desk: 'Abu Dhabi', max: 40, deals: 0, meet: 2, reply: '–', off: 1 }
  ];
  function lead(name) { for (var i = 0; i < LEADS.length; i++) if (LEADS[i].n === name) return LEADS[i]; return null; }
  function tel(p) { return 'tel:' + String(p).replace(/[^\d+]/g, ''); }
  function checkedOut() { return HM.role === 'agent' && LS.getItem('hmCheckin') === 'out'; }
  /* link to the lead page of one lead (the page reads ?n=) */
  function url(name, o) {
    var q = 'lead.html?n=' + encodeURIComponent(name), k; o = o || {};
    for (k in o) if (o[k]) q += '&' + k + '=' + encodeURIComponent(o[k]);
    return q;
  }
  /* small memory for this browser tab: the last thing the agent did with a lead */
  var SS; try { SS = window.sessionStorage; SS.getItem('x'); } catch (e) { SS = { getItem: function () { return null; }, setItem: function () {} }; }
  var MEM = {}; try { MEM = JSON.parse(SS.getItem('lkDid') || '{}') || {}; } catch (e) { MEM = {}; }
  function remember(name, text) { if (!name) return; if (text) MEM[name] = { text: text, at: '14:55' }; else delete MEM[name]; try { SS.setItem('lkDid', JSON.stringify(MEM)); } catch (e) {} }
  function did(name) { return MEM[name] || null; }
  /* one open transfer request per lead (sage: Omar Khalil and Vanessa Pecoraro are waiting) */
  var OPENREQ = { 'Omar Khalil': 'Yuliia · Emir must approve first', 'Vanessa Pecoraro': 'Olga · answer by 18:00' };

  /* ---------------- QR placeholder (drawn, deterministic) ---------------- */
  function qr(text) {
    var n = 25, h = 7, s = '', i, x, y;
    for (i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    function rnd() { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296; }
    function finder(fx, fy) { return '<rect x="' + fx + '" y="' + fy + '" width="7" height="7" rx="1.6"/><rect x="' + (fx + 1) + '" y="' + (fy + 1) + '" width="5" height="5" rx="1" fill="#fff"/><rect x="' + (fx + 2) + '" y="' + (fy + 2) + '" width="3" height="3" rx=".6"/>'; }
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) {
      var inF = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9), mid = x > 9 && x < 15 && y > 9 && y < 15;
      if (!inF && !mid && rnd() > .52) s += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
    }
    return '<svg viewBox="0 0 ' + n + ' ' + n + '" fill="#16151A" shape-rendering="crispEdges" aria-hidden="true">' + s + finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7) + '</svg>';
  }

  /* ---------------- dialogs (built once, on first use) ---------------- */
  var X = '<button type="button" class="btn icon sm ghost" data-close aria-label="Close"><i data-icon="x"></i></button>';
  function mount(html) { var n = el(html); D.body.appendChild(n); HM.refresh(n); return n; }

  /* --- call --- */
  var callDlg, gateDlg, cur = {};
  function buildCall() {
    callDlg = mount('<div class="dialog" id="lk-call" role="dialog" aria-label="Call">' +
      '<div class="dialog-head"><div class="grow"><h3 id="lk-call-t">Call</h3><p id="lk-call-s"></p></div>' + X + '</div>' +
      '<div class="dialog-body"><div class="row gap-16" style="align-items:stretch">' +
        '<div class="grow col" style="gap:8px;justify-content:center"><span class="tiny bold muted" style="letter-spacing:.06em">NUMBER</span><div class="phone-xl" id="lk-call-n"></div>' +
        '<p class="small muted">Scan the code with your phone and the call starts there. Or call from this computer.</p>' +
        '<div class="row gap-8"><button class="btn sm" id="lk-call-copy"><i data-icon="copy"></i>Copy number</button><span class="chip red pip hide" id="lk-call-mark">Marked: not checked in</span></div></div>' +
        '<div class="qr" id="lk-call-qr"></div></div>' +
      '<div class="banner"><i data-icon="check"></i><span class="grow">This click is logged on the timeline, the same as on the phone. <b>+15 points</b> per call.</span></div></div>' +
      '<div class="dialog-foot"><button class="btn ghost" data-close>Close</button><a class="btn primary" id="lk-call-tel" href="tel:"><i data-icon="phone"></i>Call from this computer</a></div></div>');
    $('#lk-call-copy').addEventListener('click', function () {
      try { navigator.clipboard.writeText(cur.phone); } catch (e) {}
      HM.toast('Number copied · ' + cur.phone);
    });
    gateDlg = mount('<div class="dialog" id="lk-gate" role="dialog" aria-label="Not checked in">' +
      '<div class="dialog-head"><div class="grow"><h3>You\'re not checked in yet</h3><p>It is 14:55. Your shift is 09:00 – 18:00. What do you want to do?</p></div>' + X + '</div>' +
      '<div class="dialog-body"><div class="opt-list">' +
        '<button class="opt on" data-gate="in"><span class="card-icon accent"><i data-icon="wifi"></i></span><span class="grow"><b class="bold">Check in now and call</b><div class="small muted">Office Wi-Fi “homes.me-Office” found</div></span><i data-icon="arrow-right"></i></button>' +
        '<a class="opt" href="attendance.html#outside"><span class="card-icon"><i data-icon="pin"></i></span><span class="grow"><b class="bold">I\'m working outside</b><div class="small muted">Say where you are and when you are back</div></span><i data-icon="arrow-right"></i></a>' +
        '<button class="opt" data-gate="anyway"><span class="card-icon"><i data-icon="phone"></i></span><span class="grow"><b class="bold">Call anyway</b><div class="small muted">The call is marked “not checked in”. Owners see it.</div></span><i data-icon="arrow-right"></i></button>' +
      '</div><p class="small muted">Not asked outside work hours, or while you work outside.</p></div>' +
      '<div class="dialog-foot"><button class="btn ghost" data-close>Cancel</button></div></div>');
    gateDlg.addEventListener('click', function (e) {
      var b = e.target.closest('[data-gate]'); if (!b) return;
      if (b.getAttribute('data-gate') === 'in') { HM.setCheckin('in'); HM.toast('Checked in · 14:55 · In office'); fire('lk:checkin'); showCall(false); }
      else showCall(true);
    });
  }
  function showCall(marked) {
    var l = lead(cur.name) || {};
    $('#lk-call-t').textContent = 'Call ' + cur.name;
    $('#lk-call-s').textContent = [l.c ? l.c + ' ' + l.t + ' local time' : '', l.pr || '', l.s ? STAGE[l.s] : ''].filter(Boolean).join(' · ');
    $('#lk-call-n').textContent = cur.phone;
    $('#lk-call-tel').href = tel(cur.phone);
    $('#lk-call-qr').innerHTML = qr(cur.phone);
    $('#lk-call-mark').classList.toggle('hide', !marked);
    HM.open(callDlg);
    remember(cur.name, 'Call clicked' + (marked ? ' · not checked in' : ''));
    fire('lk:call', { name: cur.name, phone: cur.phone, marked: !!marked });
  }
  function call(name, phone, o) {
    if (!callDlg) buildCall();
    cur = { name: name, phone: phone || (lead(name) || {}).p || '' };
    if (!cur.phone.replace(/\D/g, '')) { HM.toast('No phone number for ' + first(name) + '. Add one on the lead page first.', { error: true }); return; }
    if ((o && o.gate) || checkedOut()) HM.open(gateDlg); else showCall(false);
  }

  /* --- WhatsApp / Telegram message --- */
  var msgDlg, whatDlg, msg = {};
  var READY = [
    ['Meeting time', 'Hello {first}, this is {me} from homes.me. I confirm our meeting. See you soon.'],
    ['Hello', 'Hello {first}, this is {me} from homes.me. Thank you for your interest in {project}. When is a good time to talk?'],
    ['Brochure', 'Hello {first}, here is the brochure of {project}: homes.me/p/{slug}-b'],
    ['Payment plan', 'Hello {first}, here is the payment plan of {project}: homes.me/p/{slug}-pp'],
    ['Write my own', '']
  ];
  function fillMsg(i) {
    var l = lead(msg.name) || {}, pr = l.pr || 'the project';
    $('#lk-msg-text').value = READY[i][1].replace('{first}', first(msg.name)).replace('{me}', first(HM.me.name)).replace(/\{project\}/g, pr).replace('{slug}', pr.toLowerCase().replace(/^the /, '').replace(/\W+/g, '-'));
    $('#lk-msg-link').classList.toggle('hide', i < 2 || i > 3);
    if (i === 4) $('#lk-msg-text').focus();
  }
  function buildMsg() {
    msgDlg = mount('<div class="dialog" id="lk-msg" role="dialog" aria-label="Message">' +
      '<div class="dialog-head"><div class="grow"><h3 id="lk-msg-t">WhatsApp</h3><p>Pick a ready message. You press send yourself in the app.</p></div>' + X + '</div>' +
      '<div class="dialog-body"><div class="chips" data-chips id="lk-msg-pick">' + READY.map(function (r, i) { return '<button class="chip-opt' + (i === 1 ? ' on' : '') + '" data-value="' + i + '">' + r[0] + '</button>'; }).join('') + '</div>' +
      '<div class="field"><label for="lk-msg-text">Message</label><textarea class="textarea" id="lk-msg-text" style="min-height:104px"></textarea>' +
      '<span class="hint hide" id="lk-msg-link"><i data-icon="link" class="i-sm"></i> Tracked link. You get an alert when the client opens it.</span></div></div>' +
      '<div class="dialog-foot"><span class="small muted grow">The tap is logged. Nothing is sent by the CRM.</span><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="lk-msg-go">Open WhatsApp</button></div></div>');
    $('#lk-msg-pick').addEventListener('hm:change', function (e) { fillMsg(+e.detail.value); });
    $('#lk-msg-go').addEventListener('click', function () {
      var app = msg.app; HM.close(msgDlg);
      HM.toast(app + ' opened for ' + first(msg.name) + ' · tap logged');
      remember(msg.name, app + ' opened · result not said yet');
      fire('lk:msg', { name: msg.name, app: app });
      if (!window.LK.skipWhat) setTimeout(function () { what(msg.name, app, true); }, 1100);
    });
  }
  function message(app, name, phone, o) {
    if (!(phone || (lead(name) || {}).p || '').replace(/\D/g, '')) { HM.toast('No phone number for ' + first(name) + '. Add one on the lead page first.', { error: true }); return; }
    if (!msgDlg) buildMsg();
    app = /tele/i.test(app) ? 'Telegram' : 'WhatsApp';
    msg = { app: app, name: name, phone: phone };
    $('#lk-msg-t').textContent = app + ' to ' + name;
    $('#lk-msg-go').innerHTML = HM.icon(app.toLowerCase()) + 'Open ' + app;
    $$('svg', $('#lk-msg-go')).forEach(function (s) { s.style.cssText = 'width:16px;height:16px'; });
    $$('#lk-msg-pick > *').forEach(function (b, i) { b.classList.toggle('on', i === 1); });
    fillMsg(1);
    if (o && o.text) { $$('#lk-msg-pick > *').forEach(function (b, i) { b.classList.toggle('on', i === (o.pick == null ? 4 : o.pick)); }); $('#lk-msg-text').value = o.text; $('#lk-msg-link').classList.add('hide'); }
    HM.open(msgDlg);
  }

  /* --- "What happened?" --- */
  var OUT = ['Sent, waiting for reply', 'Client replied: interested', 'Client replied: not now', 'Not interested', 'Wrong number', 'Didn\'t send'];
  var OUTCALL = ['Interested', 'Call back later', 'No answer', 'Busy', 'Not interested', 'Wrong number'];
  var LOST = ['Bought elsewhere', 'Budget too low', 'Just browsing', 'Not into off-plan', 'Is a broker, not a buyer', 'Other'];
  var recTimer;
  function buildWhat() {
    whatDlg = mount('<div class="dialog" id="lk-what" role="dialog" aria-label="What happened?">' +
      '<div class="dialog-head"><div class="grow"><h3 id="lk-what-t">What happened?</h3><p id="lk-what-s"></p></div>' + X + '</div>' +
      '<div class="dialog-body"><div class="field" id="lk-what-f"><div class="chips" data-chips id="lk-what-pick">' + OUT.map(function (o) { return '<button class="chip-opt">' + o + '</button>'; }).join('') + '</div><span class="error">Choose what happened.</span></div>' +
      '<div class="field hide" id="lk-what-lost"><span class="field-label">Why not interested? <span class="t-accent">*</span></span><div class="chips" data-chips id="lk-what-reason">' + LOST.map(function (o) { return '<button class="chip-opt">' + o + '</button>'; }).join('') + '</div>' +
        '<label class="check mt-4"><input type="checkbox" checked>Try again in 3 months</label><span class="error">Choose a reason. The lead moves to Lost.</span></div>' +
      '<div class="banner amber hide" id="lk-what-wrong"><i data-icon="flag"></i><span class="grow">The lead is flagged for the owner as “wrong number”.</span></div>' +
      '<div class="field"><label for="lk-what-note">Note</label><div class="row gap-8 top"><textarea class="textarea grow" id="lk-what-note" style="min-height:64px" placeholder="One line is enough"></textarea>' +
        '<button class="btn icon rec-btn" id="lk-what-rec" data-tip="Record a voice note" data-tip-pos="top" aria-label="Record a voice note"><i data-icon="mic"></i></button></div><span class="hint" id="lk-what-rect"></span></div></div>' +
      '<div class="dialog-foot"><span class="small muted grow">“Later” keeps it on My Day.</span><button class="btn ghost" id="lk-what-later">Later</button><button class="btn primary" id="lk-what-save">Save</button></div></div>');
    $('#lk-what-pick').addEventListener('hm:change', function (e) {
      $('#lk-what-f').classList.remove('invalid');
      $('#lk-what-lost').classList.toggle('hide', e.detail.value !== 'Not interested');
      $('#lk-what-wrong').classList.toggle('hide', e.detail.value !== 'Wrong number');
    });
    $('#lk-what-reason').addEventListener('hm:change', function () { $('#lk-what-lost').classList.remove('invalid'); });
    $('#lk-what-rec').addEventListener('click', function () {
      var b = this, on = b.classList.toggle('on'), t = 0, out = $('#lk-what-rect');
      clearInterval(recTimer);
      if (on) { out.textContent = 'Recording 0:00 · click again to stop'; recTimer = setInterval(function () { t++; out.textContent = 'Recording 0:' + (t < 10 ? '0' : '') + t + ' · click again to stop'; }, 1000); }
      else out.textContent = 'Voice note saved with this update.';
    });
    $('#lk-what-later').addEventListener('click', function () { HM.close(whatDlg); HM.toast('Kept on My Day · waiting for your update'); fire('lk:later', { name: whatDlg._name }); });
    $('#lk-what-save').addEventListener('click', function () {
      var on = $('#lk-what-pick .on'), v = on && on.textContent;
      if (!v) { $('#lk-what-f').classList.add('invalid'); return; }
      if (v === 'Not interested' && !$('#lk-what-reason .on')) { $('#lk-what-lost').classList.add('invalid'); return; }
      HM.close(whatDlg);
      var name = whatDlg._name, txt = v === 'Not interested' ? first(name) + ' moved to Lost · ' + $('#lk-what-reason .on').textContent : 'Saved · ' + first(name) + ': ' + v;
      var before = did(name);
      remember(name, v === 'Not interested' ? 'Moved to Lost · ' + $('#lk-what-reason .on').textContent : v);
      HM.toast(txt, { undo: function () { remember(name, before && before.text); fire('lk:outcome-undo', { name: name }); } });
      fire('lk:outcome', { name: name, value: v, note: $('#lk-what-note').value.trim() });
    });
  }
  function what(name, app, justNow) {
    if (!whatDlg) buildWhat();
    whatDlg._name = name;
    $('#lk-what-t').textContent = 'What happened with ' + first(name) + '?';
    var isCall = /call/i.test(app || '');
    $('#lk-what-s').textContent = isCall ? 'Call clicked today · logged' : (app || 'WhatsApp') + ' opened ' + (justNow ? 'just now' : 'earlier today') + ' · tap logged';
    $('#lk-what-pick').innerHTML = (isCall ? OUTCALL : OUT).map(function (o) { return '<button class="chip-opt">' + o + '</button>'; }).join('');
    $$('.chip-opt', whatDlg).forEach(function (b) { b.classList.remove('on'); });
    $$('.invalid', whatDlg).forEach(function (b) { b.classList.remove('invalid'); });
    $('#lk-what-lost').classList.add('hide'); $('#lk-what-wrong').classList.add('hide');
    $('#lk-what-note').value = ''; $('#lk-what-rect').textContent = ''; $('#lk-what-rec').classList.remove('on'); clearInterval(recTimer);
    HM.open(whatDlg);
  }

  /* ---------------- transfer panel (the full form of "Transfer this lead") ---------------- */
  var tp, tr = {};
  var LANGS = ['All', 'Arabic', 'Russian', 'Hindi', 'Urdu', 'Portuguese', 'Serbian'];
  var REASONS = ['Speaks the client\'s language', 'I am going on leave', 'The client asked', 'Knows the project better', 'I have too many leads', 'Other'];
  function canNow(a) { return !a.off && a.st === 'office' && a.open < a.max; }
  function buildTransfer() {
    tp = mount('<aside class="panel" id="lk-transfer" aria-label="Transfer a lead">' +
      '<div class="panel-head"><div class="grow"><h2 id="lk-tr-t">Transfer a lead</h2><p class="small muted" id="lk-tr-s"></p></div>' + X + '</div>' +
      '<div class="panel-body col gap-16">' +
        '<div class="field" id="lk-tr-leadf"><label for="lk-tr-lead">Which lead? <span class="req">*</span></label><select class="select" id="lk-tr-lead"><option value="">Choose one of your leads…</option>' +
          LEADS.filter(function (l) { return l.s !== 'lost'; }).map(function (l) { return '<option value="' + l.n + '">' + l.n + ' · ' + l.pr + ' · ' + STAGE[l.s] + (l.vip ? ' · VIP' : '') + '</option>'; }).join('') + '</select><span class="error">Choose the lead first. Only your own leads are here.</span></div>' +
        '<div class="banner red hide" id="lk-tr-vip"><i data-icon="crown"></i><span class="grow"><b>A VIP lead cannot be transferred.</b> Only the owner can give it to another agent.</span><button class="btn xs" id="lk-tr-back" data-confirm="Tap again to send it back">Send back to Emir</button></div>' +
        '<div class="banner amber hide" id="lk-tr-appr"><i data-icon="shield"></i><span class="grow" id="lk-tr-apprt"></span></div>' +
        '<div class="banner blue hide" id="lk-tr-open"><i data-icon="swap"></i><span class="grow">This lead already has an open request. Only one at a time.</span></div>' +
        '<div id="lk-tr-form" class="col gap-16">' +
          '<div class="field"><span class="field-label">Language</span><div class="chips" data-chips id="lk-tr-lang">' + LANGS.map(function (l, i) { return '<button class="chip-opt' + (i ? '' : ' on') + '" style="height:30px;padding:0 12px">' + l + '</button>'; }).join('') + '</div></div>' +
          '<div class="field" id="lk-tr-agf"><span class="field-label">Give to <span class="t-accent">*</span> <span class="muted" style="font-weight:500">· free now first, then fewest open leads</span></span><div class="opt-list" data-chips id="lk-tr-agents"></div><span class="error">Choose an agent.</span><span class="hint hide" id="lk-tr-full"></span></div>' +
          '<div class="field" id="lk-tr-rf"><span class="field-label">Reason <span class="t-accent">*</span></span><div class="chips" data-chips id="lk-tr-reason">' + REASONS.map(function (r) { return '<button class="chip-opt">' + r + '</button>'; }).join('') + '</div><span class="error">Choose a reason.</span></div>' +
          '<div class="field hide" id="lk-tr-nf"><label for="lk-tr-note">Note <span class="req">*</span></label><textarea class="textarea" id="lk-tr-note" style="min-height:64px" placeholder="Why this agent?"></textarea><span class="error">Write at least 5 letters.</span></div>' +
          '<ul class="rules"><li>The lead stays with you until the agent accepts.</li><li>No answer by 18:00 ends the request.</li><li>Notes and history go with the lead.</li></ul>' +
        '</div></div>' +
      '<div class="panel-foot"><button class="btn ghost" data-close>Cancel</button><span class="grow"></span><button class="btn primary" id="lk-tr-go">Send request</button></div></aside>');
    $('#lk-tr-lang').addEventListener('hm:change', function (e) { tr.lang = e.detail.value; agents(); });
    $('#lk-tr-agents').addEventListener('hm:change', function (e) { tr.to = e.detail.value; $('#lk-tr-agf').classList.remove('invalid'); btn(); });
    $('#lk-tr-reason').addEventListener('hm:change', function (e) { tr.reason = e.detail.value; $('#lk-tr-rf').classList.remove('invalid'); $('#lk-tr-nf').classList.toggle('hide', tr.reason !== 'Other'); });
    $('#lk-tr-lead').addEventListener('change', function () { setLead(this.value); });
    $('#lk-tr-note').addEventListener('input', function () { $('#lk-tr-nf').classList.remove('invalid'); });
    $('#lk-tr-back').addEventListener('hm:confirm', function () { HM.close(tp); HM.toast(first(tr.name) + ' sent back to Emir · he is told now', { undo: function () {} }); fire('lk:sentback', { name: tr.name }); });
    $('#lk-tr-go').addEventListener('click', function () {
      var bad = false, owner = HM.role === 'owner';
      if (!tr.name) { $('#lk-tr-leadf').classList.add('invalid'); return; }
      if (!tr.to) { $('#lk-tr-agf').classList.add('invalid'); bad = true; }
      if (!tr.reason && !owner) { $('#lk-tr-rf').classList.add('invalid'); bad = true; }
      if (tr.reason === 'Other' && $('#lk-tr-note').value.trim().length < 5) { $('#lk-tr-nf').classList.add('invalid'); bad = true; }
      if (bad) return;
      HM.close(tp);
      var l = lead(tr.name) || {}, appr = !owner && (l.s === 'meeting' || l.s === 'offer');
      HM.toast(owner ? first(tr.name) + ' given to ' + tr.to + ' · ' + tr.to + ' is told now' : appr ? 'Request sent · Emir must approve first, then ' + tr.to + ' accepts' : 'Request sent to ' + tr.to + ' · answer by 18:00', { undo: function () { delete OPENREQ[tr.name]; fire('lk:transfer-undo', { name: tr.name }); } });
      if (!owner) OPENREQ[tr.name] = tr.to + (appr ? ' · Emir must approve first' : ' · answer by 18:00');
      fire('lk:transfer', { name: tr.name, to: tr.to, reason: tr.reason, approval: appr });
    });
  }
  function btn() {
    var a = AGENTS.filter(function (x) { return x.n === tr.to; })[0], full = a && a.open >= a.max, h = $('#lk-tr-full');
    h.classList.toggle('hide', !full); if (full) h.textContent = a.n + ' has ' + a.open + ' open leads, above the desk maximum of ' + a.max + '. ' + a.n + ' may say no.';
    $('#lk-tr-go').textContent = HM.role === 'owner' ? (tr.to ? 'Give to ' + tr.to : 'Give the lead') : (tr.to ? 'Send request to ' + tr.to : 'Send request');
  }
  function agents() {
    var me = HM.role === 'agent' ? 'Rocky' : (tr.holder || ''), lang = tr.lang && tr.lang !== 'All' ? tr.lang : '';
    var list = AGENTS.filter(function (a) { return a.n !== me && (!lang || a.lang.indexOf(lang) > -1); })
      .sort(function (a, b) { return (canNow(b) - canNow(a)) || ((a.off || 0) - (b.off || 0)) || (a.open - b.open); });
    var best = list.length && canNow(list[0]) ? list[0].n : '';
    if (!list.some(function (a) { return a.n === tr.to && !a.off; })) tr.to = '';
    $('#lk-tr-agents').innerHTML = list.length ? list.map(function (a) {
      var over = a.open >= a.max;
      return '<button class="opt agent-card' + (a.n === tr.to ? ' on' : '') + '"' + (a.off ? ' disabled' : '') + ' data-value="' + a.n + '"><span class="av lg" data-name="' + (a.full || a.n) + '" data-status="' + a.st + '"></span>' +
        '<span class="grow"><span class="row gap-6"><b class="bold">' + a.n + '</b>' + (a.n === best ? '<span class="chip green" style="height:20px">Best match</span>' : '') + '<span class="chip att-' + a.st + '" style="height:20px">' + a.tx + '</span></span>' +
        '<span class="small muted" style="display:block;margin-top:2px">' + a.lang + '</span>' +
        '<span class="meta"><span><b' + (over ? ' class="t-red"' : '') + '>' + a.open + '</b> open' + (over ? ' · above max ' + a.max : '') + '</span><span><b>' + a.deals + '</b> deals this month</span><span>replies in <b>' + a.reply + '</b></span></span></span>' +
        '<a class="card-link" href="team.html" data-tip="Open profile" data-tip-pos="top">Profile</a></button>';
    }).join('') : '<div class="empty" style="padding:20px"><b>No agent speaks ' + esc(lang) + '</b><p>Choose “All” to see everyone.</p></div>';
    HM.refresh($('#lk-tr-agents')); btn();
  }
  function setLead(name) {
    var l = lead(name) || {}, owner = HM.role === 'owner';
    tr.name = name; $('#lk-tr-leadf').classList.remove('invalid');
    var vip = !!l.vip && !owner, appr = !owner && (l.s === 'meeting' || l.s === 'offer');
    $('#lk-tr-vip').classList.toggle('hide', !vip);
    $('#lk-tr-form').classList.toggle('hide', vip);
    $('#lk-tr-go').classList.toggle('hide', vip);
    $('#lk-tr-appr').classList.toggle('hide', !appr);
    if (appr) $('#lk-tr-apprt').innerHTML = '<b>Stage ' + STAGE[l.s] + '.</b> Emir must approve first, then the agent accepts.';
    var busy = !owner && name && OPENREQ[name];
    $('#lk-tr-open').classList.toggle('hide', !busy);
    if (busy) { $('#lk-tr-open .grow').innerHTML = '<b>' + esc(name) + ' already has an open request</b> to ' + esc(OPENREQ[name]) + '. Only one at a time. Cancel it first on the Transfers page.'; $('#lk-tr-form').classList.add('hide'); $('#lk-tr-go').classList.add('hide'); $('#lk-tr-appr').classList.add('hide'); }
    $('#lk-tr-s').textContent = name ? [l.pr, l.s ? STAGE[l.s] : '', l.lang ? 'speaks ' + l.lang : ''].filter(Boolean).join(' · ') : 'Only your own leads can be transferred.';
  }
  function transfer(name, o) {
    if (!tp) buildTransfer();
    o = o || {}; var owner = HM.role === 'owner';
    tr = { name: '', to: '', reason: '', lang: 'All', holder: o.holder || (owner ? 'Rocky' : '') };
    $$('.invalid', tp).forEach(function (n) { n.classList.remove('invalid'); });
    $$('#lk-tr-reason > *').forEach(function (b) { b.classList.remove('on'); });
    $$('#lk-tr-lang > *').forEach(function (b, i) { b.classList.toggle('on', !i); });
    $('#lk-tr-nf').classList.add('hide'); $('#lk-tr-note').value = '';
    $('#lk-tr-leadf').classList.toggle('hide', !!name); $('#lk-tr-lead').value = '';
    $('#lk-tr-t').textContent = name ? (owner ? 'Give ' + name + ' to another agent' : 'Transfer ' + name) : 'Transfer a lead';
    $('#lk-tr-rf').querySelector('.field-label').innerHTML = owner ? 'Reason <span class="muted" style="font-weight:500">· optional for owners</span>' : 'Reason <span class="t-accent">*</span>';
    $$('.rules li', tp)[0].textContent = owner ? 'The agent is told at once. No approval is needed.' : 'The lead stays with you until the agent accepts.';
    $$('.rules li', tp)[1].style.display = owner ? 'none' : '';
    setLead(name || ''); agents(); HM.open(tp);
  }

  /* ---------------- one click handler for the data-attributes ---------------- */
  D.addEventListener('click', function (e) {
    var t = e.target, n, p;
    if (!t.closest) return;
    if ((n = t.closest('[data-call]'))) { e.preventDefault(); e.stopPropagation(); p = n.getAttribute('data-call').split('|'); call(p[0], p[1]); return; }
    if ((n = t.closest('[data-msg]'))) { e.preventDefault(); e.stopPropagation(); p = n.getAttribute('data-msg').split('|'); message(p[0], p[1], p[2]); return; }
    if ((n = t.closest('[data-what]'))) { e.preventDefault(); e.stopPropagation(); p = n.getAttribute('data-what').split('|'); what(p[0], p[1]); return; }
    if ((n = t.closest('[data-transfer]'))) { e.preventDefault(); e.stopPropagation(); transfer(n.getAttribute('data-transfer')); return; }
  }, true);

  window.LK = { leads: LEADS, agents: AGENTS, stage: STAGE, lost: LOST, lead: lead, tel: tel, qr: qr, call: call, message: message, what: what, transfer: transfer, checkedOut: checkedOut, first: first, url: url, did: did, remember: remember, openReq: OPENREQ };
})();

"""Builds the agent handbook: one self-contained HTML, printed to A4 PDF."""
import re
from pathlib import Path

HERE = Path(__file__).parent
fonts = ''.join(
    f"@font-face{{font-family:'Poppins';font-weight:{w};font-style:normal;"
    f"src:url(data:font/ttf;base64,{d}) format('truetype')}}"
    for w, d in (line.split('|', 1) for line in (HERE / 'fonts.txt').read_text().splitlines())
)
logo_dark = (HERE / 'logo-ondark.svg').read_text()
logo_colour = (HERE / 'logo-colour.svg').read_text()
icon = (HERE / 'icon.svg').read_text()
icon_white = re.sub(r'stroke="#[0-9A-Fa-f]{6}"', 'stroke="#FFFFFF"', icon)
from urllib.parse import quote
icon_uri = quote(icon_white, safe="")

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
:root{--o:#FF4000;--n:#1A1A1A;--w:#FBF7F3;--g:#6B605A;--line:#E8E0D9}
html{font-family:'Poppins',sans-serif;color:var(--n);-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{background:#fff}
@page{size:A4;margin:0}
/* overflow:hidden matters: the cover's watermark hangs off the edge by design,
   and without this it widens the document, which makes Chromium shrink every
   page to fit and leaves white margins on an A4 that should be full bleed. */
.page{width:210mm;height:297mm;padding:16mm 15mm 14mm;page-break-after:always;position:relative;
  display:flex;flex-direction:column;overflow:hidden}
.page:last-child{page-break-after:auto}

/* cover */
.cover{background:var(--n);color:#fff;justify-content:space-between;padding:22mm 15mm}
.cover .mark{width:52mm}
.cover h1{font-size:40pt;font-weight:700;line-height:1.02;letter-spacing:-.02em;margin-top:auto}
.cover h1 em{font-style:normal;color:var(--o)}
.cover .sub{font-size:12pt;color:#BDB4AE;margin-top:6mm;max-width:118mm;line-height:1.5}
.cover .foot{display:flex;justify-content:space-between;align-items:flex-end;font-size:8.5pt;
  color:#8C8278;border-top:1px solid #333;padding-top:5mm;margin-top:14mm}
.cover .wm{position:absolute;right:-14mm;bottom:-8mm;width:128mm;height:128mm;opacity:.085;
  background-repeat:no-repeat;background-size:contain;background-position:center}

h2.sec{font-size:9pt;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--o);
  margin-bottom:3mm}
h3{font-size:21pt;font-weight:700;letter-spacing:-.01em;line-height:1.12;margin-bottom:4mm}
h4{font-size:12pt;font-weight:700;margin-bottom:1.5mm}
p{font-size:10pt;line-height:1.62;color:#3A3330}
.lede{font-size:11.5pt;line-height:1.55;color:var(--g);margin-bottom:7mm}
.pf{position:absolute;bottom:8mm;left:15mm;right:15mm;display:flex;justify-content:space-between;
  font-size:7.5pt;color:#A99E96;border-top:1px solid var(--line);padding-top:2.5mm}

.rule{display:flex;gap:5mm;padding:5mm;border-radius:4mm;background:var(--w);margin-bottom:4mm;
  border-left:3px solid var(--o)}
.rule .num{font-size:22pt;font-weight:700;color:var(--o);line-height:1;min-width:11mm}
.rule p{font-size:9.5pt}

.grid{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.card{padding:5mm;border:1px solid var(--line);border-radius:4mm;background:#fff}
.card h4{font-size:11pt}
.card p{font-size:9pt;color:var(--g);line-height:1.5}
.card .k{display:inline-block;font-size:8pt;font-weight:700;color:var(--o);
  background:#FFEDE6;border-radius:2mm;padding:.8mm 2mm;margin-bottom:2mm}

.flow{display:flex;align-items:stretch;gap:0;margin:5mm 0}
.flow div{flex:1;padding:4mm 2.5mm;text-align:center;font-size:8pt;font-weight:600;
  background:var(--w);border-right:2px solid #fff;position:relative}
.flow div:first-child{border-radius:3mm 0 0 3mm}
.flow div:last-child{border-radius:0 3mm 3mm 0;border-right:0}
.flow div b{display:block;font-size:9.5pt;font-weight:700;margin-bottom:1mm}
.flow .won{background:#E8F5E9}.flow .lost{background:#FBEAEA}

table{width:100%;border-collapse:collapse;font-size:9pt}
th{text-align:left;font-size:7.5pt;letter-spacing:.1em;text-transform:uppercase;color:var(--g);
  padding:0 0 2mm;border-bottom:1px solid var(--line)}
td{padding:2.6mm 0;border-bottom:1px solid #F3EEE9;vertical-align:top}
td:first-child{font-weight:600;width:34%;padding-right:4mm}
kbd{font-family:'Poppins';font-size:8pt;font-weight:700;background:var(--n);color:#fff;
  border-radius:1.6mm;padding:.8mm 2mm;white-space:nowrap}

.big{background:#D23400;color:#fff;border-radius:5mm;padding:7mm;margin:5mm 0}
.big h4{font-size:15pt;color:#fff;margin-bottom:2mm}
.big p{color:#fff;font-size:10pt}
.dark{background:var(--n);color:#fff;border-radius:5mm;padding:7mm;margin:5mm 0}
.dark h4{color:#fff;font-size:13pt}.dark p{color:#C9C1BB;font-size:9.5pt}
.dark b{color:var(--o)}

ul{list-style:none;margin:2mm 0}
li{font-size:9.5pt;line-height:1.6;padding-left:6mm;position:relative;margin-bottom:1.6mm;color:#3A3330}
li::before{content:'';position:absolute;left:0;top:2.6mm;width:2.4mm;height:2.4mm;
  border-radius:50%;background:var(--o)}
li.x::before{background:#D64545}
.tag{display:inline-block;font-size:8pt;font-weight:600;padding:1mm 2.6mm;border-radius:99px;
  background:#FFEDE6;color:#C23200;margin:0 1.5mm 1.5mm 0}
.mini{font-size:8.5pt;color:var(--g);line-height:1.5}
.split{display:grid;grid-template-columns:1fr 1fr;gap:6mm}

/* figures */
.fig{border:1px solid var(--line);border-radius:3mm;overflow:hidden;background:#fff;
  box-shadow:0 1mm 3mm rgba(26,26,26,.07)}
.fig img{display:block;width:100%}
figure{margin:4mm 0}
.cap{font-size:8pt;color:var(--g);margin-top:2mm;line-height:1.45}
.cap b{color:var(--o);font-weight:600}
.figrow{display:grid;grid-template-columns:1fr 1fr;gap:5mm;margin:4mm 0}
.figrow figure{margin:0}
.sideby{display:grid;grid-template-columns:58mm 1fr;gap:7mm;align-items:start;margin:4mm 0}
.sideby figure{margin:0}
.nums{counter-reset:n;margin:3mm 0}
.nums li{padding-left:8mm;margin-bottom:2.2mm}
.nums li::before{counter-increment:n;content:counter(n);width:5.4mm;height:5.4mm;border-radius:50%;
  background:var(--o);color:#fff;font-size:7.5pt;font-weight:700;display:flex;
  align-items:center;justify-content:center;top:.8mm;line-height:1}
.tight td{padding:2mm 0}
.tight td:first-child{width:28%}
.note{font-size:8.5pt;color:var(--g);background:var(--w);border-radius:3mm;padding:4mm;
  line-height:1.5;margin-top:3mm}
.note b{color:var(--n)}
"""

def page(body, cls='', num=None, chapter=''):
    foot = f'<div class="pf"><span>{chapter}</span><span>{num}</span></div>' if num else ''
    return f'<section class="page {cls}">{body}{foot}</section>'

PAGES = []

# ── cover ────────────────────────────────────────────────────────────────
PAGES.append(page(f"""
  <div class="mark">{logo_dark}</div>
  <h1>How we<br>work a lead.<br><em>Every time.</em></h1>
  <div class="sub">The homes.me CRM, in the order you will actually use it.
    Read it once, keep it on your phone, and you will never lose a lead again.</div>
  <div class="foot"><span>Emigeo Homes Real Estate · Agent handbook</span><span>v1</span></div>
  <div class="wm" style="background-image:url(&quot;data:image/svg+xml,{icon_uri}&quot;)"></div>
""", cls='cover'))

# ── 1. the one rule ──────────────────────────────────────────────────────
PAGES.append(page(f"""
  <h2 class="sec">Start here</h2>
  <h3>Four rules. The rest is detail.</h3>
  <p class="lede">If you only remember this page, you will still be one of the good ones.</p>

  <div class="rule"><div class="num">1</div><div>
    <h4>Five minutes. Not ten.</h4>
    <p>A new lead is yours the second it lands — your phone buzzes and it is on your dashboard.
    Touch it within <b>5 minutes</b> or the CRM takes it back and gives it to someone else.
    That is not a punishment. A lead called in 5 minutes buys; a lead called tomorrow has
    already spoken to three other brokers.</p></div></div>

  <div class="rule"><div class="num">2</div><div>
    <h4>Write the note while you remember it.</h4>
    <p>Straight after the call, type what they said. Budget, which tower, when they fly in,
    who really decides. Thirty seconds now saves you the whole conversation again next week —
    and the CRM moves the card to <b>Attempted Contact</b> by itself when you do.</p></div></div>

  <div class="rule"><div class="num">3</div><div>
    <h4>Never leave a lead with no next step.</h4>
    <p>Every open lead must have a date on it. The CRM asks you for one and you can skip it —
    but skipped leads land in the <b>No next step</b> tab, and that tab is the money
    you left on the table.</p></div></div>

  <div class="rule"><div class="num">4</div><div>
    <h4>Only quote what is in the system.</h4>
    <p>Prices, payment plans, handover dates and sizes come from the Projects library.
    If it is not in there, you do not have it yet — ask, do not guess. A wrong price in
    writing is a problem that outlives the deal.</p></div></div>

  <div class="big">
    <h4>The whole job, in one line</h4>
    <p>Answer fast · write down what they said · always leave a next step.</p>
  </div>
""", num='01', chapter='Start here'))

# ── 2. the screen ────────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">The screen</h2>
  <h3>Everything lives on the left.</h3>
  <p class="lede">Twelve things in the sidebar. You will use the top five every day and
  the rest when you need them. This is the whole map.</p>

  <div class="sideby" style="grid-template-columns:40mm 1fr">
    <figure><div class="fig"><img src="img/c-sidebar.png" alt="The sidebar"></div></figure>
    <div>
      <table class="tight">
        <tr><td>Dashboard</td><td>What to do today, decided for you.</td></tr>
        <tr><td>My Leads</td><td>Your leads, in six tabs. Your main screen.</td></tr>
        <tr><td>Follow-ups</td><td>Only what you promised for today.</td></tr>
        <tr><td>Pipeline</td><td>The same leads as cards on a board.</td></tr>
        <tr><td>Inbox</td><td>WhatsApp, email and SMS in one thread.</td></tr>
        <tr><td>Tasks</td><td>Call backs and reminders you set.</td></tr>
        <tr><td>Lists &amp; Campaigns</td><td>Calling through a list of people.</td></tr>
        <tr><td>Lead pool</td><td>Unclaimed leads. Press Claim next lead.</td></tr>
        <tr><td>Team wall</td><td>The floor: wins, notices, thank-yous.</td></tr>
        <tr><td>Projects</td><td>Real prices. The only place to quote from.</td></tr>
        <tr><td>Sales offers</td><td>Branded offers you send to a client.</td></tr>
      </table>
    </div>
  </div>

  <div class="split" style="margin-top:4mm">
    <div class="card">
      <h4>Available for new leads</h4>
      <p>The switch at the bottom of the sidebar. Off means the system stops giving you new
      leads. Turn it off when you are on leave — not when you are busy.</p>
    </div>
    <div class="card">
      <h4>The two things at the top</h4>
      <p>The search box finds anyone by name, phone or project. The bell is leads and
      mentions. <b>Add lead</b> is for someone you met yourself.</p>
    </div>
  </div>
""", num='02', chapter='The screen'))

# ── 3. the dashboard ─────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">Your day</h2>
  <h3>Open the Dashboard. It has already<br>decided what you should do.</h3>
  <p class="lede">You do not have to work out where to start. The four cards at the top are
  in the order that costs most if you ignore them.</p>

  <figure>
    <div class="fig"><img src="img/s-dashboard.png" alt="The Dashboard"></div>
    <p class="cap"><b>Read it top to bottom.</b> The four cards are the work. Everything under
    them — your numbers, the chart, speed to lead — is the score, not the job.</p>
  </figure>

  <table>
    <tr><td>Call N new leads now</td><td>The 5-minute clock is running. These go back to the
      pool if you do not touch them. Always first.</td></tr>
    <tr><td>N follow-ups are overdue</td><td>You promised a time and the time has passed.
      You are already late; ring anyway.</td></tr>
    <tr><td>N hot leads never called</td><td>Scored high, big budget, ready to buy — and
      nobody has spoken to them yet.</td></tr>
    <tr><td>N leads have nothing planned</td><td>No next step. These die quietly. Decide
      what happens next, or close them.</td></tr>
  </table>
""", num='03', chapter='Your day'))

# ── 4. my leads ──────────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">My Leads</h2>
  <h3>Six tabs. Work them left to right.</h3>
  <p class="lede">The number on each tab is how many are waiting. Left to right is the right
  order — it is not alphabetical, it is urgency.</p>

  <figure>
    <div class="fig"><img src="img/c-tabs.png" alt="The six tabs in My Leads"></div>
  </figure>

  <table class="tight">
    <tr><td>Follow-up today</td><td>What you promised, due today. Empty by lunch is a good day.</td></tr>
    <tr><td>New</td><td>Nobody has spoken to them yet. Call — do not message.</td></tr>
    <tr><td>Hot</td><td>The CRM thinks these are your real buyers. Treat them like it.</td></tr>
    <tr><td>Overdue</td><td>You are late. Say sorry and ring anyway.</td></tr>
    <tr><td>No next step</td><td>Open leads with no plan. This is the leak.</td></tr>
    <tr><td>All</td><td>Everything you own.</td></tr>
  </table>

  <h4 style="margin-top:6mm">One row tells you five things</h4>
  <figure>
    <div class="fig"><img src="img/c-leadrow.png" alt="A single lead row"></div>
    <p class="cap">Name, then <b>project · budget · phone</b>. Then what Emir AI makes of them
    and their score out of 100. Then in red how late you are. The three buttons on the right
    are call, WhatsApp and set a reminder — you never have to open the lead to use them.</p>
  </figure>

  <div class="note"><b>The phone number is part-hidden on purpose.</b> Press the green or blue
  button instead of reading it out — that way the call is logged against the lead and you get
  the credit for it.</div>

  <h4 style="margin-top:6mm">The number beside the flame</h4>
  <p style="font-size:9.5pt">A score out of 100, worked out from what the lead actually did:
  whether the phone is real, whether the budget matches the project's real prices, how fast they
  reply, and whether they asked for a price or a brochure. <b>70 or more is Hot.</b> It moves on
  its own as they reply, so a lead that was Weak on Monday can be Hot by Thursday — which is the
  whole reason to keep the notes and the messages inside the CRM.</p>

  <div class="dark">
    <h4>If you only open one tab</h4>
    <p>Open <b>Follow-up today</b>, and empty it. Everything else on this page is a way of
    finding work; that tab is work you have already promised to somebody. A broker who clears
    it every day beats a broker with twice the leads who does not.</p>
  </div>
""", num='04', chapter='My Leads'))

# ── 5. the five minutes ──────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">A lead just landed</h2>
  <h3>You have five minutes.<br>The clock is on the card.</h3>
  <p class="lede">When a lead comes in from Meta, the website or WhatsApp, the system picks an
  agent and tells them immediately. If that is you, this appears in the corner of whatever
  screen you are on.</p>

  <div class="sideby" style="grid-template-columns:78mm 1fr">
    <figure><div class="fig"><img src="img/c-alert.png" alt="The new lead alert"></div></figure>
    <div>
      <h4>Everything on it matters</h4>
      <ul>
        <li><b>3:02</b> — what is left of your five minutes, counting down.</li>
        <li><b>The project and the budget</b> — enough to open the call without reading anything.</li>
        <li><b>Where they came from</b> — a Meta lead ad is colder than someone who messaged you.</li>
        <li><b>Open lead or Call</b> — either one stops the clock. Opening is not enough on its own:
        you still have to speak to them.</li>
      </ul>
      <p class="mini" style="margin-top:3mm">There is a sound too. Leave it on.</p>
    </div>
  </div>

  <div class="big">
    <h4>What happens if you let it run out</h4>
    <p>The lead is taken off you and given to someone else, your manager is told, and the lead is
    marked as a missed SLA. It is not a telling-off — it is so the client gets an answer. But it
    is on your record, and the client has already answered another broker.</p>
  </div>

  <div class="sideby" style="grid-template-columns:104mm 1fr;margin-top:5mm">
    <figure><div class="fig"><img src="img/s-incoming.png" alt="The Incoming screen"></div></figure>
    <div>
      <h4>Incoming</h4>
      <p style="font-size:9pt">Leads that nobody has taken yet sit here, oldest first. This is a
      screen you want to look like this — nearly empty.</p>
      <p class="mini" style="margin-top:2mm">If there is a list on it, the floor is behind and
      anybody can pick one up.</p>
    </div>
  </div>
""", num='05', chapter='The five minutes'))

# ── 6. where this stands ─────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">Opening a lead</h2>
  <h3>Read the top panel before you dial.</h3>
  <p class="lede">Ten seconds here saves you the opening question that makes a client feel like
  a number. It is written from the notes, the messages and the calls already on the lead.</p>

  <figure>
    <div class="fig"><img src="img/c-brief.png" alt="The where-this-stands panel"></div>
    <p class="cap">This is the whole history of a lead, in the shape you need it on the phone.</p>
  </figure>

  <table>
    <tr><td>The box at the top</td><td>The one thing to do next, and why. Press
      <b>Put it in my list</b> and it becomes a task with a time.</td></tr>
    <tr><td>The bullets</td><td>What they actually told us — budget, floor, view, timing.
      Say one of these back to them in the first minute.</td></tr>
    <tr><td>The warning line</td><td>Something that will cost you the deal if you forget it.
      Read it twice.</td></tr>
    <tr><td>Hot / Good / Weak</td><td>Emir AI's read on how likely they are to buy, from the
      real signals: budget against real prices, how fast they reply, what they asked for.</td></tr>
    <tr><td>The grey line at the bottom</td><td>How they behave. "Replies within minutes" tells
      you to message. "Never answers before 7pm" tells you when to ring.</td></tr>
  </table>

  <div class="note"><b>It is a summary, not gospel.</b> Emir AI writes the wording; the facts
  underneath come from the CRM. If it says something that does not match what you know, trust
  yourself and fix the note — the next person to open this lead will read what you wrote.</div>

  <div class="split" style="margin-top:5mm">
    <div class="card">
      <h4>Where it comes from</h4>
      <p>Every line is built from something somebody recorded: a note, a WhatsApp reply, a call
      outcome, the form they filled in. Nothing here is invented — which is also why a lead
      nobody writes notes on has a thin, useless panel.</p>
    </div>
    <div class="card">
      <h4>Ten seconds, every time</h4>
      <p>Read it before you dial, even on a lead you think you remember. You carry forty leads;
      they carry one conversation, and they can tell which of you is which.</p>
    </div>
  </div>
""", num='06', chapter='Opening a lead'))

# ── 7. the action bar ────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">The action bar</h2>
  <h3>Seven buttons. Each one<br>records itself.</h3>
  <p class="lede">This row sits across the top of every lead. Use it instead of your phone's
  own dialler and you never have to type up what you did.</p>

  <figure>
    <div class="fig"><img src="img/c-actions.png" alt="The seven action buttons"></div>
  </figure>

  <table>
    <tr><td>Call</td><td>Dials on your phone and logs the attempt. When you hang up it asks how
      it went — answered, no answer, wrong number. One tap.</td></tr>
    <tr><td>WhatsApp</td><td>Opens the chat with their number already in. Whatever you write comes
      back into the CRM inbox, so the team can see it.</td></tr>
    <tr><td>Call back</td><td>They said "ring me Thursday at six". Press this, pick the time, and
      it will remind you. This is the button that keeps your Follow-up today tab honest.</td></tr>
    <tr><td>Meeting</td><td>A viewing or a sales-centre visit. Moves the lead to Appointment
      Scheduled and puts it in your calendar.</td></tr>
    <tr><td>Problem</td><td>Wrong number, not interested yet, budget nowhere near. Keeps the lead
      honest instead of leaving it parked and pretending.</td></tr>
    <tr><td>Lost</td><td>Asks why — in one tap. That answer is how the company learns which ads
      are wasting money, so pick the true one.</td></tr>
    <tr><td>Won</td><td>Asks what they reserved. This is the one that pays you.</td></tr>
  </table>

  <div class="note"><b>Why not just use your own phone?</b> Because a call nobody can see did not
  happen. If you are off sick and a client rings the office, the person who picks up has to be
  able to read what you did. That is the whole reason this row exists.</div>

  <div class="split" style="margin-top:5mm">
    <div class="card">
      <h4>Lost is not a failure</h4>
      <p>A lead marked Lost with an honest reason teaches the company which ads bring buyers and
      which bring noise. A lead left sitting in New for three months teaches it nothing and still
      counts against you.</p>
    </div>
    <div class="card">
      <h4>Problem versus Lost</h4>
      <p>Problem means "not now, but real" — wrong timing, budget short, waiting on a sale.
      Lost means finished. Use Problem and the lead stays on your list with a reason attached.</p>
    </div>
  </div>
""", num='07', chapter='The action bar'))

# ── 8. the note ──────────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">The note</h2>
  <h3>This is the part that pays you.</h3>
  <p class="lede">Everything else in this handbook is buttons. This is the one thing the CRM
  cannot do for you, and it is worth more in a month than any other habit on this floor.</p>

  <figure>
    <div class="fig"><img src="img/c-note.png" alt="Writing a note on a lead"></div>
    <p class="cap">Pick what kind of note it is, write the sentence, press save. The grey chips
    underneath are suggestions — tap one instead of typing it.</p>
  </figure>

  <div class="split">
    <div>
      <h4>Write what they said</h4>
      <p style="font-size:9.5pt">"Wants 2BR, sea view, under 2.4M. Wife decides. Back in Dubai
      on the 12th."</p>
      <p class="mini" style="margin-top:2mm">Thirty seconds. In three weeks it is the difference
      between a call that lands and a call that starts from nothing.</p>
    </div>
    <div>
      <h4>Not this</h4>
      <p style="font-size:9.5pt; color:#9A8F88">"Called. Will follow up."</p>
      <p class="mini" style="margin-top:2mm">This tells the next person nothing, and in a month
      it will tell <i>you</i> nothing either.</p>
    </div>
  </div>

  <div class="big">
    <h4>Writing a note moves the lead for you</h4>
    <p>A note on a new lead moves it to Attempted Contact by itself. You tried, so the board
    should say so — you do not have to drag the card as well. Tag a colleague with @their name
    and they get a notification.</p>
  </div>

  <div class="note"><b>Remind me</b> sets the next step at the same time as the note, so the lead
  never lands in the "No next step" tab. Use it every time and that tab stays empty.</div>
""", num='08', chapter='The note'))

# ── 9. the whole lead page ───────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">One lead, all of it</h2>
  <h3>The whole page, once.</h3>
  <p class="lede">You have now seen each part on its own. Here is how they sit together — this
  is the screen you will spend most of your day on.</p>

  <figure>
    <div class="fig"><img src="img/s-lead.png" alt="A full lead page"></div>
  </figure>

  <ul class="nums">
    <li><b>The action bar</b> across the top — call, message, book, close.</li>
    <li><b>Where this stands</b> — what to do next and what they told us.</li>
    <li><b>The person</b>, bottom left — stage, score, Emir AI's summary, and where the lead
      came from.</li>
    <li><b>Notes</b>, on the right — what they wrote on the form, then everything the team has
      written since. <b>Write an email</b> and <b>WhatsApp opener</b> draft the first message
      for you; you edit it before it goes.</li>
  </ul>

  <div class="big">
    <h4>What they wrote on the form is the best thing on this page</h4>
    <p>It is in their own words, before anybody sold them anything. "Please call after 6pm, I am
    at work during the day" is the difference between reaching them and six missed calls. Read
    it first.</p>
  </div>
""", num='09', chapter='One lead'))

# ── 10. pipeline ─────────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">The board</h2>
  <h3>The same leads, as cards.</h3>
  <p class="lede">Some people think in lists and some in columns. The Pipeline is My Leads in
  columns — nothing extra, nothing missing.</p>

  <figure>
    <div class="fig"><img src="img/s-pipeline.png" alt="The pipeline board"></div>
    <p class="cap">Each card shows the name, project, budget, where it is stuck, where the lead
    came from and who owns it. A red <b>SLA</b> badge means the five minutes were missed.</p>
  </figure>

  <div class="flow">
    <div><b>New</b>Lead arrives</div>
    <div><b>Attempted</b>You tried</div>
    <div><b>Engaged</b>They replied</div>
    <div><b>Appointment</b>Viewing booked</div>
    <div><b>Deal sent</b>Offer out</div>
    <div class="won"><b>Won</b>Reserved</div>
    <div class="lost"><b>Lost</b>With a reason</div>
  </div>

  <p class="mini">Cards only move forward. If you need to pull one back, ask your manager — that
  is deliberate, because a pipeline anyone can rewind is a pipeline nobody believes. The three
  filters at the top — <b>My leads</b>, <b>Hot only</b>, <b>Missed SLA</b> — are the fastest way
  to find what needs you.</p>
""", num='10', chapter='The board'))

# ── 11. the 24 hour rule ─────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">WhatsApp</h2>
  <h3>The 24-hour rule.<br>This one is not ours.</h3>
  <p class="lede">WhatsApp — the company, not us — only lets a business write freely for 24 hours
  after the client's last message. After that you may only send a message Meta has already
  approved. Break it and the company number gets blocked.</p>

  <figure>
    <div class="fig"><img src="img/s-inbox-closed.png" alt="A conversation where the window has closed"></div>
    <p class="cap">The CRM will not let you get this wrong. When the window has closed the box
    changes by itself: an orange <b>Templates only</b> badge at the top, and a picker instead of
    a place to type.</p>
  </figure>

  <div class="split">
    <div class="card">
      <span class="k">OPEN</span>
      <h4>They wrote in the last 24 hours</h4>
      <p>Type whatever you like. Voice notes, photos, floor plans. Normal conversation.</p>
    </div>
    <div class="card">
      <span class="k">CLOSED</span>
      <h4>It has been longer than that</h4>
      <p>Pick an approved template. It fills in their name and project. The moment they reply,
      the window opens again and you can talk normally.</p>
    </div>
  </div>

  <div class="note"><b>So the trick is simple:</b> get them to reply. A template that asks a
  question re-opens the window. A template that just says "still interested?" usually does not.</div>
""", num='11', chapter='WhatsApp'))

# ── 12. the inbox ────────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">The inbox</h2>
  <h3>Every channel, one thread.</h3>
  <p class="lede">WhatsApp, email, SMS and the team's own notes about a client, in one
  conversation, in order. No switching apps to work out what was said.</p>

  <figure>
    <div class="fig"><img src="img/s-inbox.png" alt="The unified inbox"></div>
    <p class="cap">Left: your conversations, newest first, unread marked. Middle: the thread.
    Right: who they are — stage, score, budget, project, tags and anything still open on them.</p>
  </figure>

  <table class="tight">
    <tr><td>Mine</td><td>Your conversations. Where you live.</td></tr>
    <tr><td>Unassigned</td><td>Somebody messaged the company and no agent owns them yet.</td></tr>
    <tr><td>Unread</td><td>Waiting on an answer from you. Clear this before you go home.</td></tr>
  </table>

  <div class="note"><b>Two people, one client.</b> If a colleague is typing in the same thread you
  will see it. Let them finish — two agents answering the same client in different words is how
  a buyer decides we are not serious.</div>
""", num='12', chapter='The inbox'))

# ── 13. projects ─────────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">Projects</h2>
  <h3>Never quote a price<br>from memory.</h3>
  <p class="lede">Prices move, plans change and units sell. Everything you are allowed to tell a
  client is in here, and it is the only place that is kept up to date.</p>

  <figure>
    <div class="fig"><img src="img/s-projects.png" alt="The project library"></div>
    <p class="cap">Filter by emirate or status, or search in plain English —
    <b>"2 bedroom under AED 2M in Dubai"</b> works. Each card shows the real starting price, the
    payment plan, handover and how many units are actually left.</p>
  </figure>

  <p>Open a project and you get the full unit list with prices and floors, the payment plans, floor
  plans, brochures, the location and what is nearby. Everything is sendable to a client as it is.</p>

  <div class="big">
    <h4>If it is not in here, you do not have it</h4>
    <p>A price you half-remember from a developer's WhatsApp group is not a price. Quote what is on
    this screen, or tell the client you will confirm and come back within the hour. A wrong number
    in writing outlives the deal.</p>
  </div>
""", num='13', chapter='Projects'))

# ── 14. offers ───────────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">Sales offers</h2>
  <h3>Stop sending brochures.</h3>
  <p class="lede">A brochure tells you nothing. An offer is a private page built for one client,
  with the units you picked and the real costs — and it tells you the second they open it.</p>

  <figure>
    <div class="fig"><img src="img/s-offers.png" alt="The sales offer library"></div>
    <p class="cap">This is the part worth learning. <b>Reading now</b> means the client has the
    page open as you look at this screen. <b>7× · 10m 22s</b> means they have been back seven
    times. That is when you ring — not tomorrow.</p>
  </figure>

  <ul class="nums">
    <li>Pick the client and the language — English, Arabic, Russian or Hindi.</li>
    <li>Pick the project, then tick the exact units you want to hold for them.</li>
    <li>Emir AI drafts the words. You edit them. Nothing sends by itself.</li>
    <li>Send it on WhatsApp. You get told when they open it, and again if they heart a unit
      or ask a question.</li>
  </ul>

  <p class="mini">Offers are filed in folders like Drive, and your manager can see the team's.
  Put a price-hold deadline on it and the page shows the client a countdown.</p>
""", num='14', chapter='Sales offers'))

# ── 15. faster ───────────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">Going faster</h2>
  <h3>Two keys you should learn<br>on day one.</h3>
  <p class="lede">Nobody has to use these. The people who do get through their follow-ups in half
  the time, which is the only argument that matters.</p>

  <div class="sideby" style="grid-template-columns:92mm 1fr">
    <figure><div class="fig"><img src="img/o-palette.png" alt="The command palette"></div></figure>
    <div>
      <h4>Ctrl + K</h4>
      <p style="font-size:9pt">Press it anywhere and start typing — a client's name, a project, or
      the screen you want. It searches your leads and the whole CRM at once, and Enter takes you
      there.</p>
      <p class="mini" style="margin-top:2.5mm">If you learn one thing on this page, learn this. It
      replaces every menu in the sidebar.</p>
    </div>
  </div>

  <table class="tight">
    <tr><td><kbd>Ctrl</kbd> <kbd>K</kbd></td><td>Search and jump anywhere. The one to learn first.</td></tr>
    <tr><td><kbd>N</kbd></td><td>Add a lead.</td></tr>
    <tr><td><kbd>/</kbd></td><td>Search the screen you are on.</td></tr>
    <tr><td><kbd>G</kbd> then <kbd>L</kbd></td><td>My Leads. Also G then D for Dashboard, G then
      M for the inbox, G then P for Projects.</td></tr>
    <tr><td><kbd>C</kbd> / <kbd>W</kbd> / <kbd>A</kbd></td><td>On a lead: call, WhatsApp, add a note.</td></tr>
    <tr><td><kbd>?</kbd></td><td>Show the whole list.</td></tr>
  </table>

  <div class="note">They never fire while you are typing, so a note that contains the word
  "call" will not ring anybody.</div>
""", num='15', chapter='Going faster'))

# ── 16. ask emir ai ──────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">Emir AI</h2>
  <h3>Ask it in plain English.</h3>
  <p class="lede">Bottom right of every screen. It can read your leads, your chats and your
  numbers — and only yours. Ask it the question you would ask a manager.</p>

  <div class="sideby" style="grid-template-columns:72mm 1fr">
    <figure><div class="fig"><img src="img/o-ai.png" alt="The Ask Emir AI panel"></div></figure>
    <div>
      <h4>It only sees what you see</h4>
      <p style="font-size:9pt">An agent asking "how is the team doing?" gets their own numbers.
      A manager asking the same question gets the team's. That is not a setting anybody can
      change — it is enforced before the question reaches the AI at all.</p>
      <p class="mini" style="margin-top:2.5mm">Every answer links to the leads it is talking
      about, so you can check it rather than take its word.</p>
    </div>
  </div>

  <div class="split">
    <div>
      <h4>Worth asking</h4>
      <ul>
        <li>Which leads should I call first?</li>
        <li>Summarise Ahmed Khan's chat.</li>
        <li>Who have I not spoken to this week?</li>
        <li>What should I do today?</li>
      </ul>
    </div>
    <div>
      <h4>What it will not do</h4>
      <ul>
        <li class="x">Invent a price. It reads the Projects library or says it does not know.</li>
        <li class="x">Show you another agent's leads.</li>
        <li class="x">Send anything, or change anything, without you pressing the button.</li>
      </ul>
    </div>
  </div>

  <div class="note">It answers in English and Arabic. If it is not sure, it says so rather than
  guessing — if you ever catch it guessing, tell Emir.</div>

  <div class="split" style="margin-top:5mm">
    <div class="card">
      <h4>Before you start calling</h4>
      <p>"Which leads should I call first?" It reads the clock, the scores and what you promised,
      and gives you an order. It takes about four seconds and it is better than your memory at
      nine in the morning.</p>
    </div>
    <div class="card">
      <h4>Before you ring one client</h4>
      <p>"Summarise [name]'s chat." Three lines on a conversation that might be forty messages
      long. Worth doing on any lead you have not touched in a fortnight.</p>
    </div>
  </div>
""", num='16', chapter='Emir AI'))

# ── 17. profile and card ─────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">Your name on it</h2>
  <h3>Fill your profile in once.</h3>
  <p class="lede">Your name, photo, BRN and the line about you appear on every email you send, on
  your business card and on the offers clients open. Ten minutes, once.</p>

  <figure>
    <div class="fig"><img src="img/s-profile.png" alt="The profile screen"></div>
    <p class="cap"><b>How they work</b>, on the right, is counted from the CRM — deals won,
    viewings, how fast you answer. Nobody can type those in, which is exactly why they are worth
    having.</p>
  </figure>

  <div class="split" style="margin-top:4mm">
    <div class="card">
      <h4>The photo is not vanity</h4>
      <p>It sits on your card and at the bottom of every email a client gets. Without one they
      see your initials in a circle, which is what a call centre looks like.</p>
    </div>
    <div class="card">
      <h4>Your BRN</h4>
      <p>Required on anything a client sees. Put it in once and it appears everywhere it has
      to — you will never have to remember it again.</p>
    </div>
  </div>
""", num='17', chapter='Your name on it'))

# ── 18. the business card ────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">Your name on it</h2>
  <h3>Your business card,<br>in about two minutes.</h3>
  <p class="lede">A proper print-ready card in the company's own design, with your name on it.
  You do not need a designer and you do not need to ask anybody.</p>

  <figure>
    <div class="fig"><img src="img/s-card.png" alt="The business card studio"></div>
    <p class="cap">Three designs to choose from. <b>Signature</b> is the one most people pick —
    orange front, black back.</p>
  </figure>

  <ul class="nums">
    <li><b>Choose a design.</b> Compare them side by side if you cannot decide.</li>
    <li><b>Your details.</b> Pulled from your profile, so if you filled that in there is almost
      nothing to type. Check the spelling of your own name — people do not.</li>
    <li><b>Download.</b> A PDF for the printer, or a JPG to send on WhatsApp.</li>
  </ul>

  <div class="note"><b>The QR code on the back opens a WhatsApp chat with you.</b> Not a website,
  not a form — your chat, with the first message already written. That is the entire point of
  handing someone a card at a launch event.</div>
""", num='18', chapter='Your name on it'))

# ── 18. team wall ────────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">The floor</h2>
  <h3>The Team Wall.</h3>
  <p class="lede">Wins post themselves. Everything else — a developer visit, a price list landing,
  a question for the floor — you post yourself.</p>

  <figure>
    <div class="fig"><img src="img/s-wall.png" alt="The team wall"></div>
    <p class="cap">Your points, your streak and where you sit over 30 days are on the right.
    Points come from the work: answering fast, booking viewings, closing. Not from posting.</p>
  </figure>

  <div class="split">
    <div class="card">
      <h4>Say thank you</h4>
      <p>Somebody covered your client while you were out? Say so here. It is visible to everyone,
      including Emir, and it counts.</p>
    </div>
    <div class="card">
      <h4>Your streak</h4>
      <p>Days in a row you cleared your follow-ups. Weekends do not break it. It is the single
      honest measure of whether you are keeping up.</p>
    </div>
  </div>
""", num='19', chapter='The floor'))

# ── 7. don't do this / help ──────────────────────────────────────────────
PAGES.append(page(f"""
  <h2 class="sec">Last page</h2>
  <h3>Six ways to lose a deal<br>in a system built to stop you</h3>

  <ul style="margin-top:5mm">
    <li class="x"><b>Letting the 5 minutes run out.</b> The lead goes to someone else and the
      client has already answered another broker.</li>
    <li class="x"><b>Keeping it in your head.</b> If it is not in the note, it did not happen —
      and when you are on leave, nobody can pick it up.</li>
    <li class="x"><b>Leaving a lead with no next step.</b> It quietly dies in a tab you
      never open.</li>
    <li class="x"><b>Quoting a price from memory.</b> Prices change weekly. Use the Projects
      library or ask.</li>
    <li class="x"><b>Sending a brochure instead of an offer.</b> A brochure tells you nothing.
      An offer tells you the second they open it.</li>
    <li class="x"><b>Messaging someone who said stop.</b> It is the law here, and it puts the
      company's WhatsApp number at risk.</li>
  </ul>

  <div class="big" style="margin-top:7mm">
    <h4>Three things, every day</h4>
    <p>Clear <b>Follow-up today</b>. Empty <b>No next step</b>. Ring everything in <b>Hot</b>.<br>
    Do that and the rest of this handbook takes care of itself.</p>
  </div>

  <h4 style="margin-top:7mm">Stuck?</h4>
  <table>
    <tr><td>Forgot your password</td><td>Ask the office to reset it — you set a new one next time you sign in.</td></tr>
    <tr><td>A lead looks wrong</td><td>Say so straight away. Do not work around it.</td></tr>
    <tr><td>Something is missing</td><td>Tell Emir. If ten of you hit it, it gets built.</td></tr>
    <tr><td>Not sure what to do next</td><td>Press <kbd>?</kbd>, or ask Emir AI.</td></tr>
  </table>

  <div style="margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end">
    <div style="width:42mm">{logo_colour}</div>
    <p class="mini" style="text-align:right">Emigeo Homes Real Estate<br>
      Agent handbook · version 1</p>
  </div>
""", num='20', chapter='Last page'))

html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>homes.me CRM — Agent handbook</title><style>{fonts}{CSS}</style></head>
<body>{''.join(PAGES)}</body></html>"""
(HERE / 'handbook.html').write_text(html)
print('handbook.html written:', len(html) // 1024, 'KB')

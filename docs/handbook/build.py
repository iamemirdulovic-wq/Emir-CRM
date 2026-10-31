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

# ── 2. your day ──────────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">Your day</h2>
  <h3>Open the Dashboard.<br>It tells you what to do.</h3>
  <p class="lede">You do not have to decide where to start. The CRM has already worked it out
  and put it at the top of the screen, in the order that costs most if you ignore it.</p>

  <div class="grid">
    <div class="card"><span class="k">FIRST</span><h4>A lead about to be taken</h4>
      <p>The 5-minute clock is running. Open it now or it goes back to the pool.</p></div>
    <div class="card"><span class="k">THEN</span><h4>A promise you broke</h4>
      <p>You said you would call Tuesday. It is Thursday. These first.</p></div>
    <div class="card"><span class="k">THEN</span><h4>A hot lead nobody rang</h4>
      <p>Scored 70 or more. Big budget, ready to buy, still untouched.</p></div>
    <div class="card"><span class="k">THEN</span><h4>Someone waiting on a reply</h4>
      <p>They messaged you. You have not answered. They are shopping elsewhere.</p></div>
  </div>

  <div style="margin-top:7mm">
    <h4>Then go to My Leads and work the tabs left to right</h4>
    <table>
      <tr><td>Follow-up today</td><td>What you promised, due today. Empty by lunch is a good day.</td></tr>
      <tr><td>New</td><td>Nobody has spoken to them yet. Call, do not message.</td></tr>
      <tr><td>Hot</td><td>The CRM thinks these are your real buyers. Treat them like it.</td></tr>
      <tr><td>Overdue</td><td>You are late. Say sorry and ring anyway.</td></tr>
      <tr><td>No next step</td><td>Open leads with no plan. This is the leak.</td></tr>
      <tr><td>All</td><td>Everything you own.</td></tr>
    </table>
  </div>

  <div class="dark" style="margin-top:auto">
    <h4>Nothing in Follow-up today?</h4>
    <p>That is not a day off — it is the best hour you will get. Go to <b>Lead pool</b> and
    press <b>Claim next lead</b>, or open <b>Hot</b> and call the top three.</p>
  </div>
""", num='02', chapter='Your day'))

# ── 3. working one lead ──────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">One lead, start to finish</h2>
  <h3>Open it. The top of the page tells you where it stands.</h3>
  <p class="lede">Before you dial, read the panel at the top — it says what has happened and
  what to do next, in one line. Then use the buttons across the top; every one of them records
  itself, so you never type the same thing twice.</p>

  <div class="grid">
    <div class="card"><h4>Call</h4><p>Dials on your phone and logs the attempt. Then it asks how
      it went — answered, no answer, wrong number.</p></div>
    <div class="card"><h4>WhatsApp</h4><p>Opens the chat with their number already there.
      The conversation comes back into the CRM inbox.</p></div>
    <div class="card"><h4>Call back</h4><p>They said "ring me Thursday at six". Press this,
      pick the time, and it will remind you.</p></div>
    <div class="card"><h4>Meeting</h4><p>A viewing or a sales-centre visit. Moves the card to
      Appointment Scheduled.</p></div>
    <div class="card"><h4>Problem</h4><p>Wrong number, not interested yet, budget is nowhere near.
      Keeps the lead honest instead of parked.</p></div>
    <div class="card"><h4>Won / Lost</h4><p>Won asks what they reserved. Lost asks why — one tap,
      and it teaches the system which ads are wasting money.</p></div>
  </div>

  <div class="big">
    <h4>The note is the part that pays you</h4>
    <p>"Wants 2BR, sea view, under 2.4M. Wife decides. Back in Dubai on the 12th."
    That note is worth more in a month than anything else on the screen — and writing it
    moves a new lead to Attempted Contact for you.</p>
  </div>

  <div class="flow">
    <div><b>New</b>Lead arrives</div>
    <div><b>Attempted</b>You tried</div>
    <div><b>Engaged</b>They replied</div>
    <div><b>Appointment</b>Viewing booked</div>
    <div><b>Deal sent</b>Offer out</div>
    <div class="won"><b>Won</b>Reserved</div>
    <div class="lost"><b>Lost</b>With a reason</div>
  </div>
  <p class="mini">Cards only move forward. If you need to pull one back, ask your manager —
  that is deliberate, because a pipeline anyone can rewind is a pipeline nobody believes.</p>
""", num='03', chapter='One lead'))

# ── 4. messaging ─────────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">Talking to clients</h2>
  <h3>The inbox, and the 24-hour rule</h3>
  <p class="lede">Every WhatsApp, email and note about a person sits in one thread, so whoever
  picks it up next can see the whole story.</p>

  <div class="dark">
    <h4>WhatsApp has a rule nobody can get around</h4>
    <p>Once a client messages you, you have <b>24 hours</b> to write whatever you like. After
    that, Meta only allows approved templates until they write again. The CRM shows you which
    one you are in: a free text box, or a list of templates. <b>This is not the CRM being
    difficult</b> — breaking it is how companies get their number banned.</p>
  </div>

  <ul>
    <li><b>Someone is already replying?</b> You will see "X is replying…" so two of you never
      answer the same client twice.</li>
    <li><b>Email</b> goes out from your own address, and their reply comes back into the thread.</li>
    <li><b>Internal notes</b> are blue and never reach the client. Say anything you need to.</li>
    <li class="x"><b>Never</b> message someone who asked to stop. The CRM blocks it, and so does
      the law here.</li>
  </ul>

  <h4 style="margin-top:7mm">Sending a client a project</h4>
  <p>Do not send a brochure PDF and hope. Build a <b>Sales offer</b>: pick the lead, pick the
  project and the exact units, and the CRM makes a private page for that one client, with the
  real prices, the payment plan and a deadline on the price hold.</p>
  <ul>
    <li>You get told <b>the moment they open it</b> — and again if they heart a unit or ask
      a question.</li>
    <li>You can see how long they spent and which part they read. That is your opening line
      when you ring them.</li>
    <li>Everything on it comes from the Projects library, so the numbers are right.</li>
  </ul>

  <div class="big" style="margin-top:auto">
    <h4>A client who opened your offer twice is a client you ring today</h4>
    <p>Not tomorrow. The page tells you the moment it happens.</p>
  </div>
""", num='04', chapter='Talking to clients'))

# ── 5. speed ─────────────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">Going faster</h2>
  <h3>The shortcuts that are worth learning</h3>
  <p class="lede">Learn the first one today. Learn the rest whenever. On a phone, ignore this
  page entirely — everything has a button.</p>

  <div class="split">
    <div>
      <h4>Anywhere</h4>
      <table>
        <tr><td><kbd>Ctrl</kbd> <kbd>K</kbd></td><td>Find any lead, screen or action. Start here.</td></tr>
        <tr><td><kbd>N</kbd></td><td>Add a lead</td></tr>
        <tr><td><kbd>/</kbd></td><td>Search this screen</td></tr>
        <tr><td><kbd>?</kbd></td><td>Show every shortcut</td></tr>
      </table>
      <h4 style="margin-top:6mm">On a lead</h4>
      <table>
        <tr><td><kbd>C</kbd></td><td>Call them</td></tr>
        <tr><td><kbd>W</kbd></td><td>Open WhatsApp</td></tr>
        <tr><td><kbd>E</kbd></td><td>Write an email</td></tr>
        <tr><td><kbd>A</kbd></td><td>Add a note</td></tr>
        <tr><td><kbd>S</kbd></td><td>Set the next step</td></tr>
      </table>
    </div>
    <div>
      <h4>Jump to a screen — press G, then:</h4>
      <table>
        <tr><td><kbd>G</kbd> <kbd>D</kbd></td><td>Dashboard</td></tr>
        <tr><td><kbd>G</kbd> <kbd>L</kbd></td><td>My Leads</td></tr>
        <tr><td><kbd>G</kbd> <kbd>Y</kbd></td><td>Today's follow-ups</td></tr>
        <tr><td><kbd>G</kbd> <kbd>K</kbd></td><td>Pipeline board</td></tr>
        <tr><td><kbd>G</kbd> <kbd>M</kbd></td><td>Inbox</td></tr>
        <tr><td><kbd>G</kbd> <kbd>T</kbd></td><td>Tasks</td></tr>
        <tr><td><kbd>G</kbd> <kbd>P</kbd></td><td>Projects</td></tr>
        <tr><td><kbd>G</kbd> <kbd>O</kbd></td><td>Sales offers</td></tr>
        <tr><td><kbd>G</kbd> <kbd>W</kbd></td><td>Team Wall</td></tr>
      </table>
      <p class="mini" style="margin-top:4mm">Typing a note? The letters stay letters.
      Shortcuts never fire while you are writing.</p>
    </div>
  </div>

  <h4 style="margin-top:7mm">Ask Emir AI — bottom right, every screen</h4>
  <p>It can see your leads, your chats and the projects, and it only answers about what you are
  allowed to see. Try asking it, in plain English:</p>
  <div style="margin-top:3mm">
    <span class="tag">Which leads should I call first?</span>
    <span class="tag">Summarise Ahmed's chat</span>
    <span class="tag">2 bedroom under AED 2M in Dubai</span>
    <span class="tag">What should I do today?</span>
    <span class="tag">Who have I not called this week?</span>
  </div>
  <p class="mini" style="margin-top:3mm">It never invents a price. If it does not know, it says so.</p>
""", num='05', chapter='Going faster'))

# ── 6. you ───────────────────────────────────────────────────────────────
PAGES.append(page("""
  <h2 class="sec">Your name on it</h2>
  <h3>Your profile, your card, your numbers</h3>
  <p class="lede">Click your name, bottom left. Two minutes here and every client you meet
  gets a better first impression.</p>

  <div class="grid">
    <div class="card"><h4>Add your photo</h4><p>It goes on your business card and the bottom of
      every email you send. Without one, clients see your initials.</p></div>
    <div class="card"><h4>Job title and BRN</h4><p>Required on anything a client sees.
      Fill it in once.</p></div>
    <div class="card"><h4>Your digital card</h4><p>Switch it on and you get a link that opens
      with no app and no login — photo, WhatsApp button, QR code. Send it after every viewing.</p></div>
    <div class="card"><h4>A printed card</h4><p><b>Design a card to print</b> — three homes.me
      designs, your details, a PDF the printer can use. Takes two minutes.</p></div>
  </div>

  <h4 style="margin-top:7mm">Ten badges. Nobody can hand them to you.</h4>
  <p>Every one is counted from what you actually did — so nobody can give you one for being
  liked, and nobody can withhold one either.</p>
  <div style="margin-top:3mm">
    <span class="tag">First deal</span><span class="tag">Ten deals</span>
    <span class="tag">Fast hands — reply in under two minutes</span>
    <span class="tag">Under thirty — reply in under 30 seconds</span>
    <span class="tag">Seven days running</span><span class="tag">Thirty days running</span>
    <span class="tag">Fifty viewings</span><span class="tag">Tidy desk — a next step on every lead</span>
    <span class="tag">Note taker</span><span class="tag">One year</span>
  </div>

  <div class="dark" style="margin-top:7mm">
    <h4>The Team Wall, and how points really work</h4>
    <p>Points come from <b>outcomes, never activity</b>. Logging a call earns nothing — anyone
    can log a call. <b>Reaching</b> someone earns, because the client is the witness.
    A viewing that happened beats one that was booked. Posting earns nothing at all.</p>
    <p style="margin-top:3mm">Your streak <b>ignores the weekend</b>. Friday to Monday is not a
    broken streak — nobody here is being told to work Saturday.</p>
  </div>
""", num='06', chapter='Your name on it'))

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
""", num='07', chapter='Last page'))

html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>homes.me CRM — Agent handbook</title><style>{fonts}{CSS}</style></head>
<body>{''.join(PAGES)}</body></html>"""
(HERE / 'handbook.html').write_text(html)
print('handbook.html written:', len(html) // 1024, 'KB')

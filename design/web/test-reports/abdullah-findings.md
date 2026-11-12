# Abdullah (office admin) · findings · settings pages + shell

Format: severity · page · what I did → what happened → what a broker expects · status

## settings-team.html
1. Major · settings-team · Invited Maria, then cancelled the invite (two clicks) → row went away but the cards still said "14 people · 1 invite waiting" → numbers must go back to 13 / 0 · FIXED (one recount for every change)
2. Major · settings-team · Changed Talha to Admin, deactivated Shan → "Roles 2 owners · 1 admin · 10 agents" never changed → card must follow the table · FIXED (also shows "1 deactivated")
3. Major · settings-team · Changed George from Owner to Agent → happened with one click, no question → taking Owner away is as risky as giving it; ask twice · FIXED ("Tap again · no longer owner")
4. Minor · settings-team · Searched "zzz" → empty white table, only a small "Nobody found" on the right → an empty state with one button · FIXED ("Show everyone")
5. Minor · settings-team · Invited an Admin, opened Invite again → role still on Admin but hint text said Agent → form must start clean · FIXED
6. Minor · settings-team · After Undo of a deactivate the role select no longer asked twice for Owner · FIXED (select is wired again)

## settings-attendance.html
7. Major · settings-attendance · Typed "Late after 08:30" (before the 09:00 start) → no red message while typing (the shell cleared it), and "Save rules" then did nothing at all, no message → show the error at once and say why nothing was saved · FIXED
8. Minor · settings-attendance · Set Ends 08:00 before Starts → the error sat under "Late after" → error belongs under "Ends" ("Must be after the start.") · FIXED
9. Major · shell (app.js) · Shift fields are native time fields: Chrome shows "09:00 AM / 05:30 PM" on an English-US computer → the CRM is 24-hour everywhere · FIXED in app.js (every `input type=time` becomes a 24-hour HH:MM box; value format unchanged)
10. OK · Wi-Fi: empty name, duplicate name (any letter case), add, remove with two clicks, the last one cannot be removed, Undo → all worked.

## desks.html
11. Minor · desks · Deleted the Abu Dhabi desk → top card still said "10 agents on a desk · Rocky sits on 2" → number must follow the desks · FIXED (counted live; shows "2 with no desk")
12. Minor · desks · New desk panel says "Also on Dubai off-plan" for an agent who is not on the new desk yet → "On Dubai off-plan" · FIXED
13. OK · desks: empty name, same name again, no member, add, edit, max 40/50/60/80, delete with two clicks (card and panel), Undo, Esc and click outside close the panel → all worked.

## automations.html / company.html / ai-settings.html / system-health.html
14. Minor · automations · Chose "Imported lead 4 hours" → help text still said the agent sees "goes back tomorrow 09:00" → text that fits every choice · FIXED
15. Minor · ai-settings · Headings said "AI can" and "What AI should know about us" → the name is "Homes AI" everywhere · FIXED (3 texts)
16. OK · automations: VIP 15 min / 30 min / 1 hour / 2 hours, imported 4 / 24 / 48 / 72 hours, take-back off needs two taps, every switch gives a toast and the "x of y on" count follows.
17. OK · company: empty legal name, letters in ORN, short TRN, bad phone, bad email all stop the save with a clear line; preview follows typing; logo remove asks twice. 
18. OK · system-health: "Run a check now" shows progress, ends "All 6 services are fine", "What to do" changes.

## manage-projects.html
19. Major · manage-projects · Uploaded a brochure to a new project, then chose the SAME PDF for Sei Saadiyat and saved → toast "saved" but the row still showed "Upload" (the file box kept the old file, so nothing happened) → brochure must attach every time · FIXED (file box is cleared when the panel opens)
20. Major · manage-projects · Clicked "Hidden" once on The Archive (115 leads) → hidden from all agents at once → a risky click must ask twice · FIXED ("Tap Hidden again to hide The Archive… its 115 leads stay")
21. Minor · manage-projects · Set Sei Saadiyat (no brochure) to "Selling now" → toast said agents "can send the brochure" → say there is no brochure yet · FIXED
22. Minor · manage-projects · Starting price "cheap" was accepted; a name with < > was shown as code; empty Area showed "Nakheel · –" · FIXED (price needs a number, names are escaped, no dash)
23. OK · manage-projects: empty name, same name in other letter case, Word file, 31 MB PDF, new project starts Hidden, delete of a project with leads is refused, delete of an empty one asks twice with Undo.

## home-banners.html
24. OK · home-banners: empty title, start day in the past, "Until" before "Show from", web link without https, own picture, one desk, scheduled banner ("it starts 13 Nov"), 6th banner refused two ways ("You can have 5 banners"), remove asks twice, ended banner can be shown again, drag changes the order.
25. Minor (open) · home-banners, sales-offers · date boxes are the browser's own: on an English-US computer they read 11/11/2026 (month first) → Dubai reads day first. Not fixed: it follows the computer's region setting; the real build should use its own date picker.

## sales-offers.html
26. Minor · sales-offers · After saving an offer for Valia, opened "New sales offer" again → project back on The Archive but hint said "Valia starts from AED 1.4M" · FIXED
27. Minor · sales-offers · Offer made by the owner said "Your agent: Emir" and the hint "Only your open leads" → full name; hint only for agents · FIXED
28. OK · sales-offers (owner and agent): empty form, price 1,500 ("looks too low"), past day, save as draft, share ("WhatsApp opens… You press send."), accept asks twice, filters, empty state, Clear all.

## settings.html (my own settings, owner and agent)
29. OK · Light / Dark / Auto, sounds on/off, test sound, volume, Arabic "comes later", notification switches, "VIP always on" cannot be switched off, turn all on/off, quiet hours Off / 22:00 – 08:00 / 20:00 – 09:00, VIP exception, test notification, agent sees no Office section.
30. Major · shell · Chose "Auto" in Settings, opened another page → Auto was forgotten (only the Settings page knew it); dark switch in the profile menu did not end Auto → FIXED in app.js (Auto is read on every page; the menu switch and the search action end Auto)
31. Minor (open) · settings · My switches and quiet hours go back to the start values after a reload. Demo limit: nothing is stored. Not fixed.

## LATER pages (inbox, email, templates)
32. OK · all three open from the sidebar for both roles, show as active, carry the "LATER PHASE · Not in the first build…" banner; no "EOI", no "sent" claims, send buttons answer "Later phase…".

## SHELL (app.js, ui.css) — tested on all 49 pages by script, by hand on 12
33. Major · sidebar collapsed · hovered an icon → no label (the CSS tip was cut off by the scrolling list), so the rail was icons only → FIXED (floating label with the number: "Incoming · 3")
34. Major · sidebar collapsed (also every window under 1200 px) · Inbox / Email / Templates were not there at all → FIXED (three faint icons; also in search as "Inbox · later")
35. Major · search · typed "archive" + Enter → opened a lead (Khalid), not the project; typed "banner", "manage projects", "wifi", "inbox", "templates", "leave", "sign out", "lina" (owner), "abdullah" → "Nothing found, add as a new lead" → FIXED (best group first; 17 more screens with hidden words; owners, admin and Incoming leads added; "See all results" opens search.html?q=…)
36. Major · search · local phone forms 0505550101 / 00971505550101 found nothing [yuliia] → FIXED
37. Major · role · an agent who opened an owner page became owner for the whole site [emir]; an owner who opened attendance.html became agent [yuliia] → FIXED (only login and "View as" change the role; agent gets the "Only for owners and admin" block)
38. Major · dark theme · sidebar group labels, the Later row, settings labels, calendar grey days, placeholder text used #55535A on black (contrast 2.4–2.6) → FIXED (--ink-4 lighter in dark, a little darker in light); toasts were the same colour as cards [yuliia] → FIXED (lighter + border); white text on the green button → dark text
39. Major · 1280 px · wide tables were cut on the right with no scroll (manage-projects "View", all-leads, my-leads, sales-offers, team-attendance); top bar wider than the window on owner-home / team-activity → FIXED (.table-wrap scrolls, search box gives way); settings-team hides "Last sign-in" under 1340 px
40. Major · badges · agent "Incoming 3" but the page says "2 free leads" → FIXED (2). Owner bell 5 vs 6 "Needs you now" items [emir] → FIXED (bug report added, 6). New HM.setBadge(key, n) for pages [emir, yuliia].
41. Minor · bell · "Mark all read" came back unread on the next page → FIXED (kept until the role changes). "How did the meeting go?" now opens calendar.html#result; "+ Add lead ▾ Meeting" opens calendar.html#new.
42. Minor · check-in pill text was fixed [yuliia, rocky] → FIXED: HM.setCheckin(state, text or 'HH:MM'), kept between pages. Countdown is filled at once [rocky]. Lead links carry ?n=Name in search and bell [rocky].
43. Minor · toasts piled 3 high over buttons [yuliia] → now 2 at most (not 1: an Undo must stay reachable).
44. Minor · short windows (under ~860 px high) · the menu list scrolled with no hint → FIXED (fade at the edge, active item scrolled into view)
45. OK · every sidebar item (21 owner, 18 agent, expanded and collapsed) opens its page and is the only active one; Ctrl K, "/", arrows, Enter, mouse, Esc, click outside; "+ Add lead", N key and menu; check-in pill → attendance; all 8 + 6 notifications open their page and tab; profile menu (theme, View as, Sign out → login.html); every dialog and panel on 12 pages closes with Esc and with a click outside.

## Open (not mine or not fixable here)
- tasks.html (owner): badge "Follow-ups 9" vs page "Overdue 1" (picker starts on Rocky) — in shared-issues.md for the page owner.
- Native date boxes follow the computer's region (see 25). lead.html still has one datetime-local box that can show AM/PM.
- Badges do not change by themselves when a page acts; pages must call HM.setBadge.

# Rocky Khan (agent) · findings · my-day, my-leads, lead, calling, add-lead, incoming, pipeline, transfers, lead-kit.js

Tested with playwright scripts t1–t13 in this folder (agent + owner, checked in / not checked in, light + dark).
Status: FIXED = fixed and re-tested in the browser · OPEN = not fixed (reason given) · SHARED = logged in ../shared-issues.md.

## Blocker
1. FIXED · every page → lead.html · clicked Khalid, Sara, a pipeline card, "Open the lead" in calling, the duplicate "Open" in Add lead · always got Marco Bellini · a broker expects the lead he clicked. lead.html now reads `?n=Name` (links built with `LK.url`), shows that lead's phone, stage, next step, notes, details; all my pages link with the name.

## Major
2. FIXED · lead · "+ Add" a want, type, Enter · the chip was added twice and a JS error was thrown · one chip. Removing a chip now has Undo.
3. FIXED · lead · follow-up with "Pick date" 14 Nov · "Coming up" said "Today 16:00" · now "Sat 14 · 16:00".
4. FIXED · lead · after Won the lead could be marked Lost; Undo of Lost left "No next step" · Won/Lost are closed after a Won or Lost; Undo brings back the stage and the next step.
5. FIXED · my-leads, lead · lead without a phone (Tom Becker): Call opened a dialog with an empty number · Call / WhatsApp / Telegram are disabled, LK.call shows an error toast.
6. FIXED · my-leads · column headers looked sortable but did nothing · Lead, Project, Stage sort (up, down, off).
7. FIXED · my-leads · "Start calling" was open when not checked in (spec: locked "Check in to start calling") · strip is locked, unlocks after check-in.
8. FIXED · my-leads · next step cut ("Follow-up overdue since …") and Call only on hover · wider column, Call / WhatsApp always visible.
9. FIXED · my-day · VIP: after Accept + Call nothing changed ("call now", clock text "back to Incoming") · new state "called 14:55 · clock stopped" with "What happened?"; the result closes the VIP card and Emir is told.
10. FIXED · my-day, my-leads, lead, calling · the CRM forgot what I did when I changed page · last action per lead is remembered in the tab (call clicked, WhatsApp opened, result) and shown on the My Day call list, My leads row + panel "Last contact", lead timeline.
11. FIXED · calling · Undo on an older toast removed the result of the lead on screen, not the lead of the toast · Undo is tied to its own lead.
12. FIXED · calling · "No answer" + "also open WhatsApp with I tried to call you" opened the general hello text · the right text is prepared.
13. FIXED · transfers / lead-kit · rule "one open request per lead" was not enforced (Omar Khalil could be sent twice) · panel blocks it and says who has the open request; Cancel frees it.
14. FIXED · transfers, my-day · "No, thanks" to a colleague's transfer was one click · two clicks + Undo.
15. FIXED · lead-kit · "What happened?" after a call offered message answers ("Sent…", "Didn't send") · call answers for calls; "He replied" → "Client replied".
16. FIXED · incoming (owner) · "Share equally" toast always named Lina and Kevin, also when Lina was already given ("1 leads shared · Lina → Tej · Kevin → Olga") · names the real leads.
17. FIXED · incoming (owner) · VIP given with "15 min" showed a 30:00 clock; the choice stayed for the next lead; every re-draw restarted the clocks; no Undo on "Give to another agent" · all four fixed.
18. FIXED · pipeline · names, budget and next step cut on every card ("Khalid Al Ma…", "AE…") · text wraps.
19. FIXED · data · Aisha Noor was Won with Rocky (pipeline) and Meeting with Talha (VIP list); Elena Kuznetsova was Rocky's Offer and Yuliia's VIP; Lina Rahimi was "with Shan" in the duplicate check but free in Incoming · pipeline uses Layla Haddad, VIP list uses Irina Volkova, duplicate check says "free lead in Incoming" with a link.
20. SHARED · top bar · pill says "In office · 08:55" after a check-in at 14:55 (app.js).

## Minor
21. FIXED · my-day · calls today showed 20 in the call list and 18 in two other cards · one number everywhere.
22. FIXED · my-day · Follow-ups "0 Overdue" stayed red, tile still "1 overdue" · both follow.
23. FIXED · my-day · project card text cut ("24 …") · two lines.
24. FIXED · my-day · refusing the VIP left "To call today 12" · 11, back to 12 on Undo.
25. FIXED · my-leads · going from one hash to another (#hot) did nothing; row menu and panel links opened Marco.
26. FIXED · lead · meeting WhatsApp said "I confirm our show flat on…" · "our visit to the show flat".
27. FIXED · incoming (agent) · "3 free leads" counted the VIP lead nobody can take · "2 free leads to take · 1 VIP lead waits for an owner".
28. FIXED · add-lead · "Add another" kept the last country code; saved lead could still be edited on the left; "Open lead" opened Marco.
29. FIXED · transfer panel · no warning when the only match is above the desk maximum (Shan 57 / 50) · hint under the list.
30. FIXED · calling · "No answer" said "counted as a call" when only WhatsApp was opened.
31. OPEN · pipeline (owner) · agent filter other than Rocky shows only 1–2 sample cards · needs sample leads for 9 agents; a note now says it is a demo sample.
32. OPEN · lead · "Coming up" is in the order added, not by time · small, left.
33. OPEN · calling · "Interested · Book a meeting" does not open the meeting form · needs the lead page dialog shared; left.
34. OPEN · my-day · "Today's plan" card has empty space at the bottom; "Next plan" still shows the VIP call after it is done.
35. OPEN · my-day undo of a saved "What happened?" does not bring the row back to the waiting list.

Not tested: real tel:/WhatsApp hand-off, widths other than 1440, keyboard-only use, command palette and notification panel (app.js), collapsed sidebar, tasks.html / project.html that also load lead-kit.js (only checked that my changes keep the old calls working by reading, not by clicking).

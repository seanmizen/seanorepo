# 002: The Rack design

Where: `apps/crm`. When: every crm page change after round 2 of the design competition. Why: one written source, so that parallel work builds to the same rules.

Round 2 picked the **Rack** entry as the base: all of its structure and all of its details. Smaller picks come from Run, Timeline and Card Index. The sections below give each pick in the words of its designer, then the decisions that join them.

## The thesis (Rack)

Each page is a rack over a band, both the full width of the page. The rack is the device on its side: a wide glass strip with its plate keys, over the modules in one row. The band is the data as one wide chart with a gutter of groups, like the chord chart of autosam. The tall 40% column hides the next action and the postcode of each org, and pushes the pager, history and Save lead out of reach. With the rack, the day plan reads from one screen, each door fits the first screen of the phone, and Next walks the list. The look stays: the same glass, keys, LEDs and tokens.

## Structure (Rack)

- **Rack.** The device, the full width, at the top of every page. Units stack on one chassis, and each unit has an ear at each end.
- **Display unit.** The glass as one wide strip of read-outs, legend over value. The plate keys at its right are the pager, Start, Undo, Redo, Prev and Next, each with a caption under it.
- **Control unit.** The modules side by side on a grid of 12: Search, Stage and Sort on the list. Log, Stage and Next action on the org page. Organisation, Address, First contact and First visit on a new lead.
- **Band.** The data under the rack, the full width: a chart on the chassis, with a gutter that names each group (due date, postcode district, month). On the org page: Contacts, Details and Activity, all open.
- **Phone window.** On a phone the control unit is a window one module wide, with tabs over it. Swipe it or tap a tab. A submit loads the page at the module that comes next, for example #next.
- **Running order.** The order of the list carries into the org pages. Start opens the first org, and Prev and Next on the plate walk the list, so the list is the route of the day.

## Details (Rack)

1. Glass: one strip of read-outs, legend over value, with faint rules between them. The name is the one large value. A save or an error is the first line, after the status mark.
2. Plate keys: each has a caption under it. The caption tells what the key acts on (Undo: Visit 3), or why it is grey (First page, Last in list).
3. Sub-labels from autosam: Call back says 'then due', and Do not knock says 'sets Lost'. Each due key shows the date it sets, and each stage key shows its count.
4. LEDs are only on metal: the plate, the tops of keys, and the chassis seam at the left of each band row. Red means due or on. No LED is on the glass or the paper.
5. Band rows have one fixed height and an arrow column, so hover and focus move no character. Overdue shows three times: the LED, the group name and the words '3 days overdue'.
6. Each state shows in three places: the glass, the part with the problem, and the key that fixes it. The part with the problem gets a thick outline and a word such as 'needed'. No state uses colour alone, and no state is a dead end.
7. Words: Save as visit, Note only, Save lead, Clear, Start, Prev, Next, Undo, Redo. New lead carries the search text. An empty value says None or No contacts, never a blank.
8. Bare HTML and access: each module is a section with an h2, and the read-out is a dl. The band is real tables with rowgroup headers, and the tabs are anchor links. Phone targets are 44px. The display unit stays at the top only in a window 720px or taller.

## Picks from the other entries

- **Run, the run bar.** One device across the top. The LCD says where the round is. Three latching mode keys (Plan, Walk, Close) replace the footer nav, and one black key is the next step of the round.
- **Timeline, /orgs.** The A-Z index, with search, the stage keys and the three sort keys. It is the address book. It is not the home.
- **Timeline, type.** Type: mono for each date, time and count. Sans for names and notes out of the glass. Silkscreen only for the name of a part: a slot, a module, a legend.
- **Timeline, rows.** Characters never move. A slot head is always 3 lines high and each row has one height, so the rows line up across the axis. A row shows its date only when its slot covers more than one day.
- **Timeline, keyboard (held in reserve).** Keyboard: arrow keys select, T 1 2 3 D move, Enter opens, L logs, Z undoes, / finds. With no JavaScript, the same buttons carry accesskeys.
- **Card Index, LEDs.** LEDs have one meaning each. The bezel LED of a card is lit when the card is due (today or overdue). The blinking mark in the glass means overdue or an alert. The stage strip LED is the stage. A latch LED is an open drawer or a pressed filter. The text always tells the same state.

## Decisions

1. **One device.** The run bar does not add a second strip. Its three mode keys sit on the plate of the display unit and replace the nav links. The keys are **Plan**, **Work** and **Review**:
   - Plan is home: the band, grouped by due date (Overdue, Today, later).
   - Work is Start, then Prev and Next through the running order.
   - Review is the evening view: the visits logged today, and what is still due.
2. **No round record.** The running order (the order of the list Sean came from) is the round. There is no migration and no new table.
3. **No walk order.** There is no route, no house-number sort and no map. The sorts are due, created date and name. The crm is a general client record tool. Door-to-door is one source of leads, not the shape of the app.
4. **A press changes only its effect.** When JavaScript runs, each form submit and each in-app link updates the page in place. The script morphs the new HTML into the page. The focused control and the scroll position stay. With no JavaScript, the pages work as plain forms and links. The morph ticket registers this as a requirement.
5. **Layout shift is a bug.** Three rules keep the page still when its data changes. Each row has a fixed height. Keys always exist (REQ-CRM-BUTTON-001). A save or an error has a fixed line in the glass.
6. **LEDs.** An LED is on metal only. Each LED position has one meaning. The chassis seam of a band row is due. A key-top LED is on. A latch LED is a pressed filter or mode. The blinking ink mark is the only mark in the glass (REQ-CRM-LCD-001).
7. **Breakpoints.** The width breakpoint stays at 960px. One height query is also allowed: the display unit stays at the top only in a window 720px or taller.
8. **Keyboard keys** wait until Sean asks for them.

## House rules that this design replaces

- The 40/60 grid of the device and the boxes (REQ-CRM-LAYOUT). The device is a full-width rack, and the data is a full-width band under it. The chassis ticket updates the requirement.
- The list as a menu in the glass. The list moves to the band. The glass holds the read-out of the page.
- The nav links in the footer on desktop and at the top on a phone. The mode keys on the plate replace them.
- Add a contact as its own module. On desktop it is the last row of the Contacts table.

## Order of work

1. Morph navigation, and the four bugs that the designers found, in parallel.
2. The chassis and the Plan home.
3. The org page, then the new lead page and /orgs.
4. The running order and the mode keys, then the phone window.
5. The keyboard keys, when Sean asks.

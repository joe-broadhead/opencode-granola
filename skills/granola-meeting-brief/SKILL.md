---
name: granola-meeting-brief
description: Build a sourced brief before a meeting or recap a period from the user's Granola notes: background, decisions, open questions and commitments. Use with the granola skill; not for calendars or upcoming meetings.
---

# Granola meeting brief

A short brief in which every claim is tied to a meeting. Load the `granola` skill too; it covers the tools, quoting and
citing.

## 1. Pin down the meeting and the window

- Granola holds only past meetings. For "my next meeting" or "tomorrow's call", get the event's title, time and
  attendees from a calendar tool if one is available, or ask the user which meeting it is. Read the calendar only for
  that event, then search Granola for those attendees' earlier meetings. Never present a past Granola meeting as the
  upcoming one.
- Agree the subject and the window. With no preference, start with the last 30 days, widen when that finds nothing, and
  say which window you used. For a recap of a period, that period is the window.
- If searches by attendee and by topic both find nothing, stop and say so instead of listing a longer period's
  meetings: a meeting that matches neither the people nor the topic is not background for this brief.

## 2. Find and read

- Search with `tools.granola.search_meetings` by the attendees (`participant`: a whole name, email, company or domain,
  one per call) and by the topic (`keywords`), then by the topic again without `participant`: internal meetings often
  hold the answer. Always set `from_date`; the default window is 7 days.
- Read the meetings you chose with one `tools.granola.get_meetings` call (up to 10 ids). For what someone said, use
  `tools.granola.search_transcripts` on those `meeting_ids`. For a question across them, use
  `tools.granola.query_granola_meetings` with the ids as `document_ids`.
- Call `tools.granola.get_account_info` or `tools.granola.probe` before you name the user as the owner of anything: the
  note creator may be someone else.

## 3. Stay within the meeting's own record

Build the brief from Granola's notes and transcripts and, for an upcoming meeting, its calendar event. From the
calendar, use only the event the user means; mention another only to ask whether they meant it instead. Bring in other
sources, such as mail, chat or documents, only when the user asks for them, and name them as sources. Never bring in
other people's private material: it is not the user's to brief from.

## 4. Write the brief

Use these sections, and leave out empty ones:

- **Purpose**: the meeting or question the brief serves.
- **Background**: the relationship or topic so far, in date order.
- **Decisions**: what was agreed, with the meeting and date.
- **Open questions and risks**
- **Commitments**: who owes what. Give an owner or due date only where a meeting states it; mark one that only
  Granola's summary names as "per Granola's summary".
- **Suggested agenda**: for an upcoming meeting, marked as your suggestion.
- **Sources**: each meeting used, with its title, date and note link.

Report what was said in your own words, with no quotation marks around transcript or summary text unless the user asks
for exact words. End with the scope: the window, the searches you ran, the meetings you read, and what is missing, such
as transcripts the plan does not include. If Granola has nothing relevant, say so with the searches and window instead
of inventing background. Never claim you searched every meeting.

## 5. After the brief

Offer `tools.granola.export_markdown` for the source meetings, and do not call it unless the user says yes. Do not
change Granola notes or folders unless the user asks.

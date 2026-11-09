---
name: granola-meeting-brief
description: Prep me for my next or tomorrow's meeting, brief me before my call with a person or company, catch me up on a project, or recap a period's meetings, from the user's Granola notes. Builds a sourced brief of decisions, open questions and who owes what. Load before the first Granola tool call.
---

If Granola's tools are absent, run `/connect` and choose Granola, or on Jelly call jelly_connection_request.

# Granola meeting brief

A short brief in which every claim is tied to a meeting. The `granola` skill covers the tools, quoting and citing; follow it too.

## 1. Pin down the meeting and the window

- Granola holds only past meetings; it can't see upcoming ones. For "my next meeting" or "tomorrow's call", get the event's title, time and attendees from a calendar tool if one is available, or ask the user which meeting it is. Never present a past Granola meeting as the upcoming one.
- Agree the subject and the window. With no preference, start with the last 30 days, widen when that finds nothing, and say which window you used. For a recap of a period, such as last month's meetings, that period is the window.
- When the widened searches by attendee and by topic find nothing, stop and say so instead of listing a longer period's meetings: a meeting that matches neither the people nor the topic isn't background for this brief.

## 2. Find and read

- Search Granola by the attendees (`participant`: a whole name, email, company or domain, one per call) and by the topic (`keywords`), then by the topic again without `participant`: internal meetings often hold the answer. Always set `from_date`, because the default window is 7 days.
- Read the meetings you chose with one `get_meetings` call (up to 10 IDs). For what someone said, use `search_transcripts` on those `meeting_ids`. For a question across them, use `query_granola_meetings` with the IDs as `document_ids`.
- Call `get_account_info` before you name the user as the owner of anything: the note creator may be someone else.

## 3. Stay within the meeting's own record

Build the brief from Granola's notes and transcripts and, for an upcoming meeting, its calendar event. From the calendar, use only the event the user means; mention another only to ask whether they meant it instead. Bring in other sources, such as mail, chat, documents, trackers or saved memories, only when the user asks for them, and name them as sources. Never bring in other people's private material: it isn't the user's to brief from.

## 4. Write the brief

Use these sections, and leave out empty ones:

- **Purpose**: the meeting or question the brief serves.
- **Background**: the relationship or topic so far, in date order.
- **Decisions**: what was agreed, with the meeting and date.
- **Open questions and risks**
- **Commitments**: who owes what. Give an owner or due date only where a meeting states it; mark one that only Granola's summary names as "per Granola's summary".
- **Suggested agenda**: for an upcoming meeting, marked as your suggestion.
- **Sources**: each meeting used, with its title, date and note link.

Report what was said in your own words, with no quotation marks around transcript or summary text unless the user asks for exact words. End with the scope: the window, the searches you ran, the meetings you read, and what is missing, such as transcripts the plan doesn't include. If Granola has nothing relevant, say so with the searches and window instead of inventing background. Never claim you searched every meeting.

## 5. After the brief

Offer `export_markdown` for the source meetings, and don't call it unless the user says yes. Don't change Granola notes or folders unless the user asks.

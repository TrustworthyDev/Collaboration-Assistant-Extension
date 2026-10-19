# Collaboration Assistant (Chrome extension)

Click the **To**, **Subject** or **Message** box of an email you are writing and a **Paste** button appears
inside it. Click the button and your preset text for that box is inserted. Or click **Auto Fill** in the email's
title bar to fill all three at once.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this folder.
3. Optional: pin the extension (puzzle-piece icon → pin) so its icon stays in the toolbar.

Mail tabs that are already open start working straight away; no reload needed.

## Set up

Click into the To box of any email. Until you have saved some text, the button reads **Set up**. Clicking it opens the
extension's popup with that box ready to fill in. You can also click the toolbar icon at any time.

- Fill in **To**, **Subject** and **Message**. Changes save as you type.
- A box left empty shows no button (once at least one box has text).

## Use

- Click the To box. A **Paste** button appears at its right end. Click it to insert the recipients.
- Do the same in the Subject box and the message area. In the message area the button is at the top-right corner.
- The button shows **Pasted** and hides. Click the box again to bring it back, or press **Esc** to dismiss it.

Text goes in at the cursor, just like a normal paste, so the mail app's undo (Ctrl+Z) works. Several recipients can be
separated with commas. In the To text, line breaks are turned into commas.

### Auto Fill

Every open email gets an **Auto Fill** button in its title bar, right after the title and left of the minimise /
expand / close buttons. One click fills the whole email:

- **To**: adds the email address you copied, else your recipients (see below). Recipients that are already there are not added again. If the mail app has folded the
  To row into a line of names, Auto Fill opens it first.
- **Subject**: filled when it is empty; a subject you already typed is kept.
- **Message**: your text goes at the top, above anything already there such as a signature. It is not added again
  if it is already in the message.

Auto Fill only touches the email whose button you clicked. With several emails open, one hidden behind
another (such as an earlier one still showing "Your message has been sent") shows no Auto Fill button.

So clicking Auto Fill twice does no harm. The button briefly shows **Filled**, or **Already filled** when there was
nothing left to add.

### Links in the message

Write a link in the Message text as `[title](address)`:

```text
Hi,

[Exploring a Remote Work](https://docs.google.com/document/d/…)

Please read this document first.
```

The email then shows only **Exploring a Remote Work**, as a clickable link. Only `https://`, `http://` and `mailto:`
addresses become links. In a plain-text message box, which cannot hold links, the address is kept after the title:
`Exploring a Remote Work (https://…)`.

You don't have to type this yourself: copy the text from an email (or any web page) and paste it into the extension's
Message box. Its links are turned into `[title](address)` as they are pasted, so the address is not lost.

### Copied email address

Copy the address you want to write to (from a spreadsheet, a web page, anywhere), then click **Auto Fill**. The
address goes in the To box, and Subject and Message are filled from your presets as usual.

- A copied address comes first, ahead of the Email list and the To text. Copying `Bob <bob@example.com>` works too;
  only the address is used. Several copied addresses are all added.
- Each copied address is used once. If you forget to copy the next one, the clipboard still holds the last address,
  so Auto Fill ignores it and falls back to the Email list or the To text, instead of writing to the same person again.
- Long copied text (over 1000 characters) is ignored, as it was not copied as a recipient.
- Switch it off with **To from a copied email** on the popup's Content tab, or in **More settings**.

Reading the clipboard needs the "Read data you copy and paste" permission, which Chrome asks you to accept when the
extension is installed or updated. The extension reads the clipboard only when you click Auto Fill.

### Email list

The popup has two tabs: **Content** (To, Subject, Message) and **Email list**. On the Email list tab, enter the
addresses you plan to write to, one per line (`bob@example.com` or `Bob <bob@example.com>`).

- Each Paste in a To box, and each Auto Fill, uses the **next** address and moves down the list. Every email you
  write goes to one person.
- The tab shows the next recipient and how many are used. The number on the tab is how many are left.
- **Undo last** makes the last used address the next one again, for example after discarding a draft. **Skip** passes
  over the next address, and **Start over** marks them all unused.
- Clicking Auto Fill again on the same email does not add a second address from the list.
- While the list has unused addresses it takes the place of the To text on the Content tab. When it runs out, Auto Fill
  shows **Email list finished** and To falls back to the Content tab's To text, if any.

## Where it works

It works on email compose forms on any website: Gmail, Yahoo, Outlook, Proton and other webmail. A page counts as a
compose form when it has a To box together with a Subject or message box. Look-alike boxes, such as the "To" of a
flight search or the "Subject" of a contact form, get no button. Cc and Bcc boxes never get a button.

To switch it off for a site, open the toolbar popup on that site and turn off **Active on this site**. The full list is
under **More settings**.

## If a box gets no button

Boxes are recognised by their labels (`To`, `Subject`, `Message body`, …). If your mail site labels a box differently,
open **More settings → Advanced: custom field selectors** and enter a CSS selector for it. To find one, right-click the
box → **Inspect**, then copy something stable such as its `id` or `aria-label`, e.g. `#message-to-field` or
`[aria-label="Message body"]`. A box matched by a custom selector always gets the button.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (MV3) |
| `content.js` | Detects the boxes and composers, shows the Paste and Auto Fill buttons, inserts the text |
| `background.js` | Injects into tabs already open at install; opens the popup from the "Set up" button; reads the clipboard for Auto Fill |
| `offscreen.html` / `offscreen.js` | Hidden page that reads the clipboard text for `background.js` |
| `common.js` | Settings defaults and site matching, shared by all pages |
| `popup.html` / `popup.js` | Toolbar popup: Content and Email list tabs, switch the current site on or off |
| `options.html` / `options.js` | Full settings: presets, email list, switched-off sites, custom selectors |
| `ui.js` / `ui.css` | Shared form binding and styles for popup and options |
| `icons/` | Toolbar icons |

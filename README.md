# Outreach Email Automator

Chrome extension that copies email sequences from a Google Doc into an Outreach
sequence.

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this folder.

## How to use

1. Open the Outreach sequence's steps in one tab.
2. Open the Google Doc with your sequence of emails in another tab.
3. On the Google Doc tab, click the extension icon, choose a sequence, and click **Run Sequence**.
4. The extension switches to the Outreach tab and fills in each step's subject and body.

Google Doc format:

```
Example Outreach Sequence

Step 1 (email)
Subject: Quick question about your team

Hi {{first_name}},
...

Step 2 (bump)
Just following up on my last note.
```

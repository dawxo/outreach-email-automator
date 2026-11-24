import { parseSequences } from './parser.js';

const GOOGLE_DOC_TITLE_SUFFIX = ' - Google Docs';
const SUBJECT_TRUNCATION_LENGTH = 60;

let availableSequences = [];
let selectedSequenceSteps = null;

function isGoogleDocUrl(urlString) {
  const parsedUrl = new URL(urlString);
  return (
    parsedUrl.hostname === 'docs.google.com' &&
    parsedUrl.pathname.startsWith('/document/d/')
  );
}

// extracts the document id from the path: /document/d/{documentId}/edit
function extractDocumentId(urlString) {
  const parsedUrl = new URL(urlString);
  return parsedUrl.pathname.split('/')[3];
}

function extractDocumentName(tabTitle) {
  if (tabTitle.endsWith(GOOGLE_DOC_TITLE_SUFFIX)) {
    return tabTitle.slice(0, -GOOGLE_DOC_TITLE_SUFFIX.length);
  }
  return tabTitle;
}

function renderDocDetection(detectedDocumentName) {
  const noneMessageElement = document.getElementById('doc-none-message');
  const detectedNameElement = document.getElementById('doc-detected-name');

  if (detectedDocumentName) {
    noneMessageElement.hidden = true;
    detectedNameElement.textContent = detectedDocumentName;
    detectedNameElement.hidden = false;
  } else {
    noneMessageElement.hidden = false;
    detectedNameElement.hidden = true;
  }
}

// shows a status message (loading or error) or null to clear it
function renderStatus(message) {
  const statusElement = document.getElementById('status-message');
  if (message) {
    statusElement.textContent = message;
    statusElement.hidden = false;
  } else {
    statusElement.hidden = true;
  }
}

function truncateSubjectLine(subject, maxLength) {
  if (subject.length <= maxLength) return subject;
  return subject.slice(0, maxLength) + '...';
}

function renderSequenceDropdown(sequences) {
  const sequenceSectionElement = document.getElementById('sequence-section');
  const dropdownElement = document.getElementById('sequence-dropdown');

  availableSequences = sequences;

  // remove any previously populated options, keeping the placeholder at index 0
  while (dropdownElement.options.length > 1) {
    dropdownElement.remove(1);
  }

  for (const sequence of sequences) {
    const optionElement = document.createElement('option');
    optionElement.value = sequence.sequenceName;
    optionElement.textContent = sequence.sequenceName;
    dropdownElement.appendChild(optionElement);
  }

  sequenceSectionElement.hidden = false;
  document.getElementById('emails-preview').hidden = false;
}

function renderEmailsPreview(steps) {
  const placeholderMessageElement = document.getElementById('emails-placeholder-message');
  const emptyMessageElement = document.getElementById('emails-empty-message');
  const stepsListElement = document.getElementById('steps-list');

  stepsListElement.innerHTML = '';
  placeholderMessageElement.hidden = true;
  emptyMessageElement.hidden = true;

  if (steps === null) {
    placeholderMessageElement.hidden = false;
    return;
  }

  if (steps.length === 0) {
    emptyMessageElement.hidden = false;
    return;
  }

  for (const step of steps) {
    const typeLabel = step.type === 'email' ? 'Email' : 'Bump';
    const subjectSuffix = step.subject
      ? ` · ${truncateSubjectLine(step.subject, SUBJECT_TRUNCATION_LENGTH)}`
      : '';
    const listItem = document.createElement('li');
    listItem.textContent = `Step ${step.stepNumber} · ${typeLabel}${subjectSuffix}`;
    stepsListElement.appendChild(listItem);
  }
}

function renderRunSequenceButton(isEnabled) {
  document.getElementById('run-sequence-button').disabled = !isEnabled;
}

// The manifest only injects content scripts when a page loads, so an Outreach tab
// that was already open when the extension was installed or reloaded has none.
// Both scripts guard against initializing twice, so injecting again is harmless.
async function ensureContentScriptsInjected(tabId) {
  await Promise.all([
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content_outreach.js'],
    }),
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['slate_injector.js'],
      world: 'MAIN',
    }),
  ]);
}

async function findOutreachTab() {
  const matchingTabs = await chrome.tabs.query({ url: 'https://web.outreach.io/*' });
  return matchingTabs[0] ?? null;
}

async function switchToTab(tab) {
  await Promise.all([
    chrome.windows.update(tab.windowId, { focused: true }),
    chrome.tabs.update(tab.id, { active: true }),
  ]);
}

// sends the selected steps to the Outreach tab and switches to it
function setupRunSequenceButtonListener() {
  const runSequenceButtonElement = document.getElementById('run-sequence-button');

  runSequenceButtonElement.addEventListener('click', async () => {
    renderRunSequenceButton(false);
    renderStatus(null);

    try {
      const outreachTab = await findOutreachTab();

      if (!outreachTab) {
        renderStatus('Error: No Outreach tab found. Open web.outreach.io first.');
        renderRunSequenceButton(true);
        return;
      }

      await ensureContentScriptsInjected(outreachTab.id);
      await chrome.tabs.sendMessage(outreachTab.id, {
        type: 'RUN_SEQUENCE',
        steps: selectedSequenceSteps,
      });
      await switchToTab(outreachTab);
    } catch (error) {
      renderStatus(`Error: ${error.message}`);
      renderRunSequenceButton(true);
    }
  });
}

function setupSequenceDropdownListener() {
  const dropdownElement = document.getElementById('sequence-dropdown');

  dropdownElement.addEventListener('change', (event) => {
    const selectedSequenceName = event.target.value;

    if (!selectedSequenceName) {
      selectedSequenceSteps = null;
      renderEmailsPreview(null);
      renderRunSequenceButton(false);
      return;
    }

    const matchingSequence = availableSequences.find(
      (sequence) => sequence.sequenceName === selectedSequenceName
    );

    selectedSequenceSteps = matchingSequence.steps;
    renderEmailsPreview(selectedSequenceSteps);
    renderRunSequenceButton(true);
  });
}

async function fetchDocumentText(documentId) {
  const exportUrl = `https://docs.google.com/document/d/${documentId}/export?format=txt`;
  const response = await fetch(exportUrl);

  if (!response.ok) {
    throw new Error(`Could not fetch document (${response.status}). Make sure the doc is shared with "Anyone with the link".`);
  }

  return response.text();
}

async function detectActiveGoogleDoc() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab?.url || !isGoogleDocUrl(activeTab.url)) {
    renderDocDetection(null);
    return;
  }

  renderDocDetection(extractDocumentName(activeTab.title));
  renderStatus('Loading sequences...');

  try {
    const documentId = extractDocumentId(activeTab.url);
    const plainText = await fetchDocumentText(documentId);
    const sequences = parseSequences(plainText);

    if (sequences.length === 0) {
      renderStatus('No sequences found in this document.');
      return;
    }

    renderStatus(null);
    renderSequenceDropdown(sequences);
  } catch (error) {
    renderStatus(`Error: ${error.message}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupSequenceDropdownListener();
  setupRunSequenceButtonListener();
  detectActiveGoogleDoc();
});

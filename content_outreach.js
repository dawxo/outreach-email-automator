// The editor doesn't appear instantly after switching tabs, so wait for it to render
const TAB_SWITCH_DELAY_MS = 400;

// Maximum wait for the Slate injector to respond before giving up
const SLATE_INJECTOR_RESPONSE_TIMEOUT_MS = 3000;

// Tags our window.postMessage traffic so other messages on the page are ignored
const MESSAGE_TYPE_COMMAND = 'SLATE_INJECTOR_CMD';
const MESSAGE_TYPE_RESPONSE = 'SLATE_INJECTOR_RSP';

// Targets the visible step panel, never the hidden inactive ones
const ACTIVE_SLATE_EDITOR_SELECTOR =
  'div[role="tabpanel"]:not([hidden]) div[data-slate-editor="true"]';

// Matches each response to its command when several are in flight
let nextRequestId = 1;

// Content scripts run in an isolated world but the Slate injector runs in the
// page's main world, so the two talk through window.postMessage
function sendSlateInjectorCommand(command, commandArguments) {
  const requestId = nextRequestId++;

  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      window.removeEventListener('message', responseHandler);
      reject(new Error('Slate injector did not respond in time'));
    }, SLATE_INJECTOR_RESPONSE_TIMEOUT_MS);

    function responseHandler(event) {
      if (event.source !== window) return;
      if (event.data?.type !== MESSAGE_TYPE_RESPONSE) return;
      if (event.data.requestId !== requestId) return;

      clearTimeout(timeoutHandle);
      window.removeEventListener('message', responseHandler);

      if (event.data.success) {
        resolve(event.data);
      } else {
        reject(new Error(event.data.error || 'Unknown Slate injector error'));
      }
    }

    window.addEventListener('message', responseHandler);
    window.postMessage(
      { type: MESSAGE_TYPE_COMMAND, command, requestId, ...commandArguments },
      '*'
    );
  });
}

async function setSlateEditorContent(textContent) {
  await sendSlateInjectorCommand('REPLACE_EDITOR_CONTENT', {
    editorSelector: ACTIVE_SLATE_EDITOR_SELECTOR,
    textContent,
  });
}

// React ignores a plain `input.value = x` assignment, so call the native
// setter directly and fire an input event that React will pick up
function setReactInputValue(inputElement, value) {
  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  ).set;
  nativeValueSetter.call(inputElement, value);
  inputElement.dispatchEvent(new Event('input', { bubbles: true }));
}

function findStepTabButton(stepNumber) {
  const tabButtons = document.querySelectorAll('button[role="tab"]');
  return (
    Array.from(tabButtons).find(
      (button) => button.textContent.trim() === `Step ${stepNumber}`
    ) ?? null
  );
}

// Outreach names each subject field by its zero-based step index
function findSubjectInputForStep(stepIndex) {
  return document.querySelector(
    `input[name="steps[${stepIndex}].stepOverride.template.subject"]`
  );
}

function findActiveStepBodyEditor() {
  return document.querySelector(ACTIVE_SLATE_EDITOR_SELECTOR);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Clicks the step's tab, waits for it to render, then fills subject and body
async function fillSequenceStep(step) {
  const stepIndex = step.stepNumber - 1;

  const tabButton = findStepTabButton(step.stepNumber);
  if (!tabButton) {
    throw new Error(`Step ${step.stepNumber} tab not found on the page`);
  }
  tabButton.click();

  await delay(TAB_SWITCH_DELAY_MS);

  if (step.type === 'email' && step.subject) {
    const subjectInput = findSubjectInputForStep(stepIndex);
    if (!subjectInput) {
      throw new Error(`Subject input for step ${step.stepNumber} not found`);
    }
    setReactInputValue(subjectInput, step.subject);
  }

  if (!findActiveStepBodyEditor()) {
    throw new Error(`Body editor for step ${step.stepNumber} not found`);
  }
  await setSlateEditorContent(step.body);
}

async function runSequenceSteps(steps) {
  for (const step of steps) {
    await fillSequenceStep(step);
  }
}

// The popup may inject this script into a tab that already has it, so register
// the listener only once; otherwise each RUN_SEQUENCE would run the steps twice
if (!window.__outreachAutomatorLoaded) {
  window.__outreachAutomatorLoaded = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'RUN_SEQUENCE') return false;

    runSequenceSteps(message.steps).catch((error) => {
      console.error('Outreach sequence automation failed:', error);
    });

    sendResponse({ received: true });
    return false;
  });
}

function isSequenceHeader(line) {
  return line.length > 0 && line.endsWith('Sequence');
}

const STEP_HEADER_PATTERN = /^Step (\d+) \((email|bump)\)$/;

// reads a "Step 2 (email)" or "Step 3 (bump)" line into { stepNumber, type }, or null if it is not a step header
function parseStepHeader(line) {
  const match = line.match(STEP_HEADER_PATTERN);
  if (!match) return null;
  return { stepNumber: Number(match[1]), type: match[2] };
}

// orders steps by their number in the doc, then renumbers them 1..N so gaps in the doc's numbering are closed
function buildSequenceSteps(rawSteps) {
  return [...rawSteps]
    .sort((stepA, stepB) => stepA.stepNumber - stepB.stepNumber)
    .map((step, stepIndex) => ({
      stepNumber: stepIndex + 1,
      type: step.type,
      subject: step.subject,
      body: step.bodyLines.join('\n').trim(),
    }));
}

// parses raw text from a google doc and builds an array of sequence objects
function parseSequences(rawText) {
  // splits on any line ending style (windows \r\n, old mac \r, unix \n)
  const lines = rawText.split(/\r\n|\r|\n/);

  const sequences = [];
  let currentSequenceName = null;
  let currentRawSteps = [];
  let currentStep = null;

  // commits the open step to the current sequence's step list and resets it
  function finalizeCurrentStep() {
    if (currentStep === null) return;
    currentRawSteps.push(currentStep);
    currentStep = null;
  }

  // commits the open sequence (including its open step) to the output and resets state
  function finalizeCurrentSequence() {
    if (currentSequenceName === null) return;
    finalizeCurrentStep();
    sequences.push({
      sequenceName: currentSequenceName,
      steps: buildSequenceSteps(currentRawSteps),
    });
    currentSequenceName = null;
    currentRawSteps = [];
  }

  // process each line, detecting headers and getting body content into the open step
  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();

    if (isSequenceHeader(trimmedLine)) {
      finalizeCurrentSequence();
      currentSequenceName = trimmedLine;
      continue;
    }

    const stepHeader = parseStepHeader(trimmedLine);
    if (stepHeader !== null) {
      finalizeCurrentStep();
      currentStep = { type: stepHeader.type, stepNumber: stepHeader.stepNumber, subject: '', bodyLines: [] };
      continue;
    }

    // ignore lines that appear before the first step header in a sequence
    if (currentStep === null) continue;

    // capture the subject from the first "Subject:" line in an email step
    if (currentStep.type === 'email' && !currentStep.subject && trimmedLine.startsWith('Subject:')) {
      currentStep.subject = trimmedLine.slice('Subject:'.length).trim();
      continue;
    }

    // skip leading blank lines and include internal blank lines once body has started
    if (trimmedLine.length > 0 || currentStep.bodyLines.length > 0) {
      currentStep.bodyLines.push(rawLine);
    }
  }

  finalizeCurrentSequence();

  return sequences;
}

export { parseSequences };

// Runs in the page's main world so it can reach React internals that the
// isolated-world content script cannot. Guarded so it only initializes once.
if (!window.__slateInjectorInitialized) {
  window.__slateInjectorInitialized = true;

  // Tags our window.postMessage traffic so other messages on the page are ignored
  const MESSAGE_TYPE_COMMAND = 'SLATE_INJECTOR_CMD';
  const MESSAGE_TYPE_RESPONSE = 'SLATE_INJECTOR_RSP';

  // Recognizes a Slate editor object by its shape
  function isSlateEditorInstance(candidate) {
    return (
      candidate !== null &&
      typeof candidate === 'object' &&
      Array.isArray(candidate.children) &&
      typeof candidate.isVoid === 'function' &&
      typeof candidate.isInline === 'function'
    );
  }

  // Different Slate versions and wrappers pass the editor under different prop names
  function findSlateEditorInProps(fiberProps) {
    if (!fiberProps) return null;
    if (isSlateEditorInstance(fiberProps.editor)) return fiberProps.editor;
    if (isSlateEditorInstance(fiberProps.value)) return fiberProps.value;
    if (Array.isArray(fiberProps.value) && isSlateEditorInstance(fiberProps.value[0])) {
      return fiberProps.value[0];
    }
    return null;
  }

  // Checks each hook of a function component (useState, useRef, useMemo, ...)
  function findSlateEditorInHooks(firstHook) {
    for (let hook = firstHook; hook != null; hook = hook.next) {
      const hookValue = hook.memoizedState;
      if (isSlateEditorInstance(hookValue)) return hookValue;
      if (Array.isArray(hookValue) && isSlateEditorInstance(hookValue[0])) return hookValue[0];
      if (isSlateEditorInstance(hookValue?.current)) return hookValue.current;
      if (isSlateEditorInstance(hook.queue?.lastRenderedState)) return hook.queue.lastRenderedState;
    }
    return null;
  }

  // The Slate editor object lives in React state, not the DOM, so walk up the
  // React fiber tree from the editor's DOM element until one is found
  function findSlateEditorFromElement(domElement) {
    const reactFiberKey = Object.keys(domElement).find(
      (key) =>
        key.startsWith('__reactFiber$') ||
        key.startsWith('__reactInternalInstance$')
    );
    if (!reactFiberKey) return null;

    for (let fiber = domElement[reactFiberKey]; fiber !== null; fiber = fiber.return) {
      const editorFromProps = findSlateEditorInProps(fiber.memoizedProps);
      if (editorFromProps) return editorFromProps;

      const editorFromHooks = findSlateEditorInHooks(fiber.memoizedState);
      if (editorFromHooks) return editorFromHooks;

      if (isSlateEditorInstance(fiber.stateNode?.editor)) return fiber.stateNode.editor;
    }
    return null;
  }

  // Clears the editor and inserts one paragraph per line of textContent
  function replaceSlateEditorContent(slateEditor, textContent) {
    const normalizedText = textContent.replace(/\n{3,}/g, '\n\n');
    const paragraphType = slateEditor.children[0]?.type ?? 'paragraph';

    const newParagraphNodes = normalizedText.split('\n').map((lineText) => ({
      type: paragraphType,
      children: [{ text: lineText }],
    }));

    // Remove from the end so earlier indexes stay valid
    for (let nodeIndex = slateEditor.children.length - 1; nodeIndex >= 0; nodeIndex--) {
      slateEditor.apply({
        type: 'remove_node',
        path: [nodeIndex],
        node: slateEditor.children[nodeIndex],
      });
    }

    newParagraphNodes.forEach((paragraphNode, nodeIndex) => {
      slateEditor.apply({
        type: 'insert_node',
        path: [nodeIndex],
        node: paragraphNode,
      });
    });

    // Place the cursor at the end of the last paragraph
    const lastNodeIndex = newParagraphNodes.length - 1;
    const lastTextLength = newParagraphNodes[lastNodeIndex].children[0].text.length;
    const endOfText = { path: [lastNodeIndex, 0], offset: lastTextLength };
    slateEditor.apply({
      type: 'set_selection',
      properties: slateEditor.selection,
      newProperties: { anchor: endOfText, focus: endOfText },
    });
  }

  // Replies to the content script, echoing the requestId of the command
  function postResponse(requestId, success, errorMessage) {
    window.postMessage(
      { type: MESSAGE_TYPE_RESPONSE, requestId, success, error: errorMessage },
      '*'
    );
  }

  function handleReplaceEditorContent({ requestId, editorSelector, textContent }) {
    try {
      const editorElement = document.querySelector(editorSelector);
      if (!editorElement) {
        postResponse(requestId, false, 'Slate editor element not found in DOM');
        return;
      }

      editorElement.focus();

      const slateEditor = findSlateEditorFromElement(editorElement);
      if (!slateEditor) {
        postResponse(requestId, false, 'Could not find Slate editor instance via React fiber traversal');
        return;
      }

      replaceSlateEditorContent(slateEditor, textContent);
      postResponse(requestId, true, null);
    } catch (error) {
      postResponse(requestId, false, error.message);
    }
  }

  window.addEventListener('message', (event) => {
    // Only accept messages from this same window, not iframes or other windows
    if (event.source !== window) return;
    if (event.data?.type !== MESSAGE_TYPE_COMMAND) return;

    if (event.data.command === 'REPLACE_EDITOR_CONTENT') {
      handleReplaceEditorContent(event.data);
    }
  });
}

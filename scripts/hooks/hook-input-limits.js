'use strict';

const REGISTERED_HOOK_MAX_STDIN_BYTES = 1024 * 1024;
const MAX_CONTEXT_TOKEN_CHARS = 256;

function decodeJsonString(raw) {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return '';
  }
}

function createHookContextScanner() {
  const context = { hookEventName: '', toolName: '', stopHookActive: null };
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringRole = '';
  let stringBuffer = '';
  let currentKey = '';
  let state = 'root';
  let primitive = '';

  const commitPrimitive = () => {
    if (currentKey === 'stop_hook_active') {
      if (primitive === 'true') context.stopHookActive = true;
      else if (primitive === 'false') context.stopHookActive = false;
    }
    primitive = '';
  };

  const push = chunk => {
    for (const char of String(chunk || '')) {
      if (inString) {
        if (escaped) {
          if (stringRole && stringBuffer.length < MAX_CONTEXT_TOKEN_CHARS) {
            stringBuffer += `\\${char}`;
          }
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          const value = decodeJsonString(stringBuffer);
          if (stringRole === 'key') {
            currentKey = value;
            state = 'colon';
          } else if (stringRole === 'value') {
            if (currentKey === 'hook_event_name') context.hookEventName = value;
            else if (currentKey === 'tool_name') context.toolName = value;
            state = 'afterValue';
          }
          inString = false;
          stringRole = '';
          stringBuffer = '';
          continue;
        }
        if (stringRole && stringBuffer.length < MAX_CONTEXT_TOKEN_CHARS) stringBuffer += char;
        continue;
      }

      if (char === '"') {
        inString = true;
        stringRole = depth === 1 && state === 'key'
          ? 'key'
          : depth === 1 && state === 'value'
            && (currentKey === 'hook_event_name' || currentKey === 'tool_name')
            ? 'value'
            : '';
        stringBuffer = '';
        continue;
      }
      if (char === '{' || char === '[') {
        depth += 1;
        if (depth === 1) state = 'key';
        continue;
      }
      if (char === '}' || char === ']') {
        if (depth === 1 && primitive) commitPrimitive();
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth !== 1 || /\s/.test(char)) continue;
      if (state === 'colon' && char === ':') {
        state = 'value';
        primitive = '';
        continue;
      }
      if ((state === 'value' || state === 'afterValue') && char === ',') {
        if (state === 'value') commitPrimitive();
        currentKey = '';
        state = 'key';
        continue;
      }
      if (state === 'value' && currentKey === 'stop_hook_active' && primitive.length < 5) {
        primitive += char;
      }
    }
  };

  return { context, push };
}

module.exports = {
  REGISTERED_HOOK_MAX_STDIN_BYTES,
  createHookContextScanner,
};

import { INJECTED_MSG_KEY } from '@/lib/messaging/protocol';

export default defineContentScript({
  matches: ['*://discord.com/*', '*://*.discord.com/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    let lastToken: string | null = null;

    function emit(token: string) {
      if (token && token !== lastToken) {
        lastToken = token;
        window.postMessage({ key: INJECTED_MSG_KEY, token }, '*');
      }
    }

    function extractToken(name: string, value: string) {
      if (name.toLowerCase() === 'authorization' && value && !value.startsWith('Bot ')) {
        emit(value);
      }
    }

    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
      extractToken(name, value);
      return origSetHeader.call(this, name, value);
    };

    const origFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      try {
        const headers = init?.headers;
        if (headers) {
          if (headers instanceof Headers) {
            const auth = headers.get('authorization');
            if (auth) extractToken('authorization', auth);
          } else if (Array.isArray(headers)) {
            for (const [k, v] of headers) {
              extractToken(k, v);
            }
          } else {
            for (const [k, v] of Object.entries(headers)) {
              if (v) extractToken(k, v);
            }
          }
        }
      } catch {
        // never break the page
      }
      return origFetch.call(this, input, init);
    };
  },
});

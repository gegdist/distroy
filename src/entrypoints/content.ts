import { INJECTED_MSG_KEY, MsgType } from '@/lib/messaging/protocol';

export default defineContentScript({
  matches: ['*://discord.com/*', '*://*.discord.com/*'],
  runAt: 'document_start',

  main() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data?.key !== INJECTED_MSG_KEY) return;

      const token: string = event.data.token;
      if (!token) return;

      browser.runtime.sendMessage({ type: MsgType.TokenCaptured, token }).catch(() => {
        // background not ready yet — will capture on next request
      });
    });
  },
});

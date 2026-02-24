type MessageKey = Parameters<typeof browser.i18n.getMessage>[0];

export function t(key: MessageKey, substitutions?: string | string[]): string {
  return browser.i18n.getMessage(key, substitutions) || key;
}

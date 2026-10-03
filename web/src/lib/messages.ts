import en from '../../messages/en.json';

export type MessageKey = keyof typeof en;
type Params = Record<string, string | number>;

export function m(key: MessageKey, params: Params = {}): string {
	return en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

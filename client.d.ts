import { Signal, Writable } from 'easy-signal';
export interface Client {
    deviceId: string;
    online: boolean;
    connected: boolean;
    authed: boolean;
    serverTimeOffset: number;
    serverVersion: string;
}
export type Unsubscribe = () => void;
export interface ClientAPI<T = {}> {
    connect(): Promise<void>;
    disconnect(): void;
    close(): void;
    ping(): Promise<void>;
    api: T;
    state: Writable<Client>;
    send<T = any>(action: string, ...args: [...any[], AbortSignal, GenericFunction]): Promise<T>;
    send<T = any>(action: string, ...args: [...any[], GenericFunction]): Promise<T>;
    send<T = any>(action: string, ...args: any[]): Promise<T>;
    sendAfterAuthed<T = any>(action: string, ...args: [...any[], AbortSignal, GenericFunction]): Promise<T>;
    sendAfterAuthed<T = any>(action: string, ...args: [...any[], GenericFunction]): Promise<T>;
    sendAfterAuthed<T = any>(action: string, ...args: any[]): Promise<T>;
    onMessage: Signal;
    auth(idToken?: string): Promise<string>;
    pause(pause?: boolean): void;
    getNow(): number;
    getDate(): Date;
    onOpen: Signal<(options: {
        waitUntil(promise: Promise<any>): void;
    }) => void>;
    onClose: Signal<() => void>;
    onError: Signal<(error: Error) => void>;
}
export default function createClient<T = {}>(url: string, deviceId?: string, serverTimeOffset?: number): ClientAPI<T>;
type GenericFunction = (...args: any[]) => any;
export {};

import { EventSignal } from 'easy-signal/eventSignal';
export interface Client {
    deviceId: string;
    online: boolean;
    connected: boolean;
    authed: boolean;
    serverTimeOffset: number;
    serverVersion: string;
}
export declare type Unsubscribe = () => void;
export interface ClientAPI<T = {}> {
    connect(): Promise<void>;
    disconnect(): void;
    close(): void;
    api: T;
    send<T = any>(action: string, ...args: [...any[], AbortSignal, GenericFunction]): Promise<T>;
    send<T = any>(action: string, ...args: [...any[], GenericFunction]): Promise<T>;
    send<T = any>(action: string, ...args: any[]): Promise<T>;
    sendAfterAuthed<T = any>(action: string, ...args: [...any[], AbortSignal, GenericFunction]): Promise<T>;
    sendAfterAuthed<T = any>(action: string, ...args: [...any[], GenericFunction]): Promise<T>;
    sendAfterAuthed<T = any>(action: string, ...args: any[]): Promise<T>;
    onMessage: EventSignal;
    auth(idToken?: string): Promise<string>;
    pause(pause?: boolean): void;
    getNow(): number;
    getDate(): Date;
    get(): Client;
    subscribe(subscriber: (data: Client) => void): Unsubscribe;
    onOpen: EventSignal<(options: {
        waitUntil(promise: Promise<any>): void;
    }) => void>;
    onClose: EventSignal<() => void>;
    onError: EventSignal<(error: Error) => void>;
}
export default function createClient<T = {}>(url: string): ClientAPI<T>;
declare type GenericFunction = (...args: any[]) => any;
export {};

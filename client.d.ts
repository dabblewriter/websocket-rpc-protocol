import { Signal } from 'easy-signal';
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
    send(action: string, ...rest: any[]): Promise<any>;
    sendAfterAuthed(action: string, ...rest: any[]): Promise<any>;
    sendAndListen<T extends GenericFunction>(action: string, ...args: [...any, T]): Promise<Unsubscribe>;
    listen<T extends GenericFunction>(listener: T): Unsubscribe;
    auth(idToken?: string): Promise<string>;
    pause(pause?: boolean): void;
    getNow(): number;
    getDate(): Date;
    get(): Client;
    subscribe(listener: (data: Client) => any): Unsubscribe;
    onChange: Signal<(data: Client) => any>;
    onOpen: Signal<(options: {
        waitUntil(promise: Promise<any>): void;
    }) => any>;
    onClose: Signal<() => any>;
    onError: Signal<() => any>;
}
export default function createClient<T = {}>(url: string): ClientAPI<T> & T;
declare type GenericFunction = (...args: any[]) => any;
export {};

import { Signal } from 'easy-signal';
export interface Client {
    online: boolean;
    connected: boolean;
    authed: boolean;
    serverTimeOffset: number;
}
export declare type Unsubscribe = () => void;
export interface ClientAPI {
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
}
export interface ClientAPIMethods {
    [key: string]: (...args: any[]) => Promise<any>;
}
export default function createClient<T extends ClientAPIMethods = ClientAPIMethods>(url: string, appVersion: string): ClientAPI & T;
declare type GenericFunction = (...args: any[]) => any;
export {};

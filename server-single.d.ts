export declare type APIMethod = (...args: any[]) => any;
export declare type API = {
    [key: string]: APIMethod | API;
};
export declare type APIFactory = (socket: ServerAPI) => API | Promise<API>;
export interface ServerAPI {
    onConnect: (socket: WebSocket) => void;
    onMessage: (socket: WebSocket, event: MessageEvent) => void;
    send: (socket: WebSocket, data: any) => void;
    push: (socket: WebSocket, data: any, forRequest?: number) => void;
}
export default function createServer(version: string, apiFactory: APIFactory): Promise<{
    send: (socket: WebSocket, data: any) => void;
    push: (socket: WebSocket, data: any, forRequest?: number) => void;
    onConnect: (socket: WebSocket) => void;
    onMessage: (socket: WebSocket, event: MessageEvent) => Promise<void>;
}>;

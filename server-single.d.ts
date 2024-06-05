export type APIMethod = (ws: WebSocket, ...args: any[]) => any;
export interface API {
    [key: string]: APIMethod | API;
}
export interface ServerAPI {
    onConnect: (socket: WebSocket) => void;
    onMessage: (socket: WebSocket, event: MessageEvent) => void;
    send: (socket: WebSocket, data: any) => void;
    push: (socket: WebSocket, data: any, forRequest?: number) => void;
}
export default function createServer(version: string, api: API): ServerAPI;

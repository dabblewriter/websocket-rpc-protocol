export declare type APIMethod = (...args: any[]) => any;
export declare type API = {
    [key: string]: APIMethod | API;
};
export declare type APIFactory = (socket: ServerAPI) => API | Promise<API>;
export interface ServerAPI {
    send: (data: any) => void;
    push: (data: any, forRequest?: number) => void;
    close: () => void;
}
export default function createServer(socket: WebSocket, version: string, apiFactory: APIFactory): Promise<{
    send: (data: any) => void;
    push: (data: any, forRequest?: number) => void;
    close: () => void;
}>;

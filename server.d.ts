export declare type APIMethod = (...args: any[]) => any;
export declare type API = {
    [key: string]: APIMethod | API;
};
export declare type APIFactory = (socket: ReturnType<typeof createServer>) => API;
export default function createServer(socket: WebSocket, apiFactory: APIFactory): {
    send: (data: any) => void;
    push: (data: any, forRequest?: number) => void;
    close: () => void;
};

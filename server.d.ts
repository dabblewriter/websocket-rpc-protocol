export declare type APIMethod = (...args: any[]) => any;
export declare type API = {
    version: number;
} & {
    [key: string]: APIMethod | API;
};
export declare type APIFactory = (socket: ReturnType<typeof createServer>) => API;
export default function createServer(socket: WebSocket, apiFactory: APIFactory): {
    push: (data: any, forRequest?: number) => void;
    close: () => void;
};

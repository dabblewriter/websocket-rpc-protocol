import { Signal, Unsubscriber } from 'easy-signal';

export type APIMethod = (...args: any[]) => any;
export type API = {[key: string]: APIMethod | API};
export type APIFactory = (socket: ServerAPI) => API | Promise<API>;

export interface ServerAPI {
  onConnect: (socket: WebSocket) => void;
  onMessage: (socket: WebSocket, event: MessageEvent) => void;
  send: (socket: WebSocket, data: any) => void;
  push: (socket: WebSocket, data: any, forRequest?: number) => void;
}

// Exposes an API to a websocket endpoint using the protocol described in PROTOCOL.md
export default async function createServer(version: string, apiFactory: APIFactory) {
  const thisApi = { send, push, onConnect, onMessage };
  let api: API;
  const streamingRequests = new Map<number, (aborted?: boolean) => boolean>();
  api = await apiFactory(thisApi);
  return thisApi;

  function onConnect(socket: WebSocket) {
    send(socket, { ts: Date.now(), v: version });
  }

  async function onMessage(socket: WebSocket, event: MessageEvent) {
    await processMessage(socket, '' + event.data);
  }

  function send(socket: WebSocket, data: any) {
    socket.send(JSON.stringify(data));
  }

  function push(socket: WebSocket, data: any, forRequest?: number) {
    send(socket, { p: forRequest || 1, d: data });
  }

  async function processMessage(socket: WebSocket, message: string) {
    if (typeof message !== 'string') {
      return send(socket, { err: 'Incorrect message format, expecting valid JSON' });
    }
    let data: any;

    try {
      data = JSON.parse(message);
    } catch (err) {
      return send(socket, { err: 'Incorrect JSON format' });
    }

    if (!data || typeof data.a !== 'string' || typeof data.r !== 'number' || (data.d && !Array.isArray(data.d))) {
      return send(socket, { err: 'Invalid message protocol' });
    }

    const { a, r, d = [] } = data as { a: string, r: number, d?: any[] };

    const path = a.split('.');
    const method = path.pop() as string;
    let namespace: API = api;
    path.forEach(name => namespace = namespace && (namespace as any)[name]);
    const apiFunction = namespace?.[method] as APIMethod;

    function sendError(err: Error | string) {
      const message = typeof err === 'string' ? err : err.message;
      return send(socket, { r, err: message });
    }

    if (a === '_abort') {
      const otherR = d[0];
      const success = streamingRequests.get(otherR)?.(true) || false;
      if (success) send(socket, { r: otherR });
      return send(socket, { r, d: success });
    }

    if (a[0] === '_' || typeof apiFunction !== 'function') {
      return sendError('Unknown action');
    }

    try {
      const result = await apiFunction(...d);
      if (typeof result === 'function' && typeof result.dispatch === 'function') {
        // result is a signal with the library easy-signal, used to stream multiple results over time. To end the pusedo
        // stream, send an undefined result at the end. An optional error signal attached will allow for an error to end
        // the stream.
        const signal = result as Signal;
        const unsubscribers: Unsubscriber[] = [];
        unsubscribers.push(signal((d: any) => {
          if (d === undefined) {
            unsubscribe();
            send(socket, { r });
          } else {
            send(socket, { r, s: 1, d });
          }
        }));
        const { error, abort } = signal as any as {error: Signal, abort: Signal};
        if (typeof error === 'function' && typeof error.dispatch === 'function') {
          unsubscribers.push(error((err: Error) => {
            sendError(err);
            unsubscribe();
          }));
        }
        const unsubscribe = (aborted?: boolean) => {
          if (!streamingRequests.delete(r)) return false;
          if (aborted && abort) abort.dispatch();
          unsubscribers.forEach(u => u());
          return true;
        };
        streamingRequests.set(r, unsubscribe);
      } else {
        send(socket, { r, d: result });
      }
    } catch (err: any) {
      sendError(err);
    }
  }
}

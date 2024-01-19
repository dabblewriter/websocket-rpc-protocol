import { EventSignal, ForErrors, Unsubscriber } from 'easy-signal';

export type APIMethod = (...args: any[]) => any;
export type API = {[key: string]: APIMethod | API};
export type APIFactory = (socket: ServerAPI) => API | Promise<API>;

export interface ServerAPI {
  send: (data: any) => void;
  push: (data: any, forRequest?: number) => void;
  close: () => void;
}

// Exposes an API to a websocket endpoint using the protocol described in PROTOCOL.md
// Use server to handle 1 API per socket for state, use server-single if one server can handle multiple sockets
export default async function createServer(socket: WebSocket, version: string, apiFactory: APIFactory) {
  const thisApi = { send, push, close };
  let api: API;
  let preMessages: string[] = [];
  const streamingRequests = new Map<number, (aborted?: boolean) => boolean>();

  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', close);

  try {
    api = await apiFactory(thisApi);
    send({ ts: Date.now(), v: version });
    preMessages.forEach(processMessage);
    preMessages = null;
  } catch (err) {
    console.error(err);
    send({ err: err.message });
    close();
  }

  return thisApi;

  function send(data: any) {
    socket.send(JSON.stringify(data));
  }

  function push(data: any, forRequest?: number) {
    send({ p: forRequest || 1, d: data });
  }

  function close() {
    socket.removeEventListener('message', onMessage);
    socket.removeEventListener('close', close);
    try {
      socket.close();
    } catch(err) {}
  }

  function onMessage(event: MessageEvent) {
    api ? processMessage('' + event.data) : preMessages.push('' + event.data);
  }

  async function processMessage(message: string) {
    if (typeof message !== 'string') {
      return send({ err: 'Incorrect message format, expecting valid JSON' });
    }
    let data: any;

    try {
      data = JSON.parse(message);
    } catch (err) {
      return send({ err: 'Incorrect JSON format' });
    }

    if (!data || typeof data.a !== 'string' || typeof data.r !== 'number' || (data.d && !Array.isArray(data.d))) {
      return send({ err: 'Invalid message protocol' });
    }

    const { a, r, d = [] } = data as { a: string, r: number, d?: any[] };

    const path = a.split('.');
    const method = path.pop() as string;
    let namespace: API = api;
    path.forEach(name => namespace = namespace && (namespace as any)[name]);
    const apiFunction = namespace?.[method] as APIMethod;

    function sendError(err: Error | string) {
      const message = typeof err === 'string' ? err : err.message;
      return send({ r, err: message });
    }

    if (a === '_abort') {
      const otherR = d[0];
      const success = streamingRequests.get(otherR)?.(true) || false;
      if (success) send({ r: otherR });
      return send({ r, d: success });
    }

    if (a[0] === '_' || typeof apiFunction !== 'function') {
      return sendError('Unknown action');
    }

    try {
      const result = await apiFunction(...d);
      if (typeof result?.signal === 'function') {
        // result is an object with method named signal with the library easy-signal, used to stream multiple results.
        // Send an undefined result to end the stream and an error to end the stream with an error.
        const { signal, abort } = result as { signal: EventSignal, abort: EventSignal };
        const unsubscribers: Unsubscriber[] = [];
        unsubscribers.push(signal((d: any) => {
          if (d === undefined) {
            unsubscribe();
            send({ r });
          } else {
            send({ r, s: 1, d });
          }
        }));
        unsubscribers.push(signal((err: Error) => {
          sendError(err);
          unsubscribe();
        }, ForErrors));
        const unsubscribe = (aborted?: boolean) => {
          if (!streamingRequests.delete(r)) return false;
          if (aborted && abort) abort();
          unsubscribers.forEach(u => u());
          return true;
        };
        streamingRequests.set(r, unsubscribe);
      } else {
        send({ r, d: result });
      }
    } catch (err: any) {
      sendError(err);
    }
  }
}

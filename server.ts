import { Signal } from 'easy-signal';

export type APIMethod = (...args: any[]) => any;
export type API = {[key: string]: APIMethod | API};
export type APIFactory = (socket: ReturnType<typeof createServer>) => API;

// Exposes an API to a websocket endpoint using the protocol described in PROTOCOL.md
export default function createServer(socket: WebSocket, apiFactory: APIFactory) {
  const thisApi = { send, push, close };

  const api = apiFactory(thisApi);
  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', close);
  send({ ts: Date.now(), v: (api.getVersion as APIMethod)?.() });

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
  }

  function onMessage(event: MessageEvent) {
    processMessage('' + event.data);
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
        const unsubscribe = signal((d: any) => {
          if (d === undefined) {
            unsubscribe();
            send({ r });
          } else {
            send({ r, s: 1, d });
          }
        });
        const { error } = signal as any as {error: Signal};
        if (typeof error === 'function' && typeof error.dispatch === 'function') {
          const errorUnsub = error((err: Error) => {
            sendError(err);
            unsubscribe();
            errorUnsub();
          });
        }
      } else {
        send({ r, d: result });
      }
    } catch (err: any) {
      sendError(err);
    }
  }
}

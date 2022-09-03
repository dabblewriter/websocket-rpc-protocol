import { signal, Signal } from 'easy-signal';
import { createId } from 'crypto-id';

const BASE_RETRY_TIME = 1000;
const MAX_RETRY_BACKOFF = 4;
const NOOP = () => {};

export interface Client {
  deviceId: string;
  online: boolean;
  connected: boolean;
  authed: boolean;
  serverTimeOffset: number;
  serverVersion: string;
}

export type Unsubscribe = () => void;

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
  onOpen: Signal<(options: {waitUntil(promise: Promise<any>): void}) => any>;
  onClose: Signal<() => any>;
  onError: Signal<() => any>;
}

export default function createClient<T = {}>(url: string): ClientAPI<T> & T {
  const requests: {[r: string]: Request} = {};
  const afterConnectedQueue: Array<Request> = [];
  const afterAuthedQueue: Array<Request> = [];
  const onChange = signal<(client: Client) => any>();
  const deviceId = localStorage.deviceId as string || (localStorage.deviceId = createId());
  const listeners: {[r: number]: Signal} = {1: signal()};
  const onOpen = signal<(options: {waitUntil(promise: Promise<any>): void}) => any>();
  const onClose = signal<() => any>();
  const onError = signal<(error: Error) => any>();

  let socket: WebSocket;
  let shouldConnect = false;
  let requestNumber = 1;
  let online = window.navigator.onLine;
  let connected = false;
  let authed = false;
  let serverTimeOffset = parseInt(localStorage.timeOffset) || 0;
  let serverVersion = '';
  let retries = 0;
  let reconnectTimeout: any;
  let closing: any;
  let paused: boolean; // use for testing data drop and sync stability/recovery
  let data: Client = { deviceId, online, connected, authed, serverTimeOffset, serverVersion };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  function close() {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    disconnect();
  }

  function update() {
    if (online !== data.online || connected !== data.connected || authed !== data.authed || serverTimeOffset !== data.serverTimeOffset  || serverVersion !== data.serverVersion) {
      onChange.dispatch(data = { deviceId, online, connected, authed, serverTimeOffset, serverVersion });
    }
  }

  function subscribe(listener: (client: Client) => any) {
    const unsub = onChange(listener);
    listener(data);
    return unsub;
  }

  function get() {
    return data;
  }

  function connect(): Promise<void> {
    clearTimeout(reconnectTimeout);

    return new Promise((resolve, reject) => {
      shouldConnect = true;

      if (!online) {
        return reject(new Error('offline'));
      } else if (connected) {
        return;
      }

      try {
        socket = new WebSocket(url);
      } catch (err) {
        reject(err);
      }

      socket.onerror = (event: ErrorEvent) => {
        onError.dispatch(event.error);
        reject();
        closeSocket();
      };

      socket.onopen = async () => {
        const promises = [];
        const options = { waitUntil: (promise: Promise<any>) => {
          promises.push(promise);
        }};
        onOpen.dispatch(options);
        if (promises.length) await Promise.all(promises);
        if (!connected) {
          connected = true;
          update();
        }
        while (afterConnectedQueue.length) {
          const { action, args, resolve, reject } = afterConnectedQueue.shift() as Request;
          send(action, ...args).then(resolve, reject);
        }
        retries = 0;
        resolve();
      };

      socket.onclose = () => {
        clearTimeout(closing);
        closing = null;
        socket.onclose = null;
        (socket as any) = null;
        if (connected) {
          connected = false;
          authed = false;
          update();
        }
        onClose.dispatch();

        Object.keys(requests).forEach(key => {
          const request = requests[key];
          request.reject(new Error('CONNECTION_CLOSED'));
          delete requests[key];
        });

        if (shouldConnect && online) {
          const backoff = Math.round((Math.random() * (Math.pow(2, retries) - 1)) * BASE_RETRY_TIME);
          retries = Math.min(MAX_RETRY_BACKOFF, retries + 1);
          reconnectTimeout = setTimeout(() => {
            connect().catch(err => {});
          }, backoff);
        }
      };

      socket.onmessage = event => {
        if (paused) return;
        let data: any;
        try {
          data = JSON.parse(event.data);
        } catch (err) {
          console.error('Unparseable data from socket:', event.data);
          return;
        }

        if (data.ts) {
          localStorage.timeOffset = serverTimeOffset = data.ts - Date.now();
          serverVersion = data.v;
          update();
          return;
        }

        if (data.p) {
          listeners[data.p]?.dispatch(data.d);
          return;
        }

        const request = requests[data.r];
        if (!request) return; // for now
        if (data.err) {
          console.log('Error with send', request.action, request.args);
          request.reject(new Error(data.err));
        } else {
          if (data.s) {
            if (request.onMessage) request.onMessage(data.d);
          } else {
            request.resolve(data.d);
          }
        }
      };
    });
  }

  function disconnect() {
    shouldConnect = false;
    closeSocket();
  }

  function pause(pause = true) {
    paused = pause;
  }

  function closeSocket() {
    if (!socket) return;
    connected = false;
    authed = false;
    update();
    socket.close();
    if (socket) (socket.onclose as any)();
  }

  function listen<T extends GenericFunction>(listener: T) {
    return listeners[1](listener);
  }

  async function send(action: string, ...args: any[]): Promise<any> {
    if (!socket || socket.readyState > 1 || closing) {
      return Promise.reject(new Error('CONNECTION_CLOSED'));
    } else if (socket.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve, reject) => {
        afterConnectedQueue.push({ action, args, resolve, reject });
      });
    }

    let onMessage: GenericFunction;
    if (typeof args[args.length - 1] === 'function') {
      onMessage = args.pop();
    }

    while (args.length && args[args.length - 1] === undefined) args.pop();

    const r = requestNumber++;
    return new Promise((resolve, reject) => {
      requests[r] = { action, args, resolve, reject, onMessage };
      try {
        socket.send(JSON.stringify({ r, a: action, d: args.length ? args : undefined }));
      } catch (err) {
        console.error('Exception thrown from WebSocket.send():', err.message, 'Closing connection.');
      }
    }).finally(() => {
      delete requests[r];

      if (closing && !Object.keys(requests).length && socket) {
        closeSocket();
      }
    });
  }

  function sendAfterAuthed(action: string, ...args: any[]): Promise<any> {
    if (authed) return send(action, ...args);

    return new Promise((resolve, reject) => {
      afterAuthedQueue.push({ action, args, resolve, reject });
    });
  }

  async function sendAndListen<T extends GenericFunction>(action: string, ...args: [...any, T]): Promise<Unsubscribe> {
    const listener = args.pop() as T;
    const ref = await send(action, ...args);
    listeners[ref] = signal();
    const unsubscribe = listeners[ref](listener);

    return async () => {
      unsubscribe();
      delete listeners[ref];
      await send('unlisten', ref);
    };
  }

  async function auth(idToken?: string) {
    const uid = await send('auth', idToken);
    authed = !!uid;
    update();
    while (afterAuthedQueue.length) {
      const { action, args, resolve, reject } = afterAuthedQueue.shift() as Request;
      send(action, ...args).then(resolve, reject);
    }
    return uid;
  }

  function getNow() {
    return Date.now() + serverTimeOffset;
  }

  function getDate() {
    return new Date(getNow());
  }

  function onOnline() {
    online = true;
    update();
    if (shouldConnect) {
      connect().catch(err => {});
    }
  }

  function onOffline() {
    online = false;
    update();
    closeSocket();
  }

  function proxy(target: any, name?: string) {
    return new Proxy(target, {
      apply: (_, __, args) => send(name, ...args),
      get: (obj, prop: string) => prop in obj ? obj[prop] : proxy(NOOP, name ? `${name}.${prop}` : prop),
    });
  }

  return proxy({
    connect,
    disconnect,
    close,
    pause,
    send,
    sendAfterAuthed,
    sendAndListen,
    listen,
    auth,
    getNow,
    getDate,
    get,
    subscribe,
    onChange,
  }) as any;
}

type GenericFunction = (...args: any[]) => any;

interface Request {
  action: string;
  args: any[];
  resolve(value?: unknown): void;
  reject(reason?: any): void;
  onMessage?: GenericFunction;
}

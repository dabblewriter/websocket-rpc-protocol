import { signal } from 'easy-signal';
import { createId } from 'crypto-id';
const CONNECTION_TIMEOUT = 5000;
const BASE_RETRY_TIME = 1000;
const MAX_RETRY_BACKOFF = 4;
export default function createClient(url) {
    const requests = {};
    const afterConnectedQueue = [];
    const afterAuthedQueue = [];
    const onChange = signal();
    const deviceId = localStorage.deviceId || (localStorage.deviceId = createId());
    const listeners = { 1: signal() };
    const onOpen = signal();
    const onClose = signal();
    const onError = signal();
    let socket;
    let shouldConnect = false;
    let requestNumber = 1;
    let online = window.navigator.onLine;
    let connected = false;
    let authed = false;
    let serverTimeOffset = parseInt(localStorage.timeOffset) || 0;
    let serverVersion = '';
    let retries = 0;
    let reconnectTimeout;
    let connectionTimeout;
    let closing;
    let paused; // use for testing data drop and sync stability/recovery
    let data = { deviceId, online, connected, authed, serverTimeOffset, serverVersion };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    function close() {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
        disconnect();
    }
    function update() {
        if (online !== data.online || connected !== data.connected || authed !== data.authed || serverTimeOffset !== data.serverTimeOffset || serverVersion !== data.serverVersion) {
            onChange.dispatch(data = { deviceId, online, connected, authed, serverTimeOffset, serverVersion });
        }
    }
    function subscribe(listener) {
        const unsub = onChange(listener);
        listener(data);
        return unsub;
    }
    function get() {
        return data;
    }
    function connect() {
        clearTimeout(reconnectTimeout);
        clearTimeout(connectionTimeout);
        return new Promise((resolve, reject) => {
            shouldConnect = true;
            if (!online) {
                return reject(new Error('offline'));
            }
            else if (connected) {
                return;
            }
            try {
                socket = new WebSocket(url);
                connectionTimeout = setTimeout(() => {
                    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
                        socket.close();
                    }
                }, CONNECTION_TIMEOUT);
            }
            catch (err) {
                reject(err);
            }
            socket.onerror = (event) => {
                onError.dispatch(event.error);
                reject();
                closeSocket();
            };
            socket.onclose = () => {
                clearTimeout(closing);
                closing = null;
                socket.onclose = null;
                socket = null;
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
                        connect().catch(err => { });
                    }, backoff);
                }
            };
            socket.onmessage = async (event) => {
                if (paused)
                    return;
                let data;
                try {
                    data = JSON.parse(event.data);
                }
                catch (err) {
                    console.error('Unparseable data from socket:', event.data);
                    return;
                }
                if (data.ts) {
                    // Connected!
                    clearTimeout(connectionTimeout);
                    retries = 0;
                    connected = true;
                    localStorage.timeOffset = serverTimeOffset = data.ts - Date.now();
                    serverVersion = data.v;
                    const promises = [];
                    const options = { waitUntil: (promise) => {
                            promises.push(promise);
                        } };
                    onOpen.dispatch(options);
                    if (promises.length)
                        await Promise.all(promises);
                    update();
                    while (afterConnectedQueue.length) {
                        const { action, args, resolve, reject } = afterConnectedQueue.shift();
                        send(action, ...args).then(resolve, reject);
                    }
                    resolve();
                    return;
                }
                if (data.p) {
                    listeners[data.p]?.dispatch(data.d);
                    return;
                }
                const request = requests[data.r];
                if (!request)
                    return; // for now
                if (data.err) {
                    console.log('Error with send', request.action, request.args);
                    request.reject(new Error(data.err));
                }
                else {
                    if (data.s) {
                        if (request.onMessage)
                            request.onMessage(data.d);
                    }
                    else {
                        request.resolve(data.d);
                    }
                }
            };
        });
    }
    function disconnect() {
        shouldConnect = false;
        clearTimeout(reconnectTimeout);
        clearTimeout(connectionTimeout);
        closeSocket();
    }
    function pause(pause = true) {
        paused = pause;
    }
    function closeSocket() {
        if (!socket)
            return;
        connected = false;
        authed = false;
        update();
        socket.close();
        if (socket)
            socket.onclose();
    }
    function onMessage(listener) {
        return listeners[1](listener);
    }
    async function send(action, ...args) {
        if (!socket || socket.readyState > 1 || closing) {
            return Promise.reject(new Error('CONNECTION_CLOSED'));
        }
        else if (socket.readyState === WebSocket.CONNECTING) {
            return new Promise((resolve, reject) => {
                afterConnectedQueue.push({ action, args, resolve, reject });
            });
        }
        while (args.length && args[args.length - 1] === undefined)
            args.pop();
        const r = requestNumber++;
        return new Promise((resolve, reject) => {
            let onMessage, abortSignal;
            if (typeof args[args.length - 1] === 'function') {
                onMessage = args.pop();
                if (args[args.length - 1] instanceof AbortSignal) {
                    abortSignal = args.pop();
                    abortSignal.onabort = () => {
                        try {
                            if (abortSignal.reason)
                                reject(abortSignal.reason);
                            else
                                resolve();
                            send('_abort', r);
                        }
                        catch (err) { }
                    };
                }
            }
            requests[r] = { action, args, resolve, reject, onMessage };
            try {
                socket.send(JSON.stringify({ r, a: action, d: args.length ? args : undefined }));
            }
            catch (err) {
                console.error('Exception thrown from WebSocket.send():', err.message, 'Closing connection.');
            }
        }).finally(() => {
            delete requests[r];
            if (closing && !Object.keys(requests).length && socket) {
                closeSocket();
            }
        });
    }
    function sendAfterAuthed(action, ...args) {
        if (authed)
            return send(action, ...args);
        return new Promise((resolve, reject) => {
            afterAuthedQueue.push({ action, args, resolve, reject });
        });
    }
    async function auth(idToken) {
        const uid = await send('auth', idToken);
        authed = !!uid;
        update();
        while (afterAuthedQueue.length) {
            const { action, args, resolve, reject } = afterAuthedQueue.shift();
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
            connect().catch(err => { });
        }
    }
    function onOffline() {
        online = false;
        update();
        closeSocket();
    }
    function proxy(target, name) {
        return new Proxy(target, {
            apply: (_, __, args) => send(name, ...args),
            get: (obj, prop) => prop in obj ? obj[prop] : (obj[prop] = proxy(() => { }, name ? `${name}.${prop}` : prop)),
        });
    }
    return {
        api: proxy({}),
        connect,
        disconnect,
        close,
        pause,
        send,
        sendAfterAuthed,
        onMessage,
        auth,
        getNow,
        getDate,
        get,
        subscribe,
        onChange,
        onOpen,
        onClose,
        onError,
    };
}

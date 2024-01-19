import { createId } from 'crypto-id';
import { eventSignal } from 'easy-signal/eventSignal';
import { reactiveSignal, subscribe as signalSubscribe } from 'easy-signal/reactiveSignal';
const CONNECTION_TIMEOUT = 5000;
const BASE_RETRY_TIME = 1000;
const MAX_RETRY_BACKOFF = 4;
export default function createClient(url) {
    const requests = {};
    const afterConnectedQueue = [];
    const afterAuthedQueue = [];
    const data = reactiveSignal({
        deviceId: localStorage.deviceId || (localStorage.deviceId = createId()),
        online: window.navigator.onLine,
        connected: false,
        authed: false,
        serverTimeOffset: parseInt(localStorage.timeOffset) || 0,
        serverVersion: '',
    });
    const onMessage = eventSignal();
    const onOpen = eventSignal();
    const onClose = eventSignal();
    const onError = eventSignal();
    let socket;
    let shouldConnect = false;
    let requestNumber = 1;
    let retries = 0;
    let reconnectTimeout;
    let connectionTimeout;
    let closing;
    let paused; // use for testing data drop and sync stability/recovery\
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    function close() {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
        disconnect();
    }
    function updateData(update) {
        const obj = data();
        if (!Object.entries(update).some(([key, value]) => obj[key] !== value)) {
            return; // Nothing actually changed
        }
        data(obj => ({ ...obj, ...update }));
    }
    function connect() {
        clearTimeout(reconnectTimeout);
        clearTimeout(connectionTimeout);
        return new Promise((resolve, reject) => {
            shouldConnect = true;
            if (!data().online) {
                return reject(new Error('offline'));
            }
            else if (data().connected) {
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
                onError(event.error);
                reject();
                closeSocket();
            };
            socket.onclose = () => {
                clearTimeout(closing);
                closing = null;
                socket.onclose = null;
                socket = null;
                if (data().connected) {
                    updateData({ connected: false, authed: false });
                }
                onClose();
                Object.keys(requests).forEach(key => {
                    const request = requests[key];
                    request.reject(new Error('CONNECTION_CLOSED'));
                    delete requests[key];
                });
                if (shouldConnect && data().online) {
                    const backoff = Math.round(Math.random() * (Math.pow(2, retries) - 1) * BASE_RETRY_TIME);
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
                    const serverTimeOffset = (localStorage.timeOffset = data.ts - Date.now());
                    const serverVersion = data.v;
                    const promises = [];
                    const options = {
                        waitUntil: (promise) => {
                            promises.push(promise);
                        },
                    };
                    onOpen(options);
                    if (promises.length)
                        await Promise.all(promises);
                    updateData({ connected: true, serverTimeOffset, serverVersion });
                    while (afterConnectedQueue.length) {
                        const { action, args, resolve, reject } = afterConnectedQueue.shift();
                        send(action, ...args).then(resolve, reject);
                    }
                    resolve();
                    return;
                }
                if (data.p) {
                    onMessage(data.d);
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
        updateData({ connected: false, authed: false });
        socket.close(1000);
        if (socket)
            socket.onclose();
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
        if (data().authed)
            return send(action, ...args);
        return new Promise((resolve, reject) => {
            afterAuthedQueue.push({ action, args, resolve, reject });
        });
    }
    async function auth(idToken) {
        const uid = await send('auth', idToken);
        updateData({ authed: !!uid });
        while (afterAuthedQueue.length) {
            const { action, args, resolve, reject } = afterAuthedQueue.shift();
            send(action, ...args).then(resolve, reject);
        }
        return uid;
    }
    function getNow() {
        return Date.now() + data().serverTimeOffset;
    }
    function getDate() {
        return new Date(getNow());
    }
    function onOnline() {
        updateData({ online: true });
        if (shouldConnect) {
            connect().catch(err => { });
        }
    }
    function onOffline() {
        updateData({ online: false });
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
        auth,
        getNow,
        getDate,
        get: data,
        subscribe: signalSubscribe.bind(null, data),
        onMessage,
        onOpen,
        onClose,
        onError,
    };
}
//# sourceMappingURL=client.js.map
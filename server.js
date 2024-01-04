// Exposes an API to a websocket endpoint using the protocol described in PROTOCOL.md
// Use server to handle 1 API per socket for state, use server-single if one server can handle multiple sockets
export default async function createServer(socket, version, apiFactory) {
    const thisApi = { send, push, close };
    let api;
    let preMessages = [];
    const streamingRequests = new Map();
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', close);
    try {
        api = await apiFactory(thisApi);
        send({ ts: Date.now(), v: version });
        preMessages.forEach(processMessage);
        preMessages = null;
    }
    catch (err) {
        console.error(err);
        send({ err: err.message });
        close();
    }
    return thisApi;
    function send(data) {
        socket.send(JSON.stringify(data));
    }
    function push(data, forRequest) {
        send({ p: forRequest || 1, d: data });
    }
    function close() {
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('close', close);
        try {
            socket.close();
        }
        catch (err) { }
    }
    function onMessage(event) {
        api ? processMessage('' + event.data) : preMessages.push('' + event.data);
    }
    async function processMessage(message) {
        if (typeof message !== 'string') {
            return send({ err: 'Incorrect message format, expecting valid JSON' });
        }
        let data;
        try {
            data = JSON.parse(message);
        }
        catch (err) {
            return send({ err: 'Incorrect JSON format' });
        }
        if (!data || typeof data.a !== 'string' || typeof data.r !== 'number' || (data.d && !Array.isArray(data.d))) {
            return send({ err: 'Invalid message protocol' });
        }
        const { a, r, d = [] } = data;
        const path = a.split('.');
        const method = path.pop();
        let namespace = api;
        path.forEach(name => namespace = namespace && namespace[name]);
        const apiFunction = namespace?.[method];
        function sendError(err) {
            const message = typeof err === 'string' ? err : err.message;
            return send({ r, err: message });
        }
        if (a === '_abort') {
            const otherR = d[0];
            const success = streamingRequests.get(otherR)?.(true) || false;
            if (success)
                send({ r: otherR });
            return send({ r, d: success });
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
                const signal = result;
                const unsubscribers = [];
                unsubscribers.push(signal((d) => {
                    if (d === undefined) {
                        unsubscribe();
                        send({ r });
                    }
                    else {
                        send({ r, s: 1, d });
                    }
                }));
                const { error, abort } = signal;
                if (typeof error === 'function' && typeof error.dispatch === 'function') {
                    unsubscribers.push(error((err) => {
                        sendError(err);
                        unsubscribe();
                    }));
                }
                const unsubscribe = (aborted) => {
                    if (!streamingRequests.delete(r))
                        return false;
                    if (aborted && abort)
                        abort.dispatch();
                    unsubscribers.forEach(u => u());
                    return true;
                };
                streamingRequests.set(r, unsubscribe);
            }
            else {
                send({ r, d: result });
            }
        }
        catch (err) {
            sendError(err);
        }
    }
}
//# sourceMappingURL=server.js.map
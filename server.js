// Exposes an API to a websocket endpoint using the protocol described in PROTOCOL.md
export default function createServer(socket, apiFactory) {
    const thisApi = { send, push, close };
    const api = apiFactory(thisApi);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', close);
    send({ ts: Date.now(), v: api.getVersion?.() });
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
    }
    function onMessage(event) {
        processMessage('' + event.data);
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
                const unsubscribe = signal((d) => {
                    send({ r, s: 1, d });
                    if (d === undefined)
                        unsubscribe();
                });
                const { error } = signal;
                if (typeof error === 'function' && typeof error.dispatch === 'function') {
                    const errorUnsub = error((err) => {
                        sendError(err);
                        unsubscribe();
                        errorUnsub();
                    });
                }
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

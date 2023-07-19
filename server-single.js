// Exposes an API to a websocket endpoint using the protocol described in PROTOCOL.md
export default async function createServer(version, apiFactory) {
    const thisApi = { send, push, onConnect, onMessage };
    let api;
    const streamingRequests = new Map();
    api = await apiFactory(thisApi);
    return thisApi;
    function onConnect(socket) {
        send(socket, { ts: Date.now(), v: version });
    }
    async function onMessage(socket, event) {
        await processMessage(socket, '' + event.data);
    }
    function send(socket, data) {
        socket.send(JSON.stringify(data));
    }
    function push(socket, data, forRequest) {
        send(socket, { p: forRequest || 1, d: data });
    }
    async function processMessage(socket, message) {
        if (typeof message !== 'string') {
            return send(socket, { err: 'Incorrect message format, expecting valid JSON' });
        }
        let data;
        try {
            data = JSON.parse(message);
        }
        catch (err) {
            return send(socket, { err: 'Incorrect JSON format' });
        }
        if (!data || typeof data.a !== 'string' || typeof data.r !== 'number' || (data.d && !Array.isArray(data.d))) {
            return send(socket, { err: 'Invalid message protocol' });
        }
        const { a, r, d = [] } = data;
        const path = a.split('.');
        const method = path.pop();
        let namespace = api;
        path.forEach(name => namespace = namespace && namespace[name]);
        const apiFunction = namespace?.[method];
        function sendError(err) {
            const message = typeof err === 'string' ? err : err.message;
            return send(socket, { r, err: message });
        }
        if (a === '_abort') {
            const otherR = d[0];
            const success = streamingRequests.get(otherR)?.(true) || false;
            if (success)
                send(socket, { r: otherR });
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
                const signal = result;
                const unsubscribers = [];
                unsubscribers.push(signal((d) => {
                    if (d === undefined) {
                        unsubscribe();
                        send(socket, { r });
                    }
                    else {
                        send(socket, { r, s: 1, d });
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
                send(socket, { r, d: result });
            }
        }
        catch (err) {
            sendError(err);
        }
    }
}
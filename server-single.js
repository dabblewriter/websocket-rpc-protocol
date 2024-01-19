import { ForErrors } from 'easy-signal/eventSignal';
;
// Exposes an API to a websocket endpoint using the protocol described in PROTOCOL.md
// use server-single if one server can handle multiple clients without state, otherwise use server
export default function createServer(version, api) {
    const thisApi = { send, push, onConnect, onMessage };
    const streamingRequests = new Map();
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
            const result = await apiFunction(socket, ...d);
            if (typeof result?.signal === 'function') {
                // result is an object with method named signal with the library easy-signal, used to stream multiple results.
                // Send an undefined result to end the stream and an error to end the stream with an error.
                const { signal, abort } = result;
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
                unsubscribers.push(signal((err) => {
                    sendError(err);
                    unsubscribe();
                }, ForErrors));
                const unsubscribe = (aborted) => {
                    if (!streamingRequests.delete(r))
                        return false;
                    if (aborted && abort)
                        abort();
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
//# sourceMappingURL=server-single.js.map
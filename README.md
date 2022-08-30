# Websocket-RPC-Protocol

Client and server libraries for handling RPC calls between the browser and a Cloudflare websocket interface. The client
library will automatically try to reconnect after being disconnected from the server. For details on the protocol see
[PROTOCOL.md](PROTOCOL.md).

## Installation

```
npm install websocket-rpc-protocol
```

## Server Usage

```ts
import server from 'websocket-rpc-protocol/server';


createServer(websocket, ({ push }) => {
  // Any state that could be built up over type during the connection of this single client (user id, etc)
  let userState = {};

  // Add any functions you want, only those returned will be public
  function privateFunction() {
    // do something not exposed to the client
  }

  // Define functions which will be exposed for calling by the client
  function sayHi(name?: string) {
    return `Hello ${name || 'world'}!`;
  }

  // return the public API
  return {
    sayHi
  };
});
```

## Client Usage

```ts
import createClient from 'websocket-rpc-protocol/client';

interface API {
  sayHi(name?: string): Promise<string>;
}

const client = createClient<API>('wss://url-to-server');

// Call the method directly, TypeScript will support it and the method will be proxied using the send() method
await client.sayHi(); // Hello world!
await client.sayHi('everyone'); // Hello everyone!

client.get() // {
  // online: true, // Whether the browser's APIs think the browser is online
  // connected: true, // Whether the websocket is connected
  // authed: true, // If the connection has been successfully authenticated with a JWT
  // serverTimeOffset: 20, // The offset in milliseconds between the client and the server
//}
```

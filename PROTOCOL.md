# Agreeable Websocket Protocol

The websocket protocol used for Agreeable.

## Overview

Each message to and from the server is a JSON encoded object. Messages can be part of a request-response communication,
a streamed result with multiple responses, or an asynchronous push message sent from the server.

## Connection

When connecting to the server, a message will be sent to the client with the following properties:
* `ts`: A **t**ime**s**tamp number for the server's time, useful for roughly calculating difference in time clocks.
* `v`: The **v**ersion number of this API, useful for detecting backwards incompatible changes.

## Request-Response Messages

Each message sent by the client should be a request-response style message. The object sent should contain the
following properties:
* `r`: A **r**equest number, positive integer auto-incremented on the client, used to identify the response message.
* `a`: An **a**ction string, identifying the action being requested.
* `d`: An optional **d**ata array containing the arguments sent to the action.

The message sent back by the server in response to this request will contain the following properties:
* `r`: The **r**equest number sent by the client.
* `d`: The optional **d**ata result returned from the method.
* `s`: An optional **s**tream flag (the number `1`) indicating partial data for a request that is streaming data. These
       requests must end with a terminating message that does not contain `s`.
* `err`: The **err**or returned from the method if one was thrown.

Each request will call a remote function by the name of the **action**, passing the arguments defined in **data**, and
returning the results to the client with the same **request** number. Here is an example:

-> `{"a":"put","r":2,"d":["projects",{"id":"abc123"}]}`
<- `{"r":1,"d":1583860811431}`

You should always check for the `err` property and handle errors appropriately.

## Push Messages

The server may push messages to a client when it knows the client needs it. These messages contain the following
properties:
* `p`: A **p**ush flag indicating this is a push message sent to the client.
* `d`: The data for this **push** notification.

-> `{"a":"listen","r":3,"d":["these","pubsub","topics"]}`
<- `{"r":3}`
<- `{"p":1,"d":{"subject":"pubsub","payload":{...}}`
<- `{"p":1,"d":{"subject":"topcis","payload":{...}}`

## Targeted Message Handlers

Rather than a single stream of messages being pushed, you may want to handle individual streams. You can do this using
the stream part of this protocol. You may do so by making an initial request and then leaving it open, slowly streaming
the response back over a long period. An open stream request may be aborted with a special action defined by your server
such as an `_abort` action.

-> `{"a":"getPresences","r":3,"d":["roomID123ABC"]}`
<- `{"r":3}`
<- `{"r":3,"s":1,"d":{"uid":"3jf9","status":"online"}}`
<- `{"r":3,"s":1,"d":{"uid":"0toe","status":"offline"}}`
-> `{"a":"_abort","r":4,"d":[3]}`
<- `{"r":3}`
<- `{"r":4,"d":true}`

## That's it

These mechanisms should allow for everything you'd like to do. Functions on the server can be synchronous or
asynchronous, and they simply throw errors when something goes wrong or incorrect data is sent.

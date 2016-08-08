# ilp-core

> Core ILP module — handles ledger abstraction and quoting

## Installation

You need to install this module along with any ledger plugin modules you would like to use, e.g.:

``` sh
npm install --save ilp-core ilp-plugin-bells
```

## Usage

### Setup

``` js
const Client = require('ilp-core').Client
const Core = require('ilp-core').Core

const core = new Core()
core.addClient('ilpdemo.red',
  new Client({
    _plugin: require('ilp-plugin-bells'),
    prefix: 'ilpdemo.red',
    account: 'https://red.ilpdemo.org/ledger/accounts/alice',
    password: 'alice'
  }))

core.connect()
```

### Sending a Payment

``` js
const payment = {
  destinationAccount: 'ilpdemo.blue.bob',
  destinationAmount: '1',
  destinationMemo: {
    myKey: 'myValue'
  },
  executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
  expiresAt: (new Date(Date.now() + 10000)).toISOString()
}

const client = core.resolveClient('ilpdemo.red')
client.waitForConnection().then(() => {
  return client.quote({
    destinationAddress: payment.destinationAccount,
    destinationAmount: payment.destinationAmount
  })
  .then((quote) => {
    return client.sendQuotedPayment(Object.assign({}, payment, quote))
  })
  .then(() => {
    console.log('payment sent')
  })
})
.catch((err) => {
  console.log(err)
})

core.on('fulfill_execution_condition', (client, transfer, fulfillment) => {
  console.log('transfer fulfilled', fulfillment)
  core.disconnect()
})

```

### Receiving a Transfer

**Note that the `receive` event is fired for conditional transfers, so the event does not necessarily indicate that funds have been transferred**

``` js
core.on('receive', (client, transfer) => {
  console.log(transfer)
  client.fulfillCondition(transfer.id, 'cf:0:')
})
```

## Extensions

To extend the functionality of the `Client`:

```js
const Client = require('ilp-core').Client

class MyExtension {
  constructor (client) {
    this.client = client
    this.client.on('receive', this._handleReceive.bind(this))
  }

  static getName () {
    return 'extension'
  }

  pluginIsConnected () {
    return this.client.getPlugin().isConnected()
  }

  _handleReceive (transfer) {
    // do something with the transfer
  }
}

const client = new Client({
  _plugin: require('ilp-plugin-bells'),
  prefix: 'ilpdemo.red',
  account: 'https://blue.ilpdemo.org/ledger/accounts/bob',
  password: 'bobbob'
})

client.use(MyExtension)
console.log(client.extension.pluginIsConnected())
```

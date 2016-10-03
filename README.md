# ilp-core [![npm][npm-image]][npm-url] [![circle][circle-image]][circle-url] [![codecov][codecov-image]][codecov-url]

[npm-image]: https://img.shields.io/npm/v/ilp-core.svg?style=flat
[npm-url]: https://npmjs.org/package/ilp-core
[circle-image]: https://circleci.com/gh/interledger/js-ilp-core.svg?style=shield
[circle-url]: https://circleci.com/gh/interledger/js-ilp-core
[codecov-image]: https://codecov.io/gh/interledger/js-ilp-core/branch/master/graph/badge.svg
[codecov-url]: https://codecov.io/gh/interledger/js-ilp-core

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

// options for the plugin that Client instantiates.
// '_plugin' is the plugin module.
const pluginOpts = {
  _plugin: require('ilp-plugin-bells'),
  prefix: 'ilpdemo.red.',
  account: 'https://red.ilpdemo.org/ledger/accounts/alice',
  password: 'alice'
}

// It is optional to specify clientOpts. It has one field, connectors, which
// contains http endpoints for the connectors you wish to use.
// These http addresses are used for quoting and getting ILP address information.
// If unspecified, Client will get connectors from the plugin's 'getInfo' method.
const clientOpts = {
  connectors: [
    'https://a.example:4000',
    'https://b.example:4040',
    'https://c.example:5555',
    'https://d.example:4000',
  ]
}

core.addClient('ilpdemo.red.', new Client(pluginOpts, clientOpts))

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

const client = core.getClient('ilpdemo.red.')
client.waitForConnection().then(() => {
  return client.quote({
    destinationAddress: payment.destinationAccount,
    destinationAmount: payment.destinationAmount,
    // You can optionally specify connectors here. If left unspecified,
    // then they will be accessed from the clientOpts object in the constructor,
    // or from the 'getInfo' method of the plugin.
    connectors: [ 'https://a.example:4000', 'https://b.example:5555' ]
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


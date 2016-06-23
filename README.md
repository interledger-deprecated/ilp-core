# ilp-core

> Core ILP module — handles ledger abstraction and quoting

## Installation

You need to install this module along with any ledger plugin modules you would like to use, e.g.:

``` sh
npm install --save ilp-core ilp-plugin-bells
```

## Usage

### Sending a Payment

``` js
import { Client } from 'ilp-core'

const client = new Client({
  type: 'bells',
  auth: {
    account: 'https://red.ilpdemo.org/ledger/accounts/alice',
    password: 'alice'
  }
})

const payment = client.createPayment({
  destinationAccount: 'https://blue.ilpdemo.org/ledger/accounts/bob',
  destinationLedger: 'https://blue.ilpdemo.org/ledger',
  destinationAmount: '1',
  destinationMemo: {
    myKey: 'myValue'
  },
  executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
  expiresAt: (new Date(Date.now() + 4000)).toISOString()
})

payment.quote()
  .then((quote) => {
    console.log('quote', quote)
    return payment.sendQuoted(quote)
  })
  .then(() => {
    console.log('payment sent')
  })
  .catch((err) => {
    console.error((err && err.stack) ? err.stack : err)
  })

client.on('fulfill_execution_condition', (transfer, fulfillment) => {
  console.log('transfer fulfilled', fulfillment)
  client.disconnect()
})

```

### Receiving a Payment

``` js
import { Client } from 'ilp-core'

const client = new Client({
  type: 'bells',
  auth: {
    account: 'https://blue.ilpdemo.org/ledger/accounts/bob',
    password: 'bobbob'
  }
})

client.on('incoming', (transfer) => {
  console.log(transfer)
  client.fulfillCondition(transfer.id, 'cf:0:')
})
```

## Extensions

To extend the functionality of the `Client`:

```js
import { Client } from 'ilp-core'

const extensionFactory = (client) => {
  // Do things with the client
  const handleReceive = (transfer) => {
    console.log(transfer)
  }
  client.on('receive', handleReceive)

  const clientIsConnected = () => client.getPlugin().isConnected()

  // Return an object that has a name property
  return {
    name: 'myExtension',
    isConnected: clientIsConnected,
  }
}

const client = new Client({
  type: 'bells',
  auth: {
    account: 'https://blue.ilpdemo.org/ledger/accounts/bob',
    password: 'bobbob'
  }
})

client.use(MyExtension)
console.log(client.extension.isConnected())
```

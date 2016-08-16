'use strict'

const sinon = require('sinon')
const nock = require('nock')
const chai = require('chai')
sinon.assert.expose(chai.assert, { prefix: '' })
const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const assert = chai.assert

const mockRequire = require('mock-require')
const MockPlugin = require('./mocks/mock-plugin')
const MockClient = require('./mocks/mock-client')

const RoutingTables = require('five-bells-routing').RoutingTables
const Core = require('../src/lib/core')

describe('Core', function () {
  beforeEach(function () {
    mockRequire('ilp-plugin-mock', MockPlugin)
    this.tables = new RoutingTables('http://mark.example', [], 10)
    this.core = new Core({routingTables: this.tables})
  })

  afterEach(function () {
    mockRequire.stopAll()
    nock.cleanAll()
  })

  describe('constructor', function () {
    it('should instantiate a Core', function () {
      const core = new Core()
      assert.instanceOf(core, Core)
      assert.deepEqual(core.clientList, [])
      assert.deepEqual(core.clients, {})
    })
  })

  describe('getClient', function () {
    it('returns the corresponding Client for a local address', function () {
      const client1 = new MockClient({prefix: 'ledger1.'})
      const client2 = new MockClient({prefix: 'ledger2.'})
      this.core.addClient('ledger1.', client1)
      this.core.addClient('ledger2.', client2)
      assert.equal(this.core.getClient('ledger1.'), client1)
      assert.equal(this.core.getClient('ledger2.'), client2)
    })

    it('does not return remote clients', function () {
      const client1 = new MockClient({prefix: 'ledger1.'})
      this.core.addClient('ledger1.', client1)
      this.core.tables.addLocalRoutes([{
        source_ledger: 'ledger2.',
        destination_ledger: 'ledger3.',
        connector: 'http://mark.example',
        source_account: 'ledger2.mark',
        points: [ [0, 0], [100, 50] ]
      }])
      assert.strictEqual(this.core.getClient('ledger2.'), null)
      assert.strictEqual(this.core.getClient('ledger3.'), null)
    })

    it('throws if the ledger doesn\'t end with "."', function () {
      assert.throws(() => {
        this.core.getClient('ledger1')
      }, 'prefix must end with "."')
    })

    it('returns null if no local Client matches', function () {
      assert.strictEqual(this.core.getClient('ledger3.'), null)
    })
  })

  describe('getPlugin', function () {
    it('returns the corresponding plugin', function () {
      const client1 = new MockClient({prefix: 'ledger1.'})
      const client2 = new MockClient({prefix: 'ledger2.'})
      this.core.addClient('ledger1.', client1)
      this.core.addClient('ledger2.', client2)
      assert.equal(this.core.getPlugin('ledger1.'), client1.plugin)
      assert.equal(this.core.getPlugin('ledger2.'), client2.plugin)
    })

    it('throws if the ledger doesn\'t end with "."', function () {
      assert.throws(() => {
        this.core.getPlugin('ledger1')
      }, 'prefix must end with "."')
    })

    it('returns null if there is no match', function () {
      assert.strictEqual(this.core.getPlugin('ledger3.'), null)
    })
  })

  describe('getClients', function () {
    it('returns a list of clients', function () {
      const client1 = new MockClient({prefix: 'ledger1.'})
      const client2 = new MockClient({prefix: 'ledger2.'})
      this.core.addClient('ledger1.', client1)
      this.core.addClient('ledger2.', client2)
      assert.deepEqual(this.core.getClients(), [client1, client2])
    })

    it('returns [] when there are no clients', function () {
      assert.deepEqual(this.core.getClients(), [])
    })
  })

  describe('addClient', function () {
    it('propagates events', function (done) {
      const client1 = new MockClient({prefix: 'ledger1.'})
      this.core.addClient('ledger1.', client1)
      this.core.on('foobar', function (client, arg1, arg2, arg3) {
        assert.equal(client, client1)
        assert.equal(arg1, 1)
        assert.equal(arg2, 2)
        assert.equal(arg3, 3)
        done()
      })
      client1.emit('foobar', 1, 2, 3)
    })

    it('throws if the prefix is not a ledger', function () {
      const client1 = new MockClient({prefix: 'ledger1.'})
      assert.throws(() => {
        this.core.addClient('ledger1', client1)
      }, 'prefix must end with "."')
    })
  })

  describe('connect', function () {
    it('connects all clients', function * () {
      const client1 = new MockClient({prefix: 'ledger1.'})
      const client2 = new MockClient({prefix: 'ledger2.'})
      this.core.addClient('ledger1.', client1)
      this.core.addClient('ledger2.', client2)

      const spy1 = sinon.spy(client1, 'connect')
      const spy2 = sinon.spy(client2, 'connect')
      yield this.core.connect()
      assert.calledOnce(spy1)
      assert.calledOnce(spy2)
    })
  })

  describe('disconnect', function () {
    it('disconnects all clients', function * () {
      const client1 = new MockClient({prefix: 'ledger1.'})
      const client2 = new MockClient({prefix: 'ledger2.'})
      this.core.addClient('ledger1.', client1)
      this.core.addClient('ledger2.', client2)

      const spy1 = sinon.spy(client1, 'disconnect')
      const spy2 = sinon.spy(client2, 'disconnect')
      yield this.core.disconnect()
      assert.calledOnce(spy1)
      assert.calledOnce(spy2)
    })
  })

  describe('quote', function () {
    beforeEach(function () {
      this.core.addClient('group1.ledger1.', new MockClient({prefix: 'group1.ledger1.'}))
      this.core.addClient('group1.ledger2.', new MockClient({prefix: 'group1.ledger2.'}))
      this.core.tables.addLocalRoutes([{
        source_ledger: 'group1.ledger1.',
        destination_ledger: 'group1.ledger2.',
        connector: 'http://mark.example',
        source_account: 'group1.ledger1.mark',
        min_message_window: 3,
        points: [ [0, 0], [100, 50] ]
      }])
      // Remote route
      this.core.tables.addRoute({
        source_ledger: 'group1.ledger2.',
        destination_ledger: 'group2.',
        connector: 'http://mary.example',
        source_account: 'group1.ledger2.mary',
        min_message_window: 4,
        // This curve is only used for route selection, not for quoting amounts.
        points: [ [0, 0], [100, 50] ]
      })
    })

    it('returns null when no route is available', function * () {
      const quotePromise = this.core.quote({
        sourceAddress: 'ledger3.alice',
        destinationAddress: 'ledger4.mark',
        sourceAmount: '100.00'
      })
      assert(quotePromise instanceof Promise)
      assert.strictEqual(yield quotePromise, null)
    })

    it('returns a quote for local ledgers (by source amount)', function * () {
      const quote = yield this.core.quote({
        sourceAddress: 'group1.ledger1.alice',
        destinationAddress: 'group1.ledger2.bob',
        sourceAmount: '100.00',
        sourceExpiryDuration: '3.5'
      })
      assert.deepEqual(quote, {
        sourceLedger: 'group1.ledger1.',
        nextLedger: 'group1.ledger2.',
        destinationLedger: 'group1.ledger2.',
        sourceAmount: '100.00',
        destinationAmount: '50',
        connectorAccount: 'group1.ledger1.mark',
        minMessageWindow: 3,
        sourceExpiryDuration: 3.5,
        destinationExpiryDuration: 0.5,
        additionalInfo: undefined
      })
    })

    it('returns a quote for local ledgers (by destination amount)', function * () {
      const quote = yield this.core.quote({
        sourceAddress: 'group1.ledger1.alice',
        destinationAddress: 'group1.ledger2.bob',
        destinationAmount: '50.00',
        destinationExpiryDuration: 0.5
      })
      assert.deepEqual(quote, {
        sourceLedger: 'group1.ledger1.',
        nextLedger: 'group1.ledger2.',
        destinationLedger: 'group1.ledger2.',
        sourceAmount: '100',
        destinationAmount: '50.00',
        connectorAccount: 'group1.ledger1.mark',
        minMessageWindow: 3,
        sourceExpiryDuration: 3.5,
        destinationExpiryDuration: 0.5,
        additionalInfo: undefined
      })
    })

    it('returns a constructed quote for remote ledgers (by source amount)', function * () {
      nock('http://mary.example')
        .get('/quote')
        .query({
          source_address: 'group1.ledger2.mary',
          destination_address: 'group2.ledger2.bob',
          source_amount: '50.00',
          source_expiry_duration: 8.75 - 7,
          destination_precision: '2',
          destination_scale: '1',
          slippage: 0
        })
        .reply(200, {
          destination_ledger: 'group2.ledger2.',
          source_amount: '50.00',
          destination_amount: '10.00',
          source_expiry_duration: '1.75',
          destination_expiry_duration: '0.25'
        })

      const quote = yield this.core.quote({
        sourceAddress: 'group1.ledger1.alice',
        destinationAddress: 'group2.ledger2.bob',
        sourceAmount: '100.00',
        sourceExpiryDuration: 8.75,
        destinationPrecisionAndScale: { precision: '2', scale: '1' }
      })
      assert.deepEqual(quote, {
        sourceLedger: 'group1.ledger1.',
        nextLedger: 'group1.ledger2.',
        destinationLedger: 'group2.ledger2.',
        sourceAmount: '100.00',
        destinationAmount: '10.00',
        connectorAccount: 'group1.ledger1.mark',
        minMessageWindow: 4.5,
        sourceExpiryDuration: 8.75,
        destinationExpiryDuration: 4.25
      })
    })

    it('returns a constructed quote for remote ledgers (by destination amount)', function * () {
      nock('http://mary.example')
        .get('/quote')
        .query({
          source_address: 'group1.ledger2.mary',
          destination_address: 'group2.ledger2.bob',
          destination_amount: '10.00',
          destination_expiry_duration: 0.5,
          slippage: 0
        })
        .reply(200, {
          destination_ledger: 'group2.ledger2.',
          source_amount: '50.00',
          destination_amount: '10.00',
          source_expiry_duration: '0.75',
          destination_expiry_duration: '0.5'
        })

      const quote = yield this.core.quote({
        sourceAddress: 'group1.ledger1.alice',
        destinationAddress: 'group2.ledger2.bob',
        destinationAmount: '10.00',
        destinationExpiryDuration: 0.5
      })
      assert.deepEqual(quote, {
        sourceLedger: 'group1.ledger1.',
        nextLedger: 'group1.ledger2.',
        destinationLedger: 'group2.ledger2.',
        sourceAmount: '100',
        destinationAmount: '10.00',
        connectorAccount: 'group1.ledger1.mark',
        minMessageWindow: 3.25,
        sourceExpiryDuration: 3.75,
        destinationExpiryDuration: 0.5
      })
    })
  })
})

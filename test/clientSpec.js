'use strict'

const sinon = require('sinon')
const chai = require('chai')
sinon.assert.expose(chai.assert, { prefix: '' })
const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const assert = chai.assert

const ilpCore = require('..')
const Client = ilpCore.Client
const MockPlugin = require('./mocks/mock-plugin')

describe('Client', function () {
  describe('constructor', function () {
    it('should instantiate the ledger plugin', function () {
      const client = new Client({
        _plugin: MockPlugin
      })

      assert.instanceOf(client, Client)
      assert.instanceOf(client.getPlugin(), MockPlugin)
    })

    it('should fail if "pluginOpts" is not an object', function () {
      assert.throws(() => {
        return new Client()
      }, 'Client pluginOpts must be an object')
    })

    it('should fail if the ledger plugin does not exist', function () {
      assert.throws(() => {
        return new Client({
          _plugin: null,
          mock: true
        })
      }, '"pluginOpts._plugin" must be a function')
    })

    it('should fail if "clientOpts" is not an object', function () {
      assert.throws(() => {
        return new Client({ _plugin: MockPlugin }, 123)
      }, 'Client clientOpts must be an object')
    })

    it('should fail if "connectors" is passed but is not an array', function () {
      assert.throws(() => {
        return new Client({ _plugin: MockPlugin }, { connectors: {} })
      }, '"clientOpts.connectors" must be an Array or undefined')
    })

    it('should fail if "messageTimeout" is passed but is not a number', function () {
      assert.throws(() => {
        return new Client({ _plugin: MockPlugin }, { messageTimeout: '123' })
      }, '"clientOpts.messageTimeout" must be a Number or undefined')
    })
  })

  describe('connect', function () {
    it('should call connect on the plugin', function * () {
      const client = new Client({
        _plugin: MockPlugin
      })
      const stubConnect = sinon.stub(client.getPlugin(), 'connect')

      client.connect()

      sinon.assert.calledOnce(stubConnect)
      stubConnect.restore()
    })
  })

  describe('disconnect', function () {
    it('should call disconnect on the plugin', function * () {
      const client = new Client({
        _plugin: MockPlugin
      })
      const stubDisconnect = sinon.stub(client.getPlugin(), 'disconnect')

      client.disconnect()

      sinon.assert.calledOnce(stubDisconnect)
      stubDisconnect.restore()
    })
  })

  describe('fulfillCondition', function () {
    it('should call fulfillCondition on the plugin', function * () {
      const client = new Client({
        _plugin: MockPlugin
      })
      const stubDisconnect = sinon.stub(client.getPlugin(), 'fulfillCondition')

      client.fulfillCondition({ foo: true }, 'cf:0:')

      sinon.assert.calledOnce(stubDisconnect)
      sinon.assert.calledWith(stubDisconnect, { foo: true }, 'cf:0:')
      stubDisconnect.restore()
    })
  })

  describe('waitForConnection', function () {
    it('should return a rejected promise if not currently connecting', function * () {
      const client = new Client({
        _plugin: MockPlugin
      })

      client.disconnect()
      const promise = client.waitForConnection()

      yield assert.isRejected(promise)
    })
  })

  describe('quote', function () {
    beforeEach(function () {
      this.client = new Client({
        _plugin: MockPlugin
      })
    })

    it('should reject if neither sourceAmount nor destinationAmount are specified', function (done) {
      this.client.quote({
        destinationAddress: 'example.red'
      })
      .catch(function (err) {
        assert.equal(err.message, 'Should provide source or destination amount but not both')
        done()
      })
    })

    it('should reject if both sourceAmount and destinationAmount are specified', function (done) {
      this.client.quote({
        destinationAddress: 'example.red',
        sourceAmount: '10',
        destinationAmount: '10'
      })
      .catch(function (err) {
        assert.equal(err.message, 'Should provide source or destination amount but not both')
        done()
      })
    })

    it('supports expiry durations', function (done) {
      this.client.getPlugin().sendMessage = makeSendQuoteMessage({
        source_address: 'example.blue.mark',
        destination_address: 'example.red',
        source_amount: '1',
        destination_expiry_duration: '4'
      }, {
        destination_amount: '1',
        source_connector_account: 'mock/connector',
        source_expiry_duration: '5',
        destination_expiry_duration: '4'
      })

      this.client.quote({
        destinationAddress: 'example.red',
        sourceAmount: '1',
        destinationExpiryDuration: '4'
      })
      .then(function (quote) {
        assert.deepEqual(quote, {
          destinationAmount: '1',
          connectorAccount: 'mock/connector',
          sourceExpiryDuration: '5'
        })
        done()
      })
      .catch(done)
    })

    it('should get fixed sourceAmount quotes', function (done) {
      this.client.getPlugin().sendMessage = makeSendQuoteMessage({
        source_address: 'example.blue.mark',
        destination_address: 'example.red',
        source_amount: '1'
      }, {
        destination_amount: '1',
        source_connector_account: 'mock/connector'
      })

      this.client.quote({
        destinationAddress: 'example.red',
        sourceAmount: '1'
      })
      .then(function (quote) {
        assert.deepEqual(quote, {
          destinationAmount: '1',
          connectorAccount: 'mock/connector'
        })
        done()
      })
      .catch(done)
    })

    it('should get fixed destinationAmount quotes', function (done) {
      this.client.getPlugin().sendMessage = makeSendQuoteMessage({
        source_address: 'example.blue.mark',
        destination_address: 'example.red',
        destination_amount: '1'
      }, {
        source_amount: '1',
        source_connector_account: 'mock/connector'
      })

      this.client.quote({
        destinationAddress: 'example.red',
        destinationAmount: '1'
      })
      .then(function (quote) {
        assert.deepEqual(quote, {
          sourceAmount: '1',
          connectorAccount: 'mock/connector'
        })
        done()
      })
      .catch(done)
    })

    it('should get the quotes from the list of specified connectors', function (done) {
      this.client.getPlugin().sendMessage = makeSendQuoteMessage({
        source_address: 'example.blue.mark',
        destination_address: 'example.red',
        destination_amount: '1'
      }, {
        source_amount: '1',
        source_connector_account: 'mock/connector'
      }, 'example.blue.connector2')

      this.client.quote({
        destinationAddress: 'example.red',
        destinationAmount: '1',
        connectors: ['connector2']
      })
      .then(function (quote) {
        assert.deepEqual(quote, {
          sourceAmount: '1',
          connectorAccount: 'mock/connector'
        })
        done()
      })
      .catch(done)
    })

    it('ignores AssetsNotTraded errors', function (done) {
      this.client.getPlugin().sendMessage = makeSendMessage({
        ledger: 'example.blue.',
        account: 'example.blue.connector1',
        data: {
          method: 'quote_request',
          data: {
            source_address: 'example.blue.mark',
            destination_address: 'example.red',
            destination_amount: '1'
          }
        }
      }, {
        ledger: 'example.blue.',
        account: 'example.blue.connector1',
        data: {
          method: 'error',
          data: {id: 'AssetsNotTradedError', message: 'broken'}
        }
      })

      this.client.quote({
        destinationAddress: 'example.red',
        destinationAmount: '1'
      }).then(function (quote) {
        assert.strictEqual(quote, undefined)
        done()
      }).catch(done)
    })

    ;[
      {
        connector1: {source_amount: '1', destination_amount: '1'},
        connector2: {source_amount: '2', destination_amount: '1'},
        quote: {sourceAmount: '1', destinationAmount: '1', connectorAccount: 'connector1'}
      },
      {
        connector1: {source_amount: '2', destination_amount: '1'},
        connector2: {source_amount: '1', destination_amount: '1'},
        quote: {sourceAmount: '1', destinationAmount: '1', connectorAccount: 'connector2'}
      },
      {
        connector1: {source_amount: '1', destination_amount: '2'},
        connector2: {source_amount: '1', destination_amount: '1'},
        quote: {sourceAmount: '1', destinationAmount: '2', connectorAccount: 'connector1'}
      }
    ].forEach(function (info) {
      it('returns the cheapest quote', function * () {
        const plugin = this.client.getPlugin()
        function sendMessage1 (message) {
          plugin.sendMessage = sendMessage2
          return makeSendQuoteMessage({
            source_address: 'example.blue.mark',
            destination_address: 'example.red',
            destination_amount: '1'
          }, Object.assign(info.connector1, {
            source_connector_account: 'connector1'
          }), 'example.blue.connector1').call(plugin, message)
        }

        function sendMessage2 (message) {
          plugin.sendMessage = null
          return makeSendQuoteMessage({
            source_address: 'example.blue.mark',
            destination_address: 'example.red',
            destination_amount: '1'
          }, Object.assign(info.connector2, {
            source_connector_account: 'connector2'
          }), 'example.blue.connector2').call(plugin, message)
        }

        plugin.sendMessage = sendMessage1
        assert.deepEqual(yield this.client.quote({
          connectors: [
            'connector1',
            'connector2'
          ],
          destinationAddress: 'example.red',
          destinationAmount: '1'
        }), info.quote)
      })
    })

    it('gets same-ledger quotes', function (done) {
      this.client.quote({
        destinationAddress: 'example.blue.bob',
        sourceAmount: '1',
        destinationExpiryDuration: 4
      })
      .then(function (quote) {
        assert.deepEqual(quote, {
          sourceAmount: '1',
          destinationAmount: '1',
          sourceExpiryDuration: 4
        })
        done()
      })
      .catch(done)
    })
  })

  describe('sendQuotedPayment', function () {
    beforeEach(function () {
      this.client = new Client({
        _plugin: MockPlugin
      })
    })

    it('should reject if no executionCondition is provided and unsafeOptimisticTransport is not set', function (done) {
      this.client.sendQuotedPayment({
        connectorAccount: 'connector',
        sourceAmount: '1',
        destinationAmount: '2',
        destinationAccount: 'example.red.bob',
        destinationMemo: {
          foo: 'bar'
        },
        expiresAt: '2016-07-02T00:00:00.000Z'
      })
      .catch(function (err) {
        assert.equal(err.message, 'executionCondition must be provided unless unsafeOptimisticTransport is true')
        done()
      })
    })

    it('should reject if there is an executionCondition and no expiresAt', function (done) {
      this.client.sendQuotedPayment({
        connectorAccount: 'connector',
        sourceAmount: '1',
        destinationAmount: '2',
        destinationAccount: 'example.red.bob',
        destinationMemo: {
          foo: 'bar'
        },
        executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0'
      })
      .catch(function (err) {
        assert.equal(err.message, 'executionCondition should not be used without expiresAt')
        done()
      })
    })

    it('should reject if there is no sourceAmount', function (done) {
      this.client.sendQuotedPayment({
        connectorAccount: 'connector',
        destinationAmount: '2',
        destinationAccount: 'example.red.bob',
        destinationMemo: { foo: 'bar' },
        executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
        expiresAt: '2016-07-02T00:00:00.000Z'
      })
      .catch(function (err) {
        assert.equal(err.message, 'sourceAmount must be provided')
        done()
      })
    })

    it('should reject if there is no destinationAmount', function (done) {
      this.client.sendQuotedPayment({
        connectorAccount: 'connector',
        sourceAmount: '1',
        destinationAccount: 'example.red.bob',
        destinationMemo: { foo: 'bar' },
        executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
        expiresAt: '2016-07-02T00:00:00.000Z'
      })
      .catch(function (err) {
        assert.equal(err.message, 'destinationAmount must be provided')
        done()
      })
    })

    it('should reject if there is no destinationAccount', function (done) {
      this.client.sendQuotedPayment({
        connectorAccount: 'connector',
        sourceAmount: '1',
        destinationAmount: '2',
        destinationMemo: { foo: 'bar' },
        executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
        expiresAt: '2016-07-02T00:00:00.000Z'
      })
      .catch(function (err) {
        assert.equal(err.message, 'destinationAccount must be provided')
        done()
      })
    })

    it('should send a transfer to the ledger plugin with the ilp packet in the data field', function (done) {
      const spy = sinon.spy(this.client.plugin, 'sendTransfer')

      this.client.sendQuotedPayment({
        connectorAccount: 'connector',
        sourceAmount: '1',
        destinationAmount: '2',
        destinationAccount: 'example.red.bob',
        destinationMemo: { foo: 'bar' },
        executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
        expiresAt: '2016-07-02T00:00:00.000Z',
        uuid: 'abcdef'
      })
      .then(function () {
        assert.calledWithMatch(spy, {
          id: 'abcdef',
          account: 'connector',
          ledger: 'example.blue.',
          amount: '1',
          data: {
            ilp_header: {
              account: 'example.red.bob',
              amount: '2',
              data: { foo: 'bar' }
            }
          },
          executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
          expiresAt: '2016-07-02T00:00:00.000Z'
        })
        done()
      })
      .catch(done)
    })

    it('should send Optimistic payments if unsafeOptimisticTransport is set', function (done) {
      const spy = sinon.spy(this.client.plugin, 'sendTransfer')

      this.client.sendQuotedPayment({
        unsafeOptimisticTransport: true,
        connectorAccount: 'connector',
        sourceAmount: '1',
        destinationAmount: '2',
        destinationAccount: 'example.red.bob',
        destinationMemo: {
          foo: 'bar'
        }
      })
      .then(function () {
        assert.calledWithMatch(spy, {
          account: 'connector',
          ledger: 'example.blue.',
          amount: '1',
          data: {
            ilp_header: {
              account: 'example.red.bob',
              amount: '2',
              data: {
                foo: 'bar'
              }
            }
          }
        })
        done()
      })
      .catch(done)
    })

    describe('same-ledger transfers', function () {
      it('sends a same-ledger transfer', function (done) {
        const spy = sinon.spy(this.client.plugin, 'sendTransfer')

        this.client.sendQuotedPayment({
          sourceAmount: '1',
          destinationAmount: '1',
          destinationAccount: 'example.blue.bob',
          executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
          expiresAt: '2016-07-02T00:00:00.000Z',
          destinationMemo: { foo: 'bar' },
          uuid: 'abcdef'
        })
        .then(function () {
          assert.calledWithMatch(spy, {
            id: 'abcdef',
            account: 'example.blue.bob',
            ledger: 'example.blue.',
            amount: '1',
            executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
            expiresAt: '2016-07-02T00:00:00.000Z',
            data: {
              ilp_header: {
                account: 'example.blue.bob',
                amount: '1',
                data: { foo: 'bar' }
              }
            }
          })
          done()
        })
        .catch(done)
      })

      it('rejects if the source and destination amounts differ', function (done) {
        this.client.sendQuotedPayment({
          sourceAmount: '1',
          destinationAmount: '2',
          destinationAccount: 'example.blue.bob',
          executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
          expiresAt: '2016-07-02T00:00:00.000Z',
          destinationMemo: { foo: 'bar' },
          uuid: 'abcdef'
        })
        .catch(function (err) {
          assert.equal(err.message, 'sourceAmount and destinationAmount must be equivalent for local transfers')
          done()
        })
      })
    })
  })

  describe('getConnectors', function () {
    it('returns the configured connectors', function (done) {
      const client = new Client({_plugin: MockPlugin}, {connectors: ['foo']})
      client.getConnectors().then(function (connectors) {
        assert.deepEqual(connectors, ['foo'])
        done()
      }).catch(done)
    })

    it('returns plugin.getInfo().connectors if no connectors are configured', function (done) {
      const client = new Client({_plugin: MockPlugin})
      client.getConnectors().then(function (connectors) {
        assert.deepEqual(connectors, ['connector1'])
        done()
      }).catch(done)
    })

    it('returns [] if no connectors are found', function (done) {
      const client = new Client({_plugin: MockPlugin})
      client.plugin.getInfo = function () { return Promise.resolve({}) }
      client.getConnectors().then(function (connectors) {
        assert.deepEqual(connectors, [])
        done()
      }).catch(done)
    })
  })

  describe('_sendAndReceiveMessage', function () {
    it('rejects on timeout', function (done) {
      const client = new Client({_plugin: MockPlugin}, {messageTimeout: 10})
      const start = Date.now()
      client._sendAndReceiveMessage({
        ledger: 'example.blue.',
        account: 'example.blue.mark',
        data: {}
      }).then((response) => {
        assert(false)
      }).catch((err) => {
        assert.equal(err.message, 'Timed out while awaiting response message')
        assert(Date.now() - start >= 10)
        done()
      }).catch(done)
    })
  })

  describe('events', function () {
    beforeEach(function () {
      this.client = new Client({
        _plugin: MockPlugin
      })
    })

    const testEvent = (client, name) => {
      const incoming = new Promise(resolve =>
        client.on('incoming_' + name, resolve))
      const outgoing = new Promise(resolve =>
        client.on('outgoing_' + name, resolve))

      client.plugin.emit('incoming_' + name)
      client.plugin.emit('outgoing_' + name)

      return Promise.all([incoming, outgoing])
        // make sure the tests don't pass if the error is logged
        .catch((e) => { console.error; throw e })
    }

    it('should emit `*_transfer` from plugin', function (done) {
      testEvent(this.client, 'transfer')
        .then(() => {
          done()
        })
    })

    it('should emit `*_prepare` from plugin', function (done) {
      testEvent(this.client, 'prepare')
        .then(() => {
          done()
        })
    })

    it('should emit `*_fulfill` from plugin', function (done) {
      testEvent(this.client, 'fulfill')
        .then(() => {
          done()
        })
    })

    it('should emit `*_cancel` from plugin', function (done) {
      testEvent(this.client, 'cancel')
        .then(() => {
          done()
        })
    })

    it('should emit `*_reject` from plugin', function (done) {
      testEvent(this.client, 'reject')
        .then(() => {
          done()
        })
    })

    it('should emit `incoming_message` from plugin', function (done) {
      const incoming = new Promise((resolve) =>
        this.client.on('incoming_message', resolve))
      this.client.plugin.emit('incoming_message')
      incoming.then(() => { done() }).catch(done)
    })
  })
})

function makeSendMessage (request, response) {
  return function (message) {
    request.data.id = response.data.id = message.data.id
    assert.deepEqual(message, request)
    process.nextTick(() => {
      this.emit('incoming_message', response)
    })
    return Promise.resolve(null)
  }
}

function makeSendQuoteMessage (quoteRequestBody, quoteResponseBody, connector) {
  connector = connector || 'example.blue.connector1'
  return makeSendMessage({
    ledger: 'example.blue.',
    account: connector,
    data: {
      method: 'quote_request',
      data: quoteRequestBody
    }
  }, {
    ledger: 'example.blue.',
    account: connector,
    data: {
      method: 'quote_response',
      data: quoteResponseBody
    }
  })
}

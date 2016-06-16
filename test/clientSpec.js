'use strict'

const sinon = require('sinon')
const chai = require('chai')
sinon.assert.expose(chai.assert, { prefix: '' })
const chaiAsPromised = require('chai-as-promised')
const assert = chai.assert
chai.use(chaiAsPromised)

const mockRequire = require('mock-require')

const ilpCore = require('..')
const Client = ilpCore.Client
const Payment = ilpCore.Payment
const MockPlugin = require('./mocks/mock-plugin')

describe('Client', function () {
  beforeEach(function () {
    mockRequire('ilp-plugin-mock', MockPlugin)
  })

  afterEach(function () {
    mockRequire.stopAll()
  })

  describe('constructor', function () {
    it('should instantiate the ledger plugin', function () {
      const client = new Client({
        type: 'mock'
      })

      assert.instanceOf(client, Client)
      assert.instanceOf(client.getPlugin(), MockPlugin)
    })

    it('should fail if the ledger plugin does not exist', function () {
      assert.throws(() => {
        return new Client({
          type: 'fake',
          auth: {
            mock: true
          }
        })
      }, 'Cannot find module \'ilp-plugin-fake\'')
    })
  })

  describe('connect', function () {
    it('should call connect on the plugin', function * () {
      const client = new Client({
        type: 'mock'
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
        type: 'mock'
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
        type: 'mock'
      })
      const stubDisconnect = sinon.stub(client.getPlugin(), 'fulfillCondition')

      client.fulfillCondition({ foo: true }, 'cf:0:')

      sinon.assert.calledOnce(stubDisconnect)
      sinon.assert.calledWith(stubDisconnect, { foo: true }, 'cf:0:')
      stubDisconnect.restore()
    })
  })

  describe('createPayment', function () {
    beforeEach(function () {
      this.client = new Client({
        type: 'mock'
      })
    })

    it('should create a new Payment object', function () {
      const payment = this.client.createPayment({
        destinationAmount: '1',
        destinationAccount: 'https://red.ilpdemo.org/ledger/accounts/alice',
        destinationLedger: 'https://red.ilpdemo.org/ledger'
      })

      assert.instanceOf(payment, Payment)
    })
  })

  describe('waitForConnection', function () {
    it('should return a rejected promise if not currently connecting', function * () {
      const client = new Client({
        type: 'mock'
      })

      client.disconnect()
      const promise = client.waitForConnection()

      yield assert.isRejected(promise)
    })
  })

  describe('use', function () {
    beforeEach(function () {
      this.client = new Client({
        type: 'mock'
      })
    })

    it('should throw an error if the Extension class does not have static getName method', function () {
      const client = this.client
      function Extension () {}
      assert.throws(function () {
        client.use(Extension)
      }, 'Extension class must have a static getName method')
    })

    it('should throw an error if Extension.getName does not return a string', function () {
      const client = this.client
      function Extension () {}
      Extension.getName = function () { return null }
      assert.throws(function () {
        client.use(Extension)
      }, 'Extension.getName must return a string')
    })

    it('should call the Extension constructor with the client instance', function () {
      function Extension () {}
      Extension.getName = function () { return 'test' }
      const objUsedForSinonToWork = {
        Extension: Extension
      }
      const spy = sinon.spy(objUsedForSinonToWork, 'Extension')
      this.client.use(objUsedForSinonToWork.Extension)
      assert.calledWith(spy, this.client)
      spy.restore()
    })

    it('should make all Extension functions available via client[name]', function () {
      function testMethod () { return true }
      function Extension () {}
      Extension.getName = function () { return 'test' }
      Extension.prototype.method = testMethod
      this.client.use(Extension)
      assert.typeOf(this.client.test.method, 'function')
      assert.isTrue(this.client.test.method())
    })
  })
})

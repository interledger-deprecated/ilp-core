'use strict'

const sinon = require('sinon')
const chai = require('chai')
sinon.assert.expose(chai.assert, { prefix: '' })
const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const assert = chai.assert

const mockRequire = require('mock-require')
const MockPlugin = require('./mocks/mock-plugin')

const MockClient = require('./mocks/mock-client')
const Core = require('../src/lib/core')

describe('Core', function () {
  beforeEach(function () {
    mockRequire('ilp-plugin-mock', MockPlugin)
    this.core = new Core()
  })

  afterEach(function () {
    mockRequire.stopAll()
  })

  describe('constructor', function () {
    it('should instantiate a Core', function () {
      const core = new Core()
      assert.instanceOf(core, Core)
      assert.deepEqual(core.clientList, [])
      assert.deepEqual(core.clients, {})
    })
  })

  describe('resolve', function () {
    it('returns the corresponding Client', function () {
      const client1 = new MockClient({id: 'http://ledger1.mock'})
      const client2 = new MockClient({id: 'http://ledger2.mock'})
      this.core.addClient(client1)
      this.core.addClient(client2)
      assert.equal(this.core.resolve('http://ledger1.mock'), client1)
      assert.equal(this.core.resolve('http://ledger2.mock'), client2)
    })

    it('returns null if no Client matches', function () {
      assert.strictEqual(this.core.resolve('http://ledger1.mock'), null)
    })
  })

  describe('resolvePlugin', function () {
    it('returns the corresponding plugin', function () {
      const client1 = new MockClient({id: 'http://ledger1.mock'})
      const client2 = new MockClient({id: 'http://ledger2.mock'})
      this.core.addClient(client1)
      this.core.addClient(client2)
      assert.equal(this.core.resolvePlugin('http://ledger1.mock'), client1.plugin)
      assert.equal(this.core.resolvePlugin('http://ledger2.mock'), client2.plugin)
    })

    it('returns null if there is no match', function () {
      assert.strictEqual(this.core.resolvePlugin('http://ledger1.mock'), null)
    })
  })

  describe('isLocalAddress', function () {
    it('returns true if a client matches', function () {
      this.core.addClient(new MockClient({id: 'http://ledger1.mock'}))
      assert.strictEqual(this.core.isLocalAddress('http://ledger1.mock'), true)
    })

    it('returns false if no client matches', function () {
      assert.strictEqual(this.core.isLocalAddress('http://ledger1.mock'), false)
    })
  })

  describe('getClients', function () {
    it('returns a list of clients', function () {
      const client1 = new MockClient({id: 'http://ledger1.mock'})
      const client2 = new MockClient({id: 'http://ledger2.mock'})
      this.core.addClient(client1)
      this.core.addClient(client2)
      assert.deepEqual(this.core.getClients(), [client1, client2])
    })

    it('returns [] when there are no clients', function () {
      assert.deepEqual(this.core.getClients(), [])
    })
  })

  describe('addClient', function () {
    it('propagates events', function (done) {
      const client1 = new MockClient({id: 'http://ledger1.mock'})
      this.core.addClient(client1)
      this.core.on('foobar', function (client, arg1, arg2, arg3) {
        assert.equal(client, client1)
        assert.equal(arg1, 1)
        assert.equal(arg2, 2)
        assert.equal(arg3, 3)
        done()
      })
      client1.emit('foobar', 1, 2, 3)
    })
  })

  describe('connect', function () {
    it('connects all clients', function * () {
      const client1 = new MockClient({id: 'http://ledger1.mock'})
      const client2 = new MockClient({id: 'http://ledger2.mock'})
      this.core.addClient(client1)
      this.core.addClient(client2)

      const spy1 = sinon.spy(client1, 'connect')
      const spy2 = sinon.spy(client2, 'connect')
      yield this.core.connect()
      assert.calledOnce(spy1)
      assert.calledOnce(spy2)
    })
  })

  describe('disconnect', function () {
    it('disconnects all clients', function * () {
      const client1 = new MockClient({id: 'http://ledger1.mock'})
      const client2 = new MockClient({id: 'http://ledger2.mock'})
      this.core.addClient(client1)
      this.core.addClient(client2)

      const spy1 = sinon.spy(client1, 'disconnect')
      const spy2 = sinon.spy(client2, 'disconnect')
      yield this.core.disconnect()
      assert.calledOnce(spy1)
      assert.calledOnce(spy2)
    })
  })
})

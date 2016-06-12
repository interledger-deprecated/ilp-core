'use strict'

const nock = require('nock')
const sinon = require('sinon')
const mock = require('mock-require')
const assert = require('chai').assert
const uuid = require('uuid')

const MockPlugin = require('./mocks/mock-plugin')

const ilpCore = require('..')
const Client = ilpCore.Client

describe('Payment', function () {
  beforeEach(function () {
    mock('ilp-plugin-mock', MockPlugin)
  })

  afterEach(function () {
    mock.stopAll()
  })

  beforeEach(function () {
    this.client = new Client({
      type: 'mock'
    })

    this.payment = this.client.createPayment({
      destinationAmount: '1',
      destinationAccount: 'http://red.example/accounts/alice',
      destinationLedger: 'http://red.example',
      destinationMemo: {
        hello: 'world'
      }
    })
  })

  describe('quote', function () {
    it('should request a quote from neighboring connectors', function * () {
      nock('http://connector.example')
        .get('/quote')
        .query({
          source_ledger: 'mock:',
          destination_ledger: 'http://red.example',
          destination_amount: '1'
        })
        .reply(200, { foo: true })

      const quote = yield this.payment.quote()

      assert.deepEqual(quote, { foo: true })
    })
  })

  describe('sendQuoted', function () {
    beforeEach(function () {
      this.stubUuid = sinon.stub(uuid, 'v4')
      this.stubUuid.returns('3521a290-98f1-4d5f-95e2-ee06ac1ae5fe')
    })

    afterEach(function () {
      this.stubUuid.restore()
    })

    it('description', function * () {
      const stubSend = sinon.stub(MockPlugin.prototype, 'send')
      this.payment.sendQuoted({
        source_amount: '10',
        source_connector_account: 'bob',
        destination_amount: '9'
      })

      sinon.assert.calledOnce(stubSend)
      sinon.assert.calledWith(stubSend, {
        id: '3521a290-98f1-4d5f-95e2-ee06ac1ae5fe',
        ledger: 'mock:',
        account: 'bob',
        amount: '10',
        data: {
          ilp_header: {
            account: 'http://red.example/accounts/alice',
            amount: '9',
            ledger: 'http://red.example',
            data: {
              hello: 'world'
            }
          }
        }
      })

      sinon.assert.calledOnce(this.stubUuid)

      stubSend.restore()
    })
  })
})

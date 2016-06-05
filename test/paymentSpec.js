'use strict'

const nock = require('nock')
const mockRequire = require('mock-require')
const assert = require('chai').assert

const ilpCore = require('..')
const Client = ilpCore.Client
// const Payment = ilpCore.Payment
const MockPlugin = require('./mocks/mock-plugin')

describe('Payment', function () {
  beforeEach(function () {
    mockRequire('ilp-plugin-mock', MockPlugin)
  })

  afterEach(function () {
    mockRequire.stopAll()
  })

  beforeEach(function () {
    this.client = new Client({
      type: 'mock'
    })

    this.payment = this.client.createPayment({
      destinationAmount: '1',
      destinationAccount: 'http://red.example/accounts/alice',
      destinationLedger: 'http://red.example'
    })
  })

  describe('quote', function () {
    it('should request a quote from neighboring connectors', function * () {
      nock('http://connector.example')
        .get('/quote')
        .query({
          destination_ledger: 'http://red.example',
          destination_amount: '1'
        })
        .reply(200, { foo: true })

      const quote = yield this.payment.quote()

      assert.deepEqual(quote, { foo: true })
    })
  })
})

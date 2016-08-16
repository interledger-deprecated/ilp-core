'use strict'

const request = require('superagent')

exports.getQuote = function * (connector, query) {
  try {
    const res = yield request.get(connector + '/quote').query(query)
    return res.body
  } catch (err) {
    if (!err.response || err.response.body.id !== 'AssetsNotTradedError') throw err
  }
}

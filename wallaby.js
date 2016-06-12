module.exports = function (wallaby) {
  return {
    files: [
      'src/**/*.js',
      'index.js',
      'test/mocks/*.js'
    ],

    tests: [
      'test/*Spec.js'
    ],

    testFramework: 'mocha',

    env: {
      type: 'node',
      runner: 'node',
      params: {
        env: 'NODE_ENV=unit'
      }
    },

    bootstrap: function () {
      require('co-mocha')(wallaby.testFramework.constructor)
    }
  }
}

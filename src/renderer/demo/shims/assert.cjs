function assert(value, message) {
    if (!value) throw new Error(message || '条件を満たしていません')
}
assert.ok = assert
assert.strictEqual = function (a, b, message) {
    if (a !== b) throw new Error(message || String(a) + ' と ' + String(b) + ' が一致しません')
}
assert.equal = assert.strictEqual
assert.doesNotThrow = function (fn) {
    fn()
}
module.exports = assert

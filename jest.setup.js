// Add BigInt serialization support for Jest
BigInt.prototype.toJSON = function() {
  return this.toString();
};
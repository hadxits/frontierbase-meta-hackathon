const DI = require("@/di-symbol");
const PopBillClient = require("@/popbill/PopBillClient");

let instance = null;

const services = {};

class Injector {
  constructor() {
    if (instance !== null) {
      return instance;
    }

    this.#registerService(DI.popBillClient, new PopBillClient());

    instance = this;
  }

  #registerService(symbol, instance) {
    services[symbol] = instance;
  }

  /**
   * Injector로부터 관리되는 객체를 가져옵니다.
   * @param symbol di-symbol.js에 정의된 심볼
   */
  get(symbol) {
    const service = services[symbol];
    if (!service) {
      throw new Error(`Service not found: ${symbol.toString()}`);
    }
    return service;
  }
}

module.exports = Injector;
/**
 * Injector로부터 관리될 객체들의 심볼입니다.
 */
const DI = {
  popBillClient: Symbol('popBillClient'),
  notificationService: Symbol('notificationService')
};

module.exports = DI;
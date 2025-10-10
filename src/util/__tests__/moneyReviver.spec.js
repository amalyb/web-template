import { types as sdkTypes } from '../sdkLoader';
import { deepReviveMoney, reviveSdkMoney } from '../../index';

const { Money } = sdkTypes;

describe('Money reviver utilities', () => {
  test('reviveSdkMoney converts plain Money objects', () => {
    const jsonMoney = { _sdkType: 'Money', amount: 5000, currency: 'USD' };
    const revived = reviveSdkMoney(jsonMoney);
    
    expect(revived instanceof Money).toBe(true);
    expect(revived.amount).toBe(5000);
    expect(revived.currency).toBe('USD');
  });

  test('reviveSdkMoney returns non-Money objects unchanged', () => {
    const plainObject = { foo: 'bar' };
    const result = reviveSdkMoney(plainObject);
    
    expect(result).toBe(plainObject);
  });

  test('reviveSdkMoney returns already-instantiated Money unchanged', () => {
    const money = new Money(5000, 'USD');
    const result = reviveSdkMoney(money);
    
    expect(result).toBe(money);
  });

  test('deepReviveMoney revives plain Money objects after JSON hydration', () => {
    const jsonMoney = { _sdkType: 'Money', amount: 5000, currency: 'USD' };
    const revived = deepReviveMoney(JSON.parse(JSON.stringify(jsonMoney)));
    
    expect(revived instanceof Money).toBe(true);
    expect(revived.amount).toBe(5000);
    expect(revived.currency).toBe('USD');
  });

  test('deepReviveMoney handles nested Money in objects', () => {
    const data = {
      listing: {
        price: { _sdkType: 'Money', amount: 10000, currency: 'EUR' },
      },
      transaction: {
        payinTotal: { _sdkType: 'Money', amount: 12000, currency: 'EUR' },
      },
    };
    
    const revived = deepReviveMoney(JSON.parse(JSON.stringify(data)));
    
    expect(revived.listing.price instanceof Money).toBe(true);
    expect(revived.listing.price.amount).toBe(10000);
    expect(revived.transaction.payinTotal instanceof Money).toBe(true);
    expect(revived.transaction.payinTotal.amount).toBe(12000);
  });

  test('deepReviveMoney handles Money in arrays', () => {
    const data = {
      lineItems: [
        { unitPrice: { _sdkType: 'Money', amount: 1000, currency: 'USD' } },
        { unitPrice: { _sdkType: 'Money', amount: 2000, currency: 'USD' } },
      ],
    };
    
    const revived = deepReviveMoney(JSON.parse(JSON.stringify(data)));
    
    expect(revived.lineItems[0].unitPrice instanceof Money).toBe(true);
    expect(revived.lineItems[0].unitPrice.amount).toBe(1000);
    expect(revived.lineItems[1].unitPrice instanceof Money).toBe(true);
    expect(revived.lineItems[1].unitPrice.amount).toBe(2000);
  });

  test('deepReviveMoney handles circular references safely', () => {
    const data = { foo: 'bar' };
    data.self = data;
    
    const result = deepReviveMoney(data);
    
    expect(result).toBe(data);
    expect(result.self).toBe(data);
  });

  test('deepReviveMoney handles null and undefined', () => {
    expect(deepReviveMoney(null)).toBe(null);
    expect(deepReviveMoney(undefined)).toBe(undefined);
  });

  test('deepReviveMoney handles primitives', () => {
    expect(deepReviveMoney('string')).toBe('string');
    expect(deepReviveMoney(123)).toBe(123);
    expect(deepReviveMoney(true)).toBe(true);
  });
});


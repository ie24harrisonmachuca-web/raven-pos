import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoApi} from '../public/demo-api.js';
const path = action => 't/restaurante-demo/' + action;
const post = (api, action, body) => api(path(action), {method: 'POST', body});
const state = api => api(path('state'));
const draft = quantity => ({table_id: 'table-1', items: [{product_id: 'burger', quantity}], discount: 0, guests: 2});

test('Demo: caja cerrada bloquea pedidos y no cambia stock', async () => {
  const api = createDemoApi();
  await assert.rejects(post(api, 'orders', draft(2)), /Abre la caja/);
  const s = await state(api);
  assert.equal(s.cash_open, false);
  assert.equal(s.products.find(p => p.id === 'burger').stock, 24);
  assert.equal(s.orders.length, 0);
});

test('Demo: guardar reconcilia stock; pago no descuenta dos veces y libera mesa', async () => {
  const api = createDemoApi();
  await post(api, 'cash/open', {opening: 10000});
  let order = await post(api, 'orders', draft(2));
  assert.equal((await state(api)).products.find(p => p.id === 'burger').stock, 22);
  order = await post(api, 'orders/' + order.id, {...order, items: [{product_id: 'burger', quantity: 1}], send_kitchen: true});
  assert.equal((await state(api)).products.find(p => p.id === 'burger').stock, 23);
  const paid = await post(api, 'checkout/' + order.id, {version: order.version, payments: [{method: 'efectivo', amount: 2400, received: 3000}], tip: 0});
  const s = await state(api);
  assert.equal(s.products.find(p => p.id === 'burger').stock, 23);
  assert.equal(s.orders.length, 0);
  assert.equal(s.shift.expected, 12400);
  assert.equal(s.sales[0].payments[0].change, 600);
  assert.equal((await api(path('receipt/' + paid.order_id))).order.items[0].quantity, 1);
  await assert.rejects(post(api, 'checkout/' + order.id, {version: order.version, payments: [{method: 'efectivo', amount: 2400}]}), /cerrado/);
});

test('Demo: una orden sin stock no aplica descuentos parciales al inventario', async () => {
  const api = createDemoApi();
  await post(api, 'cash/open', {opening: 0});
  await assert.rejects(post(api, 'orders', {items: [{product_id: 'burger', quantity: 2}, {product_id: 'pizza', quantity: 30}]}), /Stock insuficiente/);
  const s = await state(api);
  assert.equal(s.products.find(p => p.id === 'burger').stock, 24);
  assert.equal(s.products.find(p => p.id === 'pizza').stock, 18);
  assert.equal(s.orders.length, 0);
});

test('Demo: cotización reserva al convertir; cocina valida versión y transición', async () => {
  const api = createDemoApi();
  await post(api, 'cash/open', {opening: 0});
  let order = await post(api, 'orders', {...draft(2), table_id: null, status: 'quote'});
  assert.equal((await state(api)).products.find(p => p.id === 'burger').stock, 24);
  order = await post(api, 'orders/' + order.id, {...order, status: 'open', send_kitchen: true});
  assert.equal((await state(api)).products.find(p => p.id === 'burger').stock, 22);
  await assert.rejects(post(api, 'kitchen/' + order.id, {version: order.version, status: 'ready'}), /estado/);
  await post(api, 'kitchen/' + order.id, {version: order.version, status: 'preparing'});
  assert.equal((await state(api)).orders[0].kitchen, 'preparing');
  await assert.rejects(post(api, 'kitchen/' + order.id, {version: order.version, status: 'ready'}), /cambió/);
});

test('Demo: sesiones aisladas, lecturas copiadas y credenciales no admitidas', async () => {
  const one = createDemoApi(), two = createDemoApi();
  await post(one, 'cash/open', {opening: 0});
  await post(one, 'orders', draft(2));
  const untouched = await state(two);
  assert.equal(untouched.cash_open, false);
  assert.equal(untouched.orders.length, 0);
  untouched.products[0].stock = -10;
  assert.equal((await state(two)).products[0].stock, 24);
  await assert.rejects(one('login', {method: 'POST', body: {email: 'a', password: 'b'}}), /no solicita/);
  await assert.rejects(post(one, 'users', {name: 'No crear'}), /No se crean usuarios/);
});

test('Demo: compras, cambios de identidad y anulación permanecen en la sesión', async () => {
  const api = createDemoApi();
  await post(api, 'purchases', {product_id: 'burger', quantity: 4, total: 5000});
  await post(api, 'settings', {name: 'Café de prueba', legal_name: '', document: '', address: '', logo: ''});
  await post(api, 'cash/open', {opening: 0});
  const order = await post(api, 'orders', draft(2));
  const sale = await post(api, 'checkout/' + order.id, {version: order.version, payments: [{method: 'efectivo', amount: 4800}], tip: 0});
  await post(api, 'void/' + sale.id, {reason: 'Ensayo'});
  const s = await state(api);
  assert.equal(s.tenant.name, 'Café de prueba');
  assert.equal(s.products.find(p => p.id === 'burger').stock, 28);
  assert.equal(s.shift.expected, 0);
  assert.equal(s.sales[0].status, 'void');
  await assert.rejects(post(api, 'void/' + sale.id, {reason: 'Otra vez'}), /anulada/);
});

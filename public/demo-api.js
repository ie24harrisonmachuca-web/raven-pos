// An isolated, browser-only transport for the real POS screens. Nothing is sent to a server.
const copy = value => structuredClone(value);
const time = () => new Date().toISOString();
const integer = (value, min = 0, max = 100000000) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error('Revisa el importe o la cantidad.');
  return value;
};
const required = value => {
  const result = String(value ?? '').trim();
  if (!result) throw Error('Completa los campos requeridos.');
  return result.slice(0, 1000);
};

export function createDemoApi() {
  let sequence = 100;
  const id = () => 'demo-' + (++sequence);
  const owner = {id: 'demo-user', name: 'Usuario de demostración', email: 'demo@example.invalid'};
  const company = {id: 'demo-tenant', slug: 'restaurante-demo', name: 'Restaurante de ejemplo', status: 'active', expires_at: new Date(Date.now() + 86400000).toISOString(), role: 'admin'};
  const data = {
    tenant: {...company, legal_name: 'Negocio ficticio', document: '', address: '', logo: ''}, role: 'admin',
    permissions: ['orders', 'checkout', 'void', 'tables', 'kitchen', 'products', 'contacts', 'purchases', 'cash', 'reports', 'settings'],
    products: [
      ['burger', 'Hamburguesa clásica', 'Platos', 2400, 1100, 24, 'burger'],
      ['pizza', 'Pizza artesanal', 'Platos', 3600, 1600, 18, 'pizza'],
      ['salad', 'Ensalada de la casa', 'Platos', 2200, 800, 20, 'salad'],
      ['coffee', 'Cappuccino', 'Bebidas', 900, 300, 40, 'coffee'],
      ['limonada', 'Limonada fresca', 'Bebidas', 800, 250, 30, ''],
      ['postre', 'Postre del día', 'Postres', 1400, 500, 16, ''],
    ].map(([id, name, category, price, cost, stock, image]) => ({id, name, category, price, cost, stock, image, version: 1, active: 1, track_stock: 1})),
    tables: Array.from({length: 8}, (_, n) => ({id: 'table-' + (n + 1), name: String(n + 1).padStart(2, '0'), area: n < 6 ? 'Salón principal' : 'Terraza', capacity: 4, active: 1})),
    contacts: [{id: 'contact-demo', name: 'Cliente de ejemplo', type: 'cliente', document_type: 'SIN DOCUMENTO', document: '', address: '', email: '', phone: ''}],
    orders: [], sales: [], purchases: [], shifts: [], movements: [], audit: [], users: [],
  };
  const orders = new Map();
  const reservations = new Map();
  const find = (list, key) => {
    const result = list.find(item => item.id === key);
    if (!result) throw Error('No se encontró el registro de ejemplo.');
    return result;
  };
  const shift = () => data.shifts.find(s => s.status === 'open');
  const requireCash = () => {
    const current = shift();
    if (!current) throw Error('Abre la caja de demostración antes de registrar la operación.');
    return current;
  };
  const expected = current => current.opening + data.movements.filter(m => m.shift_id === current.id).reduce((sum, m) => sum + m.amount, 0);
  const log = (action, target) => data.audit.unshift({id: id(), action, target, created_at: time()});
  const order = key => {
    const result = orders.get(key);
    if (!result) throw Error('No se encontró el pedido de ejemplo.');
    return result;
  };
  const checkVersion = (record, body) => {
    if (record.version !== body.version) throw Error('El registro cambió. Actualiza la vista antes de continuar.');
  };
  function reserve(key, items) {
    const before = reservations.get(key) || new Map();
    const after = new Map(items.filter(line => line.track_stock).map(line => [line.product_id, line.quantity]));
    const changes = new Map([...new Set([...before.keys(), ...after.keys()])].map(pid => [pid, (after.get(pid) || 0) - (before.get(pid) || 0)]));
    // Validate the entire change before applying it, so a rejected order leaves no partial stock update.
    for (const [pid, quantity] of changes) {
      const product = find(data.products, pid);
      if (quantity > product.stock) throw Error('Stock insuficiente: ' + product.name);
    }
    for (const [pid, quantity] of changes) if (quantity) {
      const product = find(data.products, pid);
      product.stock -= quantity;
      product.version++;
    }
    reservations.set(key, after);
  }
  function snapshot() {
    const current = shift();
    return copy({...data, orders: [...orders.values()].filter(o => ['open', 'quote'].includes(o.status)), cash_open: !!current, shift: current ? {...current, expected: expected(current)} : null});
  }
  function movement(current, amount, reason) {
    data.movements.unshift({id: id(), shift_id: current.id, amount, reason, created_at: time()});
  }
  return async function demoApi(path, {method = 'GET', body = {}} = {}) {
    if (path === 'me' && method === 'GET') return copy({user: owner, csrf: '', tenants: [{...company, name: data.tenant.name}]});
    if (path === 'logout') return {ok: true};
    if (path === 'login') throw Error('La demostración no solicita ni valida credenciales.');
    const route = /^t\/restaurante-demo\/([a-z]+)(?:\/([^/]+))?$/.exec(path);
    if (!route) throw Error('Esta función no está disponible en la demostración.');
    const [, action, key] = route;
    if (method === 'GET') {
      if (action === 'state') return snapshot();
      if (action === 'receipt') {
        const current = order(key), sale = data.sales.find(s => s.order_id === key);
        return copy({settings: data.tenant, order: current, sale: sale || null, customer: data.contacts.find(c => c.id === current.customer_id) || null});
      }
      throw Error('Esta consulta no está disponible en la demostración.');
    }
    if (method !== 'POST') throw Error('Operación de demostración no válida.');
    if (action === 'cash') {
      if (key === 'open') {
        if (shift()) throw Error('La caja de demostración ya está abierta.');
        const current = {id: id(), status: 'open', opening: integer(body.opening), opened_at: time()};
        data.shifts.unshift(current);
        return {id: current.id};
      }
      const current = requireCash();
      if (key === 'movement') {
        const amount = integer(body.amount, 1) * (body.type === 'out' ? -1 : 1);
        if (!['in', 'out'].includes(body.type)) throw Error('Selecciona entrada o salida.');
        if (expected(current) + amount < 0) throw Error('La salida supera el efectivo disponible.');
        movement(current, amount, required(body.reason));
      } else if (key === 'close') {
        const counted = integer(body.counted);
        Object.assign(current, {status: 'closed', expected: expected(current), counted, difference: counted - expected(current), closed_at: time()});
      } else throw Error('Acción de caja no disponible.');
      return {id: current.id};
    }
    if (action === 'orders') {
      requireCash();
      const prior = key ? order(key) : null;
      if (prior) {
        checkVersion(prior, body);
        if (!['open', 'quote'].includes(prior.status)) throw Error('El pedido ya está cerrado.');
      }
      if (body.cancel) {
        if (!prior) throw Error('Selecciona un pedido.');
        required(body.reason);
        reserve(key, []);
        Object.assign(prior, {status: 'cancelled', version: prior.version + 1, updated_at: time()});
        return {id: key};
      }
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) throw Error('Agrega entre 1 y 100 productos.');
      const status = body.status === 'quote' ? 'quote' : 'open';
      const tableId = body.table_id || null;
      if (tableId) {
        if (!find(data.tables, tableId).active) throw Error('La mesa está desactivada.');
        if (status === 'quote') throw Error('Una cotización no ocupa una mesa.');
        if ([...orders.values()].some(o => o.id !== key && o.table_id === tableId && o.status === 'open')) throw Error('La mesa ya tiene un pedido abierto.');
      }
      const seen = new Set();
      const items = body.items.map(line => {
        if (seen.has(line.product_id)) throw Error('Modifica la cantidad del producto sin repetirlo.');
        seen.add(line.product_id);
        const product = find(data.products, line.product_id), previous = prior?.items.find(i => i.product_id === product.id);
        if (!product.active) throw Error('El producto está desactivado.');
        return {product_id: product.id, name: previous?.name || product.name, price: previous?.price ?? product.price, quantity: integer(line.quantity, 1, 999), track_stock: previous?.track_stock ?? !!product.track_stock, note: String(line.note || '').slice(0, 250)};
      });
      const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const discount = integer(body.discount || 0, 0, subtotal);
      const guests = integer(body.guests || 1, 1, 100);
      const oid = key || id();
      reserve(oid, status === 'open' ? items : []);
      const current = {id: oid, number: prior?.number || orders.size + 1, table_id: tableId, customer_id: body.customer_id || null, status, items, total: subtotal - discount, discount, notes: String(body.notes || '').slice(0, 1000), guests, version: (prior?.version || 0) + 1, kitchen: status === 'quote' ? 'draft' : body.send_kitchen ? 'received' : prior?.kitchen || 'draft', created_by: owner.id, created_at: prior?.created_at || time(), updated_at: time(), can_edit: true, owner_name: owner.name};
      orders.set(oid, current); log('Pedido de demostración guardado', oid);
      return copy(current);
    }
    if (action === 'checkout') {
      const current = requireCash(), existing = order(key);
      if (existing.status !== 'open') throw Error('Este pedido ya fue cobrado o está cerrado.');
      checkVersion(existing, body);
      const tip = integer(body.tip || 0), due = existing.total + tip;
      if (!Array.isArray(body.payments) || !body.payments.length || body.payments.length > 10) throw Error('Registra al menos un pago.');
      const payments = body.payments.map(p => {
        if (!['efectivo', 'tarjeta', 'yape', 'plin', 'transferencia'].includes(p.method)) throw Error('Medio de pago no válido.');
        const amount = integer(p.amount, due === 0 ? 0 : 1), received = integer(p.received ?? amount, amount);
        if (p.method !== 'efectivo' && received !== amount) throw Error('El vuelto solo corresponde al efectivo.');
        return {method: p.method, amount, received, change: received - amount};
      });
      if (payments.reduce((sum, p) => sum + p.amount, 0) !== due) throw Error('Los pagos deben coincidir con el pedido más la propina.');
      const sale = {id: id(), number: data.sales.length + 1, order_id: key, shift_id: current.id, total: existing.total, tip, payments, status: 'paid', created_at: time(), items: copy(existing.items), discount: existing.discount, customer_id: existing.customer_id, table_id: existing.table_id};
      data.sales.unshift(sale);
      existing.status = 'paid'; existing.version++;
      const cash = payments.filter(p => p.method === 'efectivo').reduce((sum, p) => sum + p.amount, 0);
      if (cash) movement(current, cash, 'Venta de demostración ' + existing.number);
      log('Cobro de demostración registrado', sale.id);
      return {id: sale.id, order_id: key};
    }
    if (action === 'correction') {
      const current = requireCash(), sale = find(data.sales, key), existing = order(sale.order_id);
      if (sale.status !== 'paid' || sale.shift_id !== current.id) throw Error('La venta debe estar pagada y pertenecer a la caja abierta.');
      checkVersion(existing, body);
      required(body.reason, 500);
      if (!Array.isArray(body.quantities) || body.quantities.length !== existing.items.length) throw Error('Revisa las cantidades.');
      const items = existing.items.map((line, index) => ({...line, quantity: integer(body.quantities[index], 0, line.quantity)})).filter(line => line.quantity);
      if (!items.length || items.every((line, index) => line.quantity === existing.items[index].quantity) && items.length === existing.items.length) throw Error('Reduce al menos una cantidad y conserva un producto.');
      const subtotal = items.reduce((sum, line) => sum + line.quantity * line.price, 0);
      const discount = Math.min(existing.discount, subtotal), total = subtotal - discount, refund = sale.total - total;
      if (!Array.isArray(body.refunds) || body.refunds.length !== sale.payments.length) throw Error('Revisa las devoluciones.');
      const refunds = body.refunds.map((amount, index) => integer(amount, 0, sale.payments[index].amount));
      if (refunds.reduce((sum, amount) => sum + amount, 0) !== refund) throw Error('Las devoluciones deben sumar la diferencia.');
      const cash = refunds.reduce((sum, amount, index) => sum + (sale.payments[index].method === 'efectivo' ? amount : 0), 0);
      if (cash > expected(current)) throw Error('La caja no tiene saldo suficiente.');
      const payments = sale.payments.map((payment, index) => {
        if (!refunds[index]) return payment;
        const amount = payment.amount - refunds[index];
        return {...payment, amount, received: amount, change: 0};
      }).filter(payment => payment.amount > 0);
      reserve(sale.order_id, items);
      Object.assign(existing, {items, total, discount, version: existing.version + 1, updated_at: time()});
      Object.assign(sale, {items: copy(items), total, discount, payments});
      if (cash) movement(current, -cash, 'Corrección de venta ' + sale.number);
      log('Corrección de venta', key);
      return {id: key, order_id: sale.order_id, total, refund};
    }
    if (action === 'void') {
      const current = requireCash(), sale = find(data.sales, key);
      if (sale.status !== 'paid') throw Error('La venta ya está anulada.');
      if (sale.shift_id !== current.id) throw Error('La venta pertenece a una caja cerrada.');
      required(body.reason);
      const cash = sale.payments.filter(p => p.method === 'efectivo').reduce((sum, p) => sum + p.amount, 0);
      if (expected(current) < cash) throw Error('La caja no tiene saldo suficiente para devolver el efectivo.');
      reserve(sale.order_id, []);
      if (cash) movement(current, -cash, 'Anulación de demostración');
      sale.status = 'void'; sale.void_reason = body.reason; order(sale.order_id).status = 'void';
      return {id: key};
    }
    if (action === 'kitchen') {
      const existing = order(key);
      checkVersion(existing, body);
      if (existing.status !== 'open' || {received: 'preparing', preparing: 'ready', ready: 'served'}[existing.kitchen] !== body.status) throw Error('Actualiza el pedido antes de avanzar su estado.');
      existing.kitchen = body.status; existing.version++;
      return {id: key};
    }
    if (['products', 'tables', 'contacts'].includes(action)) {
      const list = data[action], old = key ? find(list, key) : null;
      const record = {...old, ...body, id: key || id()};
      record.name = required(body.name);
      if (action === 'products') {
        if (old) checkVersion(old, body);
        record.price = integer(body.price); record.cost = integer(body.cost || 0); record.stock = integer(body.stock);
        record.category = required(body.category); record.version = (old?.version || 0) + 1;
        record.image = ['burger', 'coffee', 'salad', 'pizza', ''].includes(body.image) ? body.image : '';
        record.active = body.active ? 1 : 0; record.track_stock = body.track_stock ? 1 : 0;
      }
      if (action === 'tables') {
        record.area = required(body.area); record.capacity = integer(body.capacity, 1, 100); record.active = body.active ? 1 : 0;
        if (!record.active && [...orders.values()].some(o => o.table_id === key && o.status === 'open')) throw Error('La mesa tiene un pedido abierto.');
      }
      if (action === 'contacts') {
        if ((body.document_type === 'DNI' && !/^\d{8}$/.test(body.document)) || (body.document_type === 'RUC' && !/^\d{11}$/.test(body.document))) throw Error('Revisa la cantidad de dígitos del documento.');
      }
      if (old) list[list.indexOf(old)] = record; else list.push(record);
      log('Registro de ejemplo actualizado', record.id);
      return {id: record.id, version: record.version};
    }
    if (action === 'purchases') {
      const product = find(data.products, body.product_id), quantity = integer(body.quantity, 1), total = integer(body.total, 1);
      const purchase = {...body, id: id(), quantity, total, created_at: time()};
      data.purchases.unshift(purchase); product.stock += quantity; product.version++;
      return {id: purchase.id};
    }
    if (action === 'settings') {
      const name = required(body.name);
      Object.assign(data.tenant, {name, legal_name: String(body.legal_name || ''), document: String(body.document || ''), address: String(body.address || ''), logo: /^data:image\/(png|jpeg|webp);base64,/.test(body.logo || '') ? String(body.logo).slice(0, 2800000) : ''});
      return {ok: true};
    }
    throw Error('Esta función requiere una cuenta activa del sistema. No se crean usuarios ni se envían datos desde la demostración.');
  };
}

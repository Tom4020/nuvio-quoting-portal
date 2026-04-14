/* Nuvio Quoting Portal — client
 * Renders the quotes / purchase orders / orders UI and talks to the Railway API.
 * All state is ephemeral; source of truth is the API.
 */
(function () {
  const root = document.getElementById('nuvio-quoting-portal');
  if (!root) return;

  const API = (root.dataset.apiBase || '').replace(/\/$/, '');
  const TOKEN = root.dataset.portalToken || '';
  const CURRENCY = root.dataset.currency || 'AUD';
  const TAX_RATE = Number(root.dataset.taxRate || 0.10);

  const fmt = n => `${CURRENCY} ${Number(n || 0).toFixed(2)}`;
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  async function api(path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'x-portal-token': TOKEN,
        ...(opts.headers || {})
      }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }
    return res.status === 204 ? null : res.json();
  }

  // ---------------- Tabs ----------------
  root.querySelectorAll('.qp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.qp-tab').forEach(t => t.classList.remove('qp-tab--active'));
      btn.classList.add('qp-tab--active');
      root.querySelectorAll('[data-panel]').forEach(p => p.classList.add('qp-hidden'));
      root.querySelector(`[data-panel="${btn.dataset.tab}"]`).classList.remove('qp-hidden');
      loadPanel(btn.dataset.tab);
    });
  });

  // ---------------- List renderers ----------------
  async function loadPanel(kind) {
    const list = root.querySelector(`[data-list="${kind}"]`);
    list.innerHTML = 'Loading…';
    try {
      if (kind === 'quotes') list.innerHTML = renderQuotes(await api('/api/quotes'));
      if (kind === 'purchase-orders') list.innerHTML = renderPOs(await api('/api/purchase-orders'));
      if (kind === 'orders') list.innerHTML = renderOrders(await api('/api/orders'));
    } catch (err) {
      list.innerHTML = `<div class="qp-error">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderQuotes(rows) {
    if (!rows.length) return emptyState('No quotes yet. Click “+ New quote” to create one.');
    return row(['Quote #','Customer','Status','Total','Created',''], true) + rows.map(q => `
      <div class="qp-row" data-open-quote="${q.id}">
        <div><strong>${escapeHtml(q.quote_number)}</strong></div>
        <div>${escapeHtml(q.customer_company || q.customer_name || '—')}<div class="qp-muted">${escapeHtml(q.customer_email || '')}</div></div>
        <div><span class="qp-status qp-status--${q.status}">${q.status}</span></div>
        <div>${fmt(q.total)}</div>
        <div class="qp-cell--hide-mobile">${new Date(q.created_at).toLocaleDateString()}</div>
        <div></div>
      </div>`).join('');
  }

  function renderPOs(rows) {
    if (!rows.length) return emptyState('No purchase orders yet.');
    return row(['PO #','Supplier','Status','Total','Expected',''], true) + rows.map(p => `
      <div class="qp-row" data-open-po="${p.id}">
        <div><strong>${escapeHtml(p.po_number)}</strong></div>
        <div>${escapeHtml(p.supplier_name || '—')}</div>
        <div><span class="qp-status qp-status--${p.status}">${p.status}</span></div>
        <div>${fmt(p.total)}</div>
        <div class="qp-cell--hide-mobile">${p.expected_date ? new Date(p.expected_date).toLocaleDateString() : '—'}</div>
        <div></div>
      </div>`).join('');
  }

  function renderOrders(rows) {
    if (!rows.length) return emptyState('No orders yet. Accepted quotes that get converted to Shopify draft orders will appear here once the customer pays.');
    return row(['Order #','Customer','Status','Total','Created',''], true) + rows.map(o => `
      <div class="qp-row">
        <div><strong>${escapeHtml(o.order_number || '—')}</strong></div>
        <div>${escapeHtml(o.customer_name || '—')}</div>
        <div><span class="qp-status qp-status--${o.status}">${o.status}</span></div>
        <div>${fmt(o.total)}</div>
        <div class="qp-cell--hide-mobile">${new Date(o.created_at).toLocaleDateString()}</div>
        <div></div>
      </div>`).join('');
  }

  function row(cells, head=false) {
    const cls = head ? 'qp-row qp-row--head' : 'qp-row';
    return `<div class="${cls}">${cells.map(c => `<div>${c}</div>`).join('')}</div>`;
  }
  function emptyState(msg) { return `<div style="padding:40px;text-align:center;color:#777">${escapeHtml(msg)}</div>`; }

  // Delegate row clicks
  root.addEventListener('click', e => {
    const q = e.target.closest('[data-open-quote]');
    if (q) return openQuote(q.dataset.openQuote);
    const p = e.target.closest('[data-open-po]');
    if (p) return openPO(p.dataset.openPo);
  });

  // ---------------- Modal helpers ----------------
  const modal = root.querySelector('[data-modal]');
  const modalBody = root.querySelector('[data-modal-body]');
  function openModal(html) { modalBody.innerHTML = html; modal.classList.remove('qp-hidden'); }
  function closeModal() { modal.classList.add('qp-hidden'); modalBody.innerHTML = ''; }
  modal.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // ---------------- Toolbar actions ----------------
  root.querySelector('[data-action="new-quote"]').addEventListener('click', () => openQuoteBuilder());
  root.querySelector('[data-action="new-po"]').addEventListener('click', () => openPOBuilder());

  // ---------------- Quote builder ----------------
  function openQuoteBuilder(initial = {}) {
    const state = {
      customer: initial.customer || { name:'', email:'', company:'', phone:'' },
      items: initial.items?.length ? initial.items : [{ title:'', quantity:1, unit_price:0, sku:'', shopify_variant_id:null }],
      discount: Number(initial.discount || 0),
      tax_rate: Number(initial.tax_rate || TAX_RATE),
      notes: initial.notes || '',
      valid_until: initial.valid_until || ''
    };

    render();

    function render() {
      const { subtotal, tax, total } = totals(state);
      openModal(`
        <h2 style="margin:0 0 16px">New quote</h2>
        <div class="qp-form-grid">
          <label>Customer name <input data-f="customer.name" value="${escapeHtml(state.customer.name)}" /></label>
          <label>Customer email <input type="email" data-f="customer.email" value="${escapeHtml(state.customer.email)}" /></label>
          <label>Company <input data-f="customer.company" value="${escapeHtml(state.customer.company)}" /></label>
          <label>Phone <input data-f="customer.phone" value="${escapeHtml(state.customer.phone)}" /></label>
          <label>Valid until <input type="date" data-f="valid_until" value="${escapeHtml(state.valid_until)}" /></label>
          <label>Tax rate (0-1) <input type="number" step="0.01" min="0" max="1" data-f="tax_rate" value="${state.tax_rate}" /></label>
          <label>Notes <textarea data-f="notes">${escapeHtml(state.notes)}</textarea></label>
        </div>

        <h3 style="margin:20px 0 8px">Line items</h3>
        <div class="qp-product-picker">
          <input class="qp-input" placeholder="Search Shopify products…" data-product-search style="width:100%" />
          <div class="qp-product-picker__results qp-hidden" data-product-results></div>
        </div>

        <table class="qp-items-table">
          <thead><tr>
            <th>Description</th><th>SKU</th>
            <th class="qp-col-qty">Qty</th>
            <th class="qp-col-price">Unit</th>
            <th class="qp-col-total">Total</th>
            <th></th>
          </tr></thead>
          <tbody data-items>
            ${state.items.map((it, i) => itemRow(it, i)).join('')}
          </tbody>
        </table>
        <button class="qp-btn" data-add-item style="margin-top:6px">+ Add blank line</button>

        <div class="qp-totals">
          <div class="qp-totals__box">
            <div>Subtotal</div><div class="qp-total-row--right">${fmt(subtotal)}</div>
            <div>Discount <input type="number" step="0.01" min="0" data-f="discount" value="${state.discount}" style="width:90px;padding:4px 6px;margin-left:6px" /></div>
            <div class="qp-total-row--right">-${fmt(state.discount)}</div>
            <div>Tax (${(state.tax_rate*100).toFixed(0)}%)</div><div class="qp-total-row--right">${fmt(tax)}</div>
            <div class="qp-total-row--grand">Total</div><div class="qp-total-row--right qp-total-row--grand">${fmt(total)}</div>
          </div>
        </div>

        <div class="qp-modal__actions">
          <button class="qp-btn" data-close-modal>Cancel</button>
          <button class="qp-btn qp-btn--primary" data-save-quote>Save quote</button>
        </div>
        <div class="qp-error qp-hidden" data-error></div>
      `);

      // Bind form fields
      modalBody.querySelectorAll('[data-f]').forEach(el => {
        el.addEventListener('input', () => {
          const path = el.dataset.f.split('.');
          let obj = state;
          for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
          obj[path[path.length-1]] = el.type === 'number' ? Number(el.value) : el.value;
          if (['discount','tax_rate'].includes(el.dataset.f)) render();
        });
      });

      // Item row bindings
      bindItemRows();

      // Add blank line
      modalBody.querySelector('[data-add-item]').addEventListener('click', () => {
        state.items.push({ title:'', quantity:1, unit_price:0, sku:'', shopify_variant_id:null });
        render();
      });

      // Close
      modalBody.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));

      // Product search
      const searchInput = modalBody.querySelector('[data-product-search]');
      const results = modalBody.querySelector('[data-product-results]');
      let searchTimer;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = searchInput.value.trim();
        if (!q) { results.classList.add('qp-hidden'); return; }
        searchTimer = setTimeout(async () => {
          try {
            const variants = await api(`/api/shopify/products?q=${encodeURIComponent(q)}&limit=25`);
            results.classList.remove('qp-hidden');
            results.innerHTML = variants.length ? variants.map(v => `
              <div class="qp-product-picker__result" data-variant='${escapeHtml(JSON.stringify(v))}'>
                <span>${escapeHtml(v.title)} ${v.sku ? `<span class="qp-muted">(${escapeHtml(v.sku)})</span>` : ''}</span>
                <strong>${fmt(v.price)}</strong>
              </div>`).join('') : '<div style="padding:8px;color:#888">No matches.</div>';
            results.querySelectorAll('[data-variant]').forEach(r => {
              r.addEventListener('click', () => {
                const v = JSON.parse(r.dataset.variant);
                // replace last blank row or add new
                const blankIdx = state.items.findIndex(it => !it.title);
                const payload = { title: v.title, sku: v.sku || '', unit_price: v.price, quantity: 1, shopify_variant_id: v.variant_id };
                if (blankIdx >= 0) state.items[blankIdx] = payload; else state.items.push(payload);
                searchInput.value = '';
                results.classList.add('qp-hidden');
                render();
              });
            });
          } catch (err) {
            results.classList.remove('qp-hidden');
            results.innerHTML = `<div class="qp-error" style="padding:8px">Search failed: ${escapeHtml(err.message)}</div>`;
          }
        }, 250);
      });

      // Save
      modalBody.querySelector('[data-save-quote]').addEventListener('click', async () => {
        const errBox = modalBody.querySelector('[data-error]');
        errBox.classList.add('qp-hidden');
        try {
          const cleanItems = state.items
            .filter(it => it.title && Number(it.quantity) > 0)
            .map(it => ({
              title: it.title, sku: it.sku, quantity: Number(it.quantity),
              unit_price: Number(it.unit_price), shopify_variant_id: it.shopify_variant_id || null
            }));
          if (!cleanItems.length) throw new Error('Add at least one line item');
          const saved = await api('/api/quotes', {
            method: 'POST',
            body: JSON.stringify({
              customer: state.customer,
              items: cleanItems,
              notes: state.notes,
              discount: state.discount,
              tax_rate: state.tax_rate,
              currency: CURRENCY,
              valid_until: state.valid_until || null
            })
          });
          closeModal();
          await loadPanel('quotes');
          openQuote(saved.id);
        } catch (err) {
          errBox.textContent = err.message;
          errBox.classList.remove('qp-hidden');
        }
      });
    }

    function itemRow(it, i) {
      const lineTotal = Number(it.quantity||0) * Number(it.unit_price||0);
      return `<tr data-item-row="${i}">
        <td><input data-fi="${i}.title" value="${escapeHtml(it.title)}" placeholder="Item title" /></td>
        <td><input data-fi="${i}.sku" value="${escapeHtml(it.sku||'')}" placeholder="SKU" /></td>
        <td class="qp-col-qty"><input type="number" step="1" min="1" data-fi="${i}.quantity" value="${it.quantity}" /></td>
        <td class="qp-col-price"><input type="number" step="0.01" min="0" data-fi="${i}.unit_price" value="${it.unit_price}" /></td>
        <td class="qp-col-total">${fmt(lineTotal)}</td>
        <td><button class="qp-btn qp-btn--ghost qp-btn--danger" data-remove-item="${i}">✕</button></td>
      </tr>`;
    }

    function bindItemRows() {
      modalBody.querySelectorAll('[data-fi]').forEach(el => {
        el.addEventListener('input', () => {
          const [idx, key] = el.dataset.fi.split('.');
          state.items[idx][key] = el.type === 'number' ? Number(el.value) : el.value;
          if (['quantity','unit_price'].includes(key)) render();
        });
      });
      modalBody.querySelectorAll('[data-remove-item]').forEach(btn => {
        btn.addEventListener('click', () => {
          state.items.splice(Number(btn.dataset.removeItem), 1);
          if (!state.items.length) state.items.push({ title:'', quantity:1, unit_price:0, sku:'' });
          render();
        });
      });
    }

    function totals(s) {
      const subtotal = s.items.reduce((sum, it) => sum + Number(it.quantity||0) * Number(it.unit_price||0), 0);
      const taxable = Math.max(0, subtotal - Number(s.discount||0));
      const tax = taxable * Number(s.tax_rate||0);
      return { subtotal, tax, total: taxable + tax };
    }
  }

  // ---------------- View existing quote ----------------
  async function openQuote(id) {
    try {
      const q = await api(`/api/quotes/${id}`);
      const itemsHtml = q.items.map(it => `
        <tr>
          <td>${escapeHtml(it.title)}<div class="qp-muted">${escapeHtml(it.sku||'')}</div></td>
          <td style="text-align:right">${it.quantity}</td>
          <td style="text-align:right">${fmt(it.unit_price)}</td>
          <td style="text-align:right">${fmt(it.line_total)}</td>
        </tr>`).join('');

      openModal(`
        <div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <h2 style="margin:0">${escapeHtml(q.quote_number)}</h2>
          <span class="qp-status qp-status--${q.status}">${q.status}</span>
        </div>
        <div class="qp-muted" style="margin:4px 0 16px">Created ${new Date(q.created_at).toLocaleString()}</div>
        <div>
          <strong>${escapeHtml(q.customer?.company || q.customer?.name || 'No customer')}</strong>
          <div class="qp-muted">${escapeHtml(q.customer?.email || '')}</div>
        </div>
        <table class="qp-items-table" style="margin-top:16px">
          <thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Total</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <div class="qp-totals"><div class="qp-totals__box">
          <div>Subtotal</div><div class="qp-total-row--right">${fmt(q.subtotal)}</div>
          ${Number(q.discount)>0 ? `<div>Discount</div><div class="qp-total-row--right">-${fmt(q.discount)}</div>` : ''}
          <div>Tax</div><div class="qp-total-row--right">${fmt(q.tax)}</div>
          <div class="qp-total-row--grand">Total</div><div class="qp-total-row--right qp-total-row--grand">${fmt(q.total)}</div>
        </div></div>

        ${q.notes ? `<div style="margin-top:16px"><strong>Notes</strong><div class="qp-muted">${escapeHtml(q.notes)}</div></div>` : ''}

        <div class="qp-modal__actions">
          <a class="qp-btn" href="${API}/api/quotes/${q.id}/pdf" target="_blank" rel="noopener"
             onclick="event.preventDefault(); fetch('${API}/api/quotes/${q.id}/pdf',{headers:{'x-portal-token':'${TOKEN}'}}).then(r=>r.blob()).then(b=>{const u=URL.createObjectURL(b);window.open(u,'_blank');})">
            Download PDF
          </a>
          <button class="qp-btn" data-status="sent">Mark sent</button>
          <button class="qp-btn" data-status="accepted">Mark accepted</button>
          <button class="qp-btn qp-btn--primary" data-convert>Convert to Shopify draft order</button>
          <button class="qp-btn qp-btn--ghost" data-close-modal>Close</button>
        </div>
        <div class="qp-error qp-hidden" data-error></div>
      `);

      modalBody.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));
      modalBody.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', async () => {
        try {
          await api(`/api/quotes/${q.id}/status`, { method:'PATCH', body: JSON.stringify({ status: b.dataset.status }) });
          closeModal(); loadPanel('quotes');
        } catch (err) { showErr(err); }
      }));
      modalBody.querySelector('[data-convert]').addEventListener('click', async () => {
        try {
          const { invoice_url } = await api(`/api/quotes/${q.id}/convert`, { method:'POST' });
          closeModal(); loadPanel('quotes');
          if (invoice_url) window.open(invoice_url, '_blank');
        } catch (err) { showErr(err); }
      });
    } catch (err) { alert('Failed to load quote: ' + err.message); }
  }

  function showErr(err) {
    const box = modalBody.querySelector('[data-error]');
    if (!box) return alert(err.message);
    box.textContent = err.message; box.classList.remove('qp-hidden');
  }

  // ---------------- PO builder (simplified) ----------------
  function openPOBuilder() {
    const state = {
      supplier: { name:'', email:'', phone:'' },
      items: [{ title:'', sku:'', quantity:1, unit_cost:0 }],
      notes: '', expected_date: '', tax_rate: TAX_RATE
    };
    render();

    function render() {
      const subtotal = state.items.reduce((s,it)=>s + Number(it.quantity||0)*Number(it.unit_cost||0), 0);
      const tax = subtotal * Number(state.tax_rate||0);
      openModal(`
        <h2 style="margin:0 0 16px">New purchase order</h2>
        <div class="qp-form-grid">
          <label>Supplier name <input data-f="supplier.name" value="${escapeHtml(state.supplier.name)}" /></label>
          <label>Supplier email <input data-f="supplier.email" value="${escapeHtml(state.supplier.email)}" /></label>
          <label>Expected date <input type="date" data-f="expected_date" value="${escapeHtml(state.expected_date)}" /></label>
          <label>Tax rate <input type="number" step="0.01" min="0" max="1" data-f="tax_rate" value="${state.tax_rate}" /></label>
          <label>Notes <textarea data-f="notes">${escapeHtml(state.notes)}</textarea></label>
        </div>
        <table class="qp-items-table">
          <thead><tr><th>Item</th><th>SKU</th><th class="qp-col-qty">Qty</th><th class="qp-col-price">Unit cost</th><th class="qp-col-total">Total</th><th></th></tr></thead>
          <tbody>
            ${state.items.map((it,i)=>`<tr>
              <td><input data-fi="${i}.title" value="${escapeHtml(it.title)}" /></td>
              <td><input data-fi="${i}.sku" value="${escapeHtml(it.sku)}" /></td>
              <td class="qp-col-qty"><input type="number" min="1" data-fi="${i}.quantity" value="${it.quantity}" /></td>
              <td class="qp-col-price"><input type="number" step="0.01" min="0" data-fi="${i}.unit_cost" value="${it.unit_cost}" /></td>
              <td class="qp-col-total">${fmt(Number(it.quantity||0)*Number(it.unit_cost||0))}</td>
              <td><button class="qp-btn qp-btn--ghost qp-btn--danger" data-remove-item="${i}">✕</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
        <button class="qp-btn" data-add-item style="margin-top:6px">+ Add line</button>
        <div class="qp-totals"><div class="qp-totals__box">
          <div>Subtotal</div><div class="qp-total-row--right">${fmt(subtotal)}</div>
          <div>Tax</div><div class="qp-total-row--right">${fmt(tax)}</div>
          <div class="qp-total-row--grand">Total</div><div class="qp-total-row--right qp-total-row--grand">${fmt(subtotal+tax)}</div>
        </div></div>
        <div class="qp-modal__actions">
          <button class="qp-btn" data-close-modal>Cancel</button>
          <button class="qp-btn qp-btn--primary" data-save-po>Save PO</button>
        </div>
        <div class="qp-error qp-hidden" data-error></div>
      `);

      modalBody.querySelectorAll('[data-f]').forEach(el => el.addEventListener('input', () => {
        const path = el.dataset.f.split('.');
        let obj = state;
        for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
        obj[path[path.length-1]] = el.type === 'number' ? Number(el.value) : el.value;
        if (el.dataset.f === 'tax_rate') render();
      }));
      modalBody.querySelectorAll('[data-fi]').forEach(el => el.addEventListener('input', () => {
        const [idx, key] = el.dataset.fi.split('.');
        state.items[idx][key] = el.type === 'number' ? Number(el.value) : el.value;
        if (['quantity','unit_cost'].includes(key)) render();
      }));
      modalBody.querySelectorAll('[data-remove-item]').forEach(b => b.addEventListener('click', () => {
        state.items.splice(Number(b.dataset.removeItem),1);
        if (!state.items.length) state.items.push({ title:'', sku:'', quantity:1, unit_cost:0 });
        render();
      }));
      modalBody.querySelector('[data-add-item]').addEventListener('click', () => {
        state.items.push({ title:'', sku:'', quantity:1, unit_cost:0 });
        render();
      });
      modalBody.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));
      modalBody.querySelector('[data-save-po]').addEventListener('click', async () => {
        try {
          const items = state.items.filter(it => it.title && Number(it.quantity) > 0);
          if (!items.length) throw new Error('Add at least one line item');
          await api('/api/purchase-orders', {
            method: 'POST',
            body: JSON.stringify({
              supplier: state.supplier, items,
              notes: state.notes, expected_date: state.expected_date || null,
              tax_rate: state.tax_rate, currency: CURRENCY
            })
          });
          closeModal(); loadPanel('purchase-orders');
        } catch (err) { showErr(err); }
      });
    }
  }

  async function openPO(id) {
    try {
      const p = await api(`/api/purchase-orders/${id}`);
      openModal(`
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <h2 style="margin:0">${escapeHtml(p.po_number)}</h2>
          <span class="qp-status qp-status--${p.status}">${p.status}</span>
        </div>
        <div class="qp-muted" style="margin-bottom:12px">Supplier: ${escapeHtml(p.supplier?.name || '—')}</div>
        <table class="qp-items-table">
          <thead><tr><th>Item</th><th>SKU</th><th style="text-align:right">Qty</th><th style="text-align:right">Received</th><th style="text-align:right">Unit cost</th><th style="text-align:right">Total</th></tr></thead>
          <tbody>
            ${p.items.map(it => `<tr>
              <td>${escapeHtml(it.title)}</td><td>${escapeHtml(it.sku||'')}</td>
              <td style="text-align:right">${it.quantity}</td>
              <td style="text-align:right"><input type="number" min="0" value="${it.qty_received}" data-receive="${it.id}" style="width:70px;text-align:right" /></td>
              <td style="text-align:right">${fmt(it.unit_cost)}</td>
              <td style="text-align:right">${fmt(it.line_total)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="qp-modal__actions">
          <button class="qp-btn" data-status="sent">Mark sent</button>
          <button class="qp-btn" data-status="partial">Partial</button>
          <button class="qp-btn qp-btn--primary" data-status="received">Received</button>
          <button class="qp-btn qp-btn--ghost" data-close-modal>Close</button>
        </div>
      `);
      modalBody.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));
      modalBody.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', async () => {
        await api(`/api/purchase-orders/${p.id}/status`, { method:'PATCH', body: JSON.stringify({ status: b.dataset.status }) });
        closeModal(); loadPanel('purchase-orders');
      }));
      modalBody.querySelectorAll('[data-receive]').forEach(inp => inp.addEventListener('change', async () => {
        await api(`/api/purchase-orders/${p.id}/items/${inp.dataset.receive}/receive`, {
          method:'PATCH', body: JSON.stringify({ qty_received: Number(inp.value||0) })
        });
      }));
    } catch (err) { alert('Failed to load PO: ' + err.message); }
  }

  // Initial load
  if (!API || !TOKEN) {
    root.querySelector('[data-list="quotes"]').innerHTML =
      '<div class="qp-error" style="padding:20px">Section not configured. In the Shopify theme editor, set the Railway API URL and portal token on this section.</div>';
    return;
  }
  loadPanel('quotes');
})();

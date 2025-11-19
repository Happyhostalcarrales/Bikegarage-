function renderStock() {
  const stockList = document.getElementById('stock-list');
  let stock = allData.filter(d => d.type === 'stock');

  // --- FILTROS (Se mantienen igual) ---
  if (currentStockCategoryFilter) {
    stock = stock.filter(s => s.stock_category === currentStockCategoryFilter);
  }

  if (currentStockStatusFilter) {
    stock = stock.filter(s => {
      if (currentStockStatusFilter === 'ok') return s.stock_quantity > s.stock_min_quantity;
      if (currentStockStatusFilter === 'low') return s.stock_quantity > 0 && s.stock_quantity <= s.stock_min_quantity;
      if (currentStockStatusFilter === 'out') return s.stock_quantity === 0;
      return true;
    });
  }

  if (currentStockSearch) {
    const searchLower = currentStockSearch.toLowerCase();
    stock = stock.filter(s => 
      s.stock_name.toLowerCase().includes(searchLower) ||
      s.stock_category.toLowerCase().includes(searchLower) ||
      (s.stock_brand && s.stock_brand.toLowerCase().includes(searchLower)) ||
      (s.stock_location && s.stock_location.toLowerCase().includes(searchLower))
    );
  }

  if (stock.length === 0) {
    stockList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📦</div>
        <h3>No hay materiales en el inventario</h3>
        <p>Añade componentes y materiales para gestionar tu stock</p>
      </div>
    `;
    return;
  }

  const currencySymbol = defaultConfig.currency_symbol;

  stockList.innerHTML = stock.map(s => {
    const isLowStock = s.stock_quantity > 0 && s.stock_quantity <= s.stock_min_quantity;
    const isOutOfStock = s.stock_quantity === 0;
    
    let cardClass = 'stock-card';
    
    if (isOutOfStock) {
      cardClass += ' out-of-stock';
    } else if (isLowStock) {
      cardClass += ' low-stock';
    }

    // Icono por defecto si no hay imagen
    const defaultIcon = '📦'; 
    
    return `
      <div class="${cardClass}">
        
        ${s.imageURL 
          ? `<img src="${s.imageURL}" alt="${s.stock_name}" class="stock-card-img">`
          : `<div class="stock-card-img" style="background:#edf2f7; display:flex; align-items:center; justify-content:center; font-size:24px;">${defaultIcon}</div>`
        }

        <div class="stock-info-main">
          <div class="stock-name">${s.stock_name}</div>
          <div class="stock-meta-row">
            <span class="stock-category">${s.stock_category}</span>
            ${s.stock_brand ? `<span class="stock-brand">• ${s.stock_brand}</span>` : ''}
            ${s.stock_location ? `<span class="stock-brand" style="color:#a0aec0;">• 📍 ${s.stock_location}</span>` : ''}
          </div>
        </div>

        <div class="stock-qty-area">
            <button class="quantity-btn" onclick="updateStockQuantity('${s.id}', -1)" title="Reducir">－</button>
            <div class="stock-qty-val" style="${isOutOfStock ? 'color: #e53e3e;' : ''}">${s.stock_quantity}</div>
            <button class="quantity-btn" onclick="updateStockQuantity('${s.id}', 1)" title="Aumentar">＋</button>
        </div>

        <div class="stock-actions">
          <button class="edit-bike-btn" style="margin:0; width:32px; height:32px;" onclick="showEditStockModal('${s.id}')" title="Editar material">✏️</button>
          <button class="delete-stock" style="margin:0; width:32px; height:32px;" onclick="showDeleteStockConfirmation('${s.id}')" title="Eliminar material">×</button>
        </div>

      </div>
    `;
  }).join('');
}
